"""仓库入库流水线：克隆 → 解析切片 → 写库 → 向量化 → 完成。

设计约束（2G2核）：
- 进程内单并发：一个 worker 线程串行消费任务，等待队列最多 `job_queue_limit` 个；
- 单仓库大小 / 文件数 / 切片数上限在克隆与解析阶段校验，超限直接失败；
- 克隆 300s、单任务总时长 30min 超时；
- embedding 按 `embed_batch_size` 分批，向量写入再按固定批大小累加，避免一次性占满内存；
- 多仓库隔离：向量元数据写 repo_id / file_id，清理按 repo_id 过滤。

一致性策略（简单可靠优先）：
1. 克隆到临时目录，成功后才替换旧目录，克隆失败不动已有数据；
2. 解析全部完成并通过上限校验后，才进入写库（单事务：删旧 + 插新 + commit）；
3. 写库成功后再按 repo_id 清向量并重新写入；
4. 任一步失败 / 取消：删除该仓库的 PG 文件与切片、删除该 repo_id 的向量，
   仓库置为未索引，任务记 failed / canceled —— 不留下半成品。
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import delete, select

from app.config import settings
from app.database import SessionLocal
from app.models import Chunk, CodeFile, Repo, RepoJob
from app.services.indexing.chunker import ChunkData, chunk_java_file, walk_paths
from app.services.indexing.embedder import (
    get_chroma_client,
    get_embedder,
    get_or_create_collection,
)
from app.services.indexing.persist import (
    get_or_create_repo,
    save_chunk,
    save_code_file,
)

REPOS_ROOT = Path("data") / "repos"
# Chroma 单次 add 的条数（不是 embedding batch；embedding batch 由 settings 控制）
CHROMA_ADD_BATCH = 256


class IngestError(Exception):
    """可预期的入库失败（超限、克隆失败、超时等）。"""


class JobCanceled(Exception):
    """任务被用户取消。"""


@dataclass
class ParsedFile:
    """解析阶段的内存中间结果（写库前不触碰数据库）。"""

    rel_path: str
    parse_ok: bool
    chunks: list[ChunkData]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def derive_repo_name(url: str) -> str:
    """从 URL 末段推导仓库名，并过滤成安全的目录名。"""
    raw = urlparse(url).path.rstrip("/").split("/")[-1] or "repo"
    if raw.endswith(".git"):
        raw = raw[:-4]
    name = re.sub(r"[^\w.-]", "-", raw).strip("-.")
    return (name or "repo")[:100]


def update_job(job_id: int, **fields) -> None:
    """独立会话更新任务行，避免与写库事务互相阻塞。"""
    db = SessionLocal()
    try:
        job = db.get(RepoJob, job_id)
        if job is None:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        db.commit()
    finally:
        db.close()


def _cancel_requested(job_id: int) -> bool:
    db = SessionLocal()
    try:
        job = db.get(RepoJob, job_id)
        return bool(job and job.cancel_requested)
    finally:
        db.close()


def _checkpoint(job_id: int, started_at: float) -> None:
    """阶段检查点：响应取消、总超时。"""
    if _cancel_requested(job_id):
        raise JobCanceled
    if time.time() - started_at > settings.job_timeout_seconds:
        raise IngestError(
            f"任务超时（>{settings.job_timeout_seconds // 60} 分钟），已终止"
        )


def _dir_size_mb(root: Path) -> float:
    """统计仓库体积（排除 .git），单位 MB。"""
    total = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if ".git" in path.relative_to(root).parts:
                continue
            total += path.stat().st_size
        except OSError:
            continue
    return total / (1024 * 1024)


def _clone(url: str, target: Path, job_id: int, started_at: float) -> None:
    """克隆到临时目录；轮询进程以支持取消与超时。"""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)

    proc = subprocess.Popen(
        ["git", "clone", "--depth", "1", "--", url, str(target)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    clone_started = time.time()
    while proc.poll() is None:
        if _cancel_requested(job_id):
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            raise JobCanceled
        if time.time() - clone_started > settings.clone_timeout_seconds:
            proc.kill()
            raise IngestError(
                f"克隆超时（>{settings.clone_timeout_seconds}s）：{url}"
            )
        if time.time() - started_at > settings.job_timeout_seconds:
            proc.kill()
            raise IngestError("任务超时，已终止")
        time.sleep(0.5)

    if proc.returncode != 0:
        stderr = (proc.stderr.read() if proc.stderr else "") or ""
        raise IngestError(f"克隆失败：{stderr.strip()[:400] or 'git 返回非零退出码'}")


def _rmtree(path: Path) -> None:
    """删除目录，兼容 Windows 下 .git 里的只读文件。"""
    def _on_error(func, target, _exc_info):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError as exc:
            print(f"[清理] 删除 {target} 失败: {exc}")

    shutil.rmtree(path, onerror=_on_error)


def _swap_clone_dir(staging: Path, final: Path) -> None:
    """用新克隆目录替换旧目录（Windows 下 rename 不能覆盖已有目录）。"""
    if final.exists():
        _rmtree(final)
    if final.exists():
        raise IngestError(f"无法替换旧克隆目录：{final}（可能被其他进程占用）")
    staging.rename(final)


def resolve_clone_dir(db, name: str, url: str) -> Path:
    """同名的不同仓库追加 url 短哈希，避免克隆目录互相覆盖。"""
    candidate = REPOS_ROOT / name
    taken = db.execute(
        select(Repo.id).where(Repo.clone_dir == str(candidate), Repo.url != url)
    ).first()
    if taken is None:
        return candidate
    suffix = re.sub(r"\W", "", url)[-8:]
    return REPOS_ROOT / f"{name}-{suffix}"


def _new_chroma_collection():
    client = get_chroma_client(settings.chroma_dir)
    return get_or_create_collection(client)


def _delete_vectors(collection, repo_id: int) -> None:
    """按 repo_id 删除该仓库全部向量（不影响其他仓库）。"""
    try:
        collection.delete(where={"repo_id": repo_id})
    except Exception as exc:  # noqa: BLE001 - 清理失败不掩盖原始错误
        print(f"[入库清理] 删除向量失败 repo_id={repo_id}: {exc}")


def _cleanup_repo(repo_id: int) -> None:
    """失败 / 取消后的兜底：清空该仓库的 PG 数据与向量，保持两侧一致。"""
    db = SessionLocal()
    try:
        file_ids = list(
            db.execute(select(CodeFile.id).where(CodeFile.repo_id == repo_id)).scalars()
        )
        if file_ids:
            db.execute(delete(Chunk).where(Chunk.file_id.in_(file_ids)))
        db.execute(delete(CodeFile).where(CodeFile.repo_id == repo_id))
        repo = db.get(Repo, repo_id)
        if repo is not None:
            repo.indexed_at = None
        db.commit()
    finally:
        db.close()

    try:
        _delete_vectors(_new_chroma_collection(), repo_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[入库清理] 打开向量库失败 repo_id={repo_id}: {exc}")


def run_ingest_job(job_id: int) -> None:
    """执行单个入库任务；所有异常都落成任务状态，不向上抛出。"""
    started_at = time.time()
    staging: Path | None = None
    final_dir: Path | None = None
    repo_id: int | None = None
    phase = "cloning"
    # 是否已经开始破坏性写入（删旧数据）。未写入时失败/取消不清空已有索引。
    wrote = False

    db = SessionLocal()
    try:
        job = db.get(RepoJob, job_id)
        if job is None or job.status not in ("queued", "running"):
            return
        url = job.repo_url
        job.status = "running"
        job.started_at = job.started_at or _now()
        job.phase = "cloning"
        job.progress = 1
        job.message = "正在克隆仓库"
        db.commit()
        name = derive_repo_name(url)
        final_dir = resolve_clone_dir(db, name, url)
        staging = REPOS_ROOT / f".staging-{name}-{job_id}"

        # 提前建/复用仓库行，便于前端在克隆阶段就能看到卡片
        repo = get_or_create_repo(db, name, url, str(final_dir))
        repo_id = repo.id
        job.repo_id = repo_id
        db.commit()
    finally:
        db.close()

    try:
        # ---- 阶段 1：克隆 ----
        _clone(url, staging, job_id, started_at)
        size_mb = _dir_size_mb(staging)
        if size_mb > settings.max_repo_size_mb:
            raise IngestError(
                f"仓库体积 {size_mb:.1f}MB 超过上限 {settings.max_repo_size_mb}MB"
            )

        files = walk_paths(str(staging), ".java")
        if not files:
            raise IngestError("仓库中未找到 .java 文件")
        if len(files) > settings.max_repo_files:
            raise IngestError(
                f"文件数 {len(files)} 超过上限 {settings.max_repo_files}"
            )

        update_job(
            job_id,
            phase="parsing",
            progress=10,
            total_files=len(files),
            message=f"正在解析 {len(files)} 个文件",
        )
        phase = "parsing"

        # ---- 阶段 2：解析（纯内存，失败不影响已有数据）----
        parsed: list[ParsedFile] = []
        total_chunks = 0
        for idx, path in enumerate(files, start=1):
            _checkpoint(job_id, started_at)
            rel_path = str(Path(path).relative_to(staging)).replace("\\", "/")
            try:
                source = Path(path).read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                raise IngestError(f"读取文件失败：{rel_path}（{exc}）") from exc

            ast_chunks, fixed_chunks, parse_ok = chunk_java_file(path, source)
            chunks = ast_chunks + fixed_chunks
            total_chunks += len(chunks)
            if total_chunks > settings.max_repo_chunks:
                raise IngestError(
                    f"切片数超过上限 {settings.max_repo_chunks}，已终止（未写入任何数据）"
                )
            parsed.append(ParsedFile(rel_path=rel_path, parse_ok=parse_ok, chunks=chunks))

            if idx % 10 == 0 or idx == len(files):
                update_job(
                    job_id,
                    processed_files=idx,
                    progress=10 + int(50 * idx / len(files)),
                    total_chunks=total_chunks,
                    message=f"正在解析 {idx}/{len(files)} 个文件",
                )

        # 解析全部通过后替换源码目录，避免失败时丢掉旧副本
        assert final_dir is not None and staging is not None
        _swap_clone_dir(staging, final_dir)
        staging = None

        update_job(
            job_id,
            phase="persisting",
            progress=62,
            total_chunks=total_chunks,
            message="正在写入数据库",
        )
        phase = "persisting"

        # ---- 阶段 3：写库（单事务：删旧 + 插新）----
        _checkpoint(job_id, started_at)
        wrote = True
        pending: list[tuple[int, int, str, ChunkData]] = []
        db = SessionLocal()
        try:
            old_files = list(
                db.execute(
                    select(CodeFile.id).where(CodeFile.repo_id == repo_id)
                ).scalars()
            )
            if old_files:
                db.execute(delete(Chunk).where(Chunk.file_id.in_(old_files)))
            db.execute(delete(CodeFile).where(CodeFile.repo_id == repo_id))
            db.flush()

            done_files = 0
            for item in parsed:
                file_row = save_code_file(
                    db, repo_id, item.rel_path, "java", item.parse_ok
                )
                parent_map: dict[str, int] = {}
                for chunk in item.chunks:
                    row = save_chunk(db, file_row.id, chunk, parent_map)
                    pending.append((row.id, file_row.id, item.rel_path, chunk))
                done_files += 1
                if done_files % 20 == 0:
                    update_job(
                        job_id,
                        processed_files=done_files,
                        progress=62 + int(8 * done_files / max(len(parsed), 1)),
                    )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        # ---- 阶段 4：向量化 ----
        update_job(
            job_id,
            phase="embedding",
            progress=70,
            processed_files=len(parsed),
            processed_chunks=0,
            message="正在加载向量模型",
        )
        phase = "embedding"
        collection = _new_chroma_collection()
        _delete_vectors(collection, repo_id)
        # 进程内复用同一模型实例；加载失败/超时立即转成任务错误，不卡在重试里
        try:
            embedder = get_embedder(settings.embedding_model)
        except Exception as exc:  # noqa: BLE001
            raise IngestError(f"向量模型不可用：{exc}") from exc

        done_chunks = 0
        for offset in range(0, len(pending), CHROMA_ADD_BATCH):
            _checkpoint(job_id, started_at)
            batch = pending[offset : offset + CHROMA_ADD_BATCH]
            documents = [chunk.enriched_text for _, _, _, chunk in batch]
            vectors = embedder.encode(
                documents, batch_size=settings.embed_batch_size
            )
            metadatas = [
                _build_metadata(chunk, rel_path, repo_id, file_id, chunk_id)
                for chunk_id, file_id, rel_path, chunk in batch
            ]
            collection.add(
                ids=[str(chunk_id) for chunk_id, _, _, _ in batch],
                documents=documents,
                embeddings=vectors,
                metadatas=metadatas,
            )
            done_chunks += len(batch)
            update_job(
                job_id,
                processed_chunks=done_chunks,
                progress=70 + int(29 * done_chunks / max(len(pending), 1)),
                message=f"正在向量化 {done_chunks}/{len(pending)} 个切片",
            )

        # ---- 完成 ----
        db = SessionLocal()
        try:
            repo = db.get(Repo, repo_id)
            if repo is not None:
                repo.indexed_at = _now()
            job = db.get(RepoJob, job_id)
            if job is not None:
                job.status = "succeeded"
                job.phase = "done"
                job.progress = 100
                job.processed_files = len(parsed)
                job.processed_chunks = len(pending)
                job.total_files = len(files)
                job.total_chunks = len(pending)
                job.message = "入库完成"
                job.finished_at = _now()
            db.commit()
        finally:
            db.close()

    except JobCanceled:
        if wrote and repo_id is not None:
            _cleanup_repo(repo_id)
        _remove_dir(staging)
        update_job(
            job_id,
            status="canceled",
            phase="canceled",
            message="任务已取消（未写入阶段取消，原有索引保持不变）"
            if not wrote
            else "任务已取消，该仓库索引已清空",
            finished_at=_now(),
        )
    except Exception as exc:  # noqa: BLE001 - 记录任意失败原因
        message = str(exc) if isinstance(exc, IngestError) else f"{type(exc).__name__}: {exc}"
        print(f"[入库失败] job={job_id} phase={phase}: {message}")
        if wrote and repo_id is not None:
            _cleanup_repo(repo_id)
        _remove_dir(staging)
        update_job(
            job_id,
            status="failed",
            phase=phase,
            error=message[:2000],
            message=(
                f"入库失败：{message[:180]}"
                if wrote
                else f"入库失败（原有索引未受影响）：{message[:150]}"
            ),
            finished_at=_now(),
        )


def _remove_dir(path: Path | None) -> None:
    if path is not None and path.exists():
        _rmtree(path)


def _build_metadata(
    chunk: ChunkData, rel_path: str, repo_id: int, file_id: int, chunk_id: int
) -> dict:
    meta: dict = {
        "chunk_id": int(chunk_id),
        "repo_id": int(repo_id),
        "file_id": int(file_id),
        "file_path": rel_path,
        "chunk_type": chunk.chunk_type,
        "strategy": chunk.strategy,
        "start_line": int(chunk.start_line),
        "end_line": int(chunk.end_line),
        "language": "java",
    }
    if chunk.name:
        meta["name"] = chunk.name
    if chunk.signature:
        meta["signature"] = chunk.signature
    return meta


class IngestManager:
    """进程内单并发任务管理器：1 个 worker 线程 + 最多 N 个等待任务。"""

    def __init__(self, queue_limit: int):
        self._queue_limit = queue_limit
        self._lock = threading.Lock()
        self._pending: deque[int] = deque()
        self._worker: threading.Thread | None = None
        self.current_job_id: int | None = None

    def start(self) -> None:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._loop, name="ingest-worker", daemon=True
            )
            self._worker.start()

    def submit(self, job_id: int) -> bool:
        """入队；等待队列满时返回 False（由路由转成 429）。"""
        self.start()
        with self._lock:
            if len(self._pending) >= self._queue_limit:
                return False
            self._pending.append(job_id)
        return True

    def cancel_pending(self, job_id: int) -> bool:
        """把还在排队、尚未开始的任务直接移出队列。"""
        with self._lock:
            try:
                self._pending.remove(job_id)
            except ValueError:
                return False
        return True

    def _loop(self) -> None:
        while True:
            with self._lock:
                job_id = self._pending.popleft() if self._pending else None
                self.current_job_id = job_id
            if job_id is None:
                time.sleep(0.5)
                continue
            try:
                run_ingest_job(job_id)
            except Exception as exc:  # noqa: BLE001 - worker 不能退出
                print(f"[入库 worker] job={job_id} 未捕获异常: {exc}")
            finally:
                with self._lock:
                    self.current_job_id = None


manager = IngestManager(settings.job_queue_limit)


def recover_interrupted_jobs() -> int:
    """服务启动时把上次进程留下的未完成任务标记失败（进程内队列不持久化）。"""
    db = SessionLocal()
    try:
        rows = list(
            db.execute(
                select(RepoJob).where(RepoJob.status.in_(("queued", "running")))
            ).scalars()
        )
        for job in rows:
            job.status = "failed"
            job.error = "服务重启，任务中断"
            job.message = "服务重启，任务中断"
            job.finished_at = _now()
        db.commit()
        return len(rows)
    finally:
        db.close()
