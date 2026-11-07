"""离线建库编排：clone → 清库 → 切分 → 入库 PG → 向量化 → 写 Chroma。

运行：在项目根目录执行 ``python scripts/build_index.py``。
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# 让脚本以 `python scripts/build_index.py` 运行时也能导入 app 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models  # noqa: F401  确保 ORM 模型注册
from app.config import settings
from app.database import Base, SessionLocal, engine
from app.services.indexing.chunker import ChunkData, chunk_java_file, walk_paths
from app.services.indexing.cloner import clone_repo
from app.services.indexing.embedder import (
    Embedder,
    build_metadata,
    get_chroma_client,
    get_or_create_collection,
)
from app.services.indexing import persist

REPO_NAME = "gson"


def _index_file(
    db,
    collection,
    embedder: Embedder,
    file_id: int,
    chunks: list[ChunkData],
    rel_path: str,
) -> None:
    """写入一批切片：先 PG 拿 id，再批量向量化并写入 Chroma。"""
    if not chunks:
        return

    parent_id_map: dict[str, int] = {}
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict] = []

    for chunk in chunks:
        row = persist.save_chunk(db, file_id, chunk, parent_id_map)
        ids.append(str(row.id))
        documents.append(chunk.enriched_text)
        metadatas.append(build_metadata(row, rel_path, "java"))

    embeddings = embedder.encode(documents)
    collection.add(
        ids=ids,
        documents=documents,
        embeddings=embeddings,
        metadatas=metadatas,
    )


def main() -> None:
    Base.metadata.create_all(bind=engine)

    target_dir = os.path.join("data", "repos", REPO_NAME)
    clone_repo(settings.repo_url, target_dir)

    client = get_chroma_client(settings.chroma_dir)
    collection = get_or_create_collection(client)
    embedder = Embedder(settings.embedding_model)

    db = SessionLocal()
    try:
        repo = persist.get_or_create_repo(db, REPO_NAME, settings.repo_url, target_dir)
        persist.clear_repo(db, repo.id, collection)
        db.commit()

        files = walk_paths(target_dir, ".java")
        total_ast = total_fixed = parse_fail = 0
        samples: list[tuple[str, ChunkData]] = []

        for idx, path in enumerate(files, start=1):
            rel_path = os.path.relpath(path, target_dir).replace("\\", "/")
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                source = fh.read()

            ast_chunks, fixed_chunks, parse_ok = chunk_java_file(path, source)
            if not parse_ok:
                parse_fail += 1

            file_row = persist.save_code_file(db, repo.id, rel_path, "java", parse_ok)
            _index_file(db, collection, embedder, file_row.id, ast_chunks, rel_path)
            _index_file(db, collection, embedder, file_row.id, fixed_chunks, rel_path)
            db.commit()

            total_ast += len(ast_chunks)
            total_fixed += len(fixed_chunks)
            if len(samples) < 3 and ast_chunks:
                samples.append((rel_path, ast_chunks[0]))

            if idx % 100 == 0:
                print(f"[进度] 已处理 {idx}/{len(files)} 文件，ast={total_ast} fixed={total_fixed}")

        repo.indexed_at = datetime.now(timezone.utc)
        db.commit()

        print("=" * 60)
        print(f"文件总数      : {len(files)}")
        print(f"AST 切片总数  : {total_ast}")
        print(f"fixed 切片总数: {total_fixed}")
        print(f"解析失败文件  : {parse_fail}")
        print(f"Chroma 文档数 : {collection.count()}")
        print("=" * 60)
        print("抽样切片：")
        for rel_path, chunk in samples:
            head = chunk.enriched_text.splitlines()[0]
            print(f"\n[{rel_path}] {chunk.chunk_type} {chunk.name} "
                  f"L{chunk.start_line}-{chunk.end_line}")
            print(f"  前缀: {head}")
            print(f"  内容: {chunk.content[:200].replace(chr(10), ' ')}...")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
