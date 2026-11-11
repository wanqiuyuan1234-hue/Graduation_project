"""向量化（sentence-transformers）与 ChromaDB 封装。"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from app.config import settings

# Chroma 默认遥测在导入时联网，受限网络下会长时间阻塞；导入前关闭遥测。
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_IMPL", "chromadb.telemetry.product.none")

import chromadb

COLLECTION_NAME = "code_chunks"

_model_lock = threading.Lock()
_embedder: "Embedder | None" = None
_embedder_model: str | None = None


def hf_hub_dir() -> Path:
    """返回本地 HF hub 缓存目录（遵循 HF_HOME）。"""
    home = os.getenv("HF_HOME")
    if home:
        return Path(home) / "hub"
    return Path(os.path.expanduser("~")) / ".cache" / "huggingface" / "hub"


def local_model_available(model_name: str) -> bool:
    """检查模型缓存是否完整（有 modules.json、config.json 和权重文件）。

    只读文件系统，不会触发任何网络请求。
    """
    repo_dir = hf_hub_dir() / f"models--{model_name.replace('/', '--')}"
    snapshots = repo_dir / "snapshots"
    if not snapshots.is_dir():
        return False
    for snap in snapshots.iterdir():
        if not snap.is_dir():
            continue
        if not (snap / "modules.json").is_file():
            continue
        if not (snap / "config.json").is_file():
            continue
        if any(
            (snap / name).is_file()
            for name in ("model.safetensors", "pytorch_model.bin")
        ):
            return True
    return False


class Embedder:
    """Embedding 封装：优先离线加载本地缓存，避免每次任务都联网校验。"""

    def __init__(self, model_name: str, local_only: bool | None = None):
        local_only = settings.embedding_local_only if local_only is None else local_only
        local_ok = local_model_available(model_name)

        if local_only and not local_ok:
            raise RuntimeError(
                f"本地未找到完整的 embedding 模型缓存：{model_name}（{hf_hub_dir()}）。"
                "请手动下载模型到该目录，或设置 EMBEDDING_LOCAL_ONLY=false 并通过 "
                "HF_ENDPOINT 指定可用镜像后重试"
            )
        if local_ok:
            # 命中本地缓存：强制离线，彻底跳过 huggingface.co 的 ETag/HEAD 校验与重试
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
        else:
            # 未命中且允许联网：给单次请求明确超时上限，避免长时间无反馈
            os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "5")
            os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")

        # 加载放到独立线程并设置上限：受限网络下的下载/重试不会无限期卡住任务
        result: dict[str, Any] = {}

        def _load() -> None:
            try:
                # 延迟导入，避免未使用向量化时也加载 torch
                from sentence_transformers import SentenceTransformer

                result["model"] = SentenceTransformer(
                    model_name, local_files_only=local_only and local_ok
                )
            except BaseException as exc:  # noqa: BLE001 - 交给主线程统一包装
                result["error"] = exc

        timeout = settings.embedding_load_timeout_seconds
        worker = threading.Thread(target=_load, name="embed-loader", daemon=True)
        worker.start()
        worker.join(timeout)
        if worker.is_alive():
            raise RuntimeError(
                f"向量模型加载超时（>{timeout}s）：{model_name}。"
                "请确认本地缓存完整（或配置可用的 HF_ENDPOINT 镜像）后重试"
            )
        if "error" in result:
            raise RuntimeError(f"向量模型加载失败：{model_name}：{result['error']}")
        self.model = result["model"]

    def encode(self, texts: list[str], batch_size: int | None = None) -> list[list[float]]:
        """批量编码，返回与输入等长的向量列表（已归一化，适配 cosine）。"""
        kwargs: dict[str, Any] = {
            "normalize_embeddings": True,
            "show_progress_bar": False,
        }
        if batch_size is not None:
            kwargs["batch_size"] = batch_size
        vectors = self.model.encode(texts, **kwargs)
        return [v.tolist() for v in vectors]


def get_embedder(model_name: str | None = None) -> Embedder:
    """进程内复用同一个模型实例（只加载一次）。

    bge-small 常驻内存约 100–150MB，2G 机器上可接受；相比每次任务重新加载，
    省掉重复的权重解析与初始化开销。
    """
    global _embedder, _embedder_model
    name = model_name or settings.embedding_model
    if _embedder is not None and _embedder_model == name:
        return _embedder
    with _model_lock:
        if _embedder is None or _embedder_model != name:
            _embedder = Embedder(name)
            _embedder_model = name
    return _embedder


def get_chroma_client(chroma_dir: str) -> Any:
    """创建/打开持久化 Chroma 客户端。"""
    return chromadb.PersistentClient(path=chroma_dir)


def get_or_create_collection(client: Any) -> Any:
    """获取或创建 code_chunks 集合（cosine 距离）。"""
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def build_metadata(
    chunk,
    file_path: str,
    language: str,
    repo_id: int | None = None,
    file_id: int | None = None,
) -> dict:
    """构造 Chroma 检索元信息（None 值不写入，Chroma 不接受 None）。

    repo_id / file_id 用于多仓库隔离：清理时按 repo_id 精确删除，
    不会误删其他仓库的向量。
    """
    meta: dict[str, Any] = {
        "chunk_id": int(chunk.id),
        "file_path": file_path,
        "chunk_type": chunk.chunk_type,
        "strategy": chunk.strategy,
        "start_line": int(chunk.start_line),
        "end_line": int(chunk.end_line),
        "language": language,
    }
    if repo_id is not None:
        meta["repo_id"] = int(repo_id)
    if file_id is not None:
        meta["file_id"] = int(file_id)
    if chunk.name:
        meta["name"] = chunk.name
    if chunk.signature:
        meta["signature"] = chunk.signature
    return meta
