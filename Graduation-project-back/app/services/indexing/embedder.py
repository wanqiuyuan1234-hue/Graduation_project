"""向量化（sentence-transformers）与 ChromaDB 封装。"""

from __future__ import annotations

import os
from typing import Any

# Chroma 默认遥测在导入时联网，受限网络下会长时间阻塞；导入前关闭遥测。
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_IMPL", "chromadb.telemetry.product.none")

import chromadb

COLLECTION_NAME = "code_chunks"


class Embedder:
    """Embedding 封装：模型只在实例化时加载一次。"""

    def __init__(self, model_name: str):
        # 延迟导入，避免未使用向量化时也加载 torch
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)

    def encode(self, texts: list[str]) -> list[list[float]]:
        """批量编码，返回与输入等长的向量列表（已归一化，适配 cosine）。"""
        vectors = self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [v.tolist() for v in vectors]


def get_chroma_client(chroma_dir: str) -> Any:
    """创建/打开持久化 Chroma 客户端。"""
    return chromadb.PersistentClient(path=chroma_dir)


def get_or_create_collection(client: Any) -> Any:
    """获取或创建 code_chunks 集合（cosine 距离）。"""
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def build_metadata(chunk, file_path: str, language: str) -> dict:
    """构造 Chroma 检索元信息（None 值不写入，Chroma 不接受 None）。"""
    meta: dict[str, Any] = {
        "chunk_id": int(chunk.id),
        "file_path": file_path,
        "chunk_type": chunk.chunk_type,
        "strategy": chunk.strategy,
        "start_line": int(chunk.start_line),
        "end_line": int(chunk.end_line),
        "language": language,
    }
    if chunk.name:
        meta["name"] = chunk.name
    if chunk.signature:
        meta["signature"] = chunk.signature
    return meta
