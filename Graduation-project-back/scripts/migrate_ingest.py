"""一次性迁移：repo.url 唯一约束 + repo_job 表 + Chroma 元数据回填。

运行：在项目根目录执行 ``.venv\\Scripts\\python.exe scripts/migrate_ingest.py``

做三件事（均可重复执行）：
1. 检查 repo.url 是否有重复；有则中止并打印，避免加约束失败；
2. 创建 repo_job 表与唯一索引 uq_repo_url；
3. 给已有的 Chroma 向量补写 repo_id / file_id —— 这样"按仓库清向量"能作用于历史数据，
   不需要重新跑一遍向量化。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text

from app.config import settings
from app.database import SessionLocal, engine
from app.models import Chunk, CodeFile, RepoJob
from app.services.indexing.embedder import get_chroma_client, get_or_create_collection

BACKFILL_BATCH = 500


def _check_duplicate_urls() -> bool:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT url, count(*) AS c FROM repo "
                "WHERE url IS NOT NULL GROUP BY url HAVING count(*) > 1"
            )
        ).all()
    if not rows:
        return True
    print("发现重复 url，已中止（请先人工合并后再加唯一约束）：")
    for url, count in rows:
        print(f"  {count} 条  {url}")
    return False


def _create_schema() -> None:
    RepoJob.__table__.create(bind=engine, checkfirst=True)
    with engine.begin() as conn:
        conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_url ON repo (url)")
        )
    print("已创建 repo_job 表与 repo.url 唯一索引（如不存在）")


def _backfill_chroma() -> None:
    client = get_chroma_client(settings.chroma_dir)
    collection = get_or_create_collection(client)
    total = collection.count()
    if total == 0:
        print("Chroma 集合为空，跳过元数据回填")
        return

    db = SessionLocal()
    try:
        rows = db.execute(
            select(
                Chunk.id,
                Chunk.chunk_type,
                Chunk.strategy,
                Chunk.start_line,
                Chunk.end_line,
                Chunk.name,
                Chunk.signature,
                CodeFile.repo_id,
                CodeFile.id,
                CodeFile.path,
                CodeFile.language,
            ).join(CodeFile, Chunk.file_id == CodeFile.id)
        ).all()
    finally:
        db.close()

    updated = missing = 0
    for offset in range(0, len(rows), BACKFILL_BATCH):
        batch = rows[offset : offset + BACKFILL_BATCH]
        ids = [str(row[0]) for row in batch]
        existing = collection.get(ids=ids)
        found = set(existing["ids"])
        update_ids: list[str] = []
        update_metas: list[dict] = []
        for row in batch:
            (
                chunk_id,
                chunk_type,
                strategy,
                start_line,
                end_line,
                name,
                signature,
                repo_id,
                file_id,
                path,
                language,
            ) = row
            if str(chunk_id) not in found:
                missing += 1
                continue
            meta: dict = {
                "chunk_id": int(chunk_id),
                "repo_id": int(repo_id),
                "file_id": int(file_id),
                "file_path": path,
                "chunk_type": chunk_type,
                "strategy": strategy,
                "start_line": int(start_line),
                "end_line": int(end_line),
                "language": language or "java",
            }
            if name:
                meta["name"] = name
            if signature:
                meta["signature"] = signature
            update_ids.append(str(chunk_id))
            update_metas.append(meta)
        if update_ids:
            collection.update(ids=update_ids, metadatas=update_metas)
            updated += len(update_ids)

    print(f"Chroma 元数据回填完成：更新 {updated} 条，PG 有但向量缺失 {missing} 条")


def main() -> None:
    if not _check_duplicate_urls():
        sys.exit(1)
    _create_schema()
    _backfill_chroma()
    print("迁移完成")


if __name__ == "__main__":
    main()
