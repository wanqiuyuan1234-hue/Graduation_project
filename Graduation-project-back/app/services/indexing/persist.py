"""PostgreSQL 持久化：repo / code_file / chunk 写入与幂等清理。"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Chunk, CodeFile, Repo
from app.services.indexing.chunker import ChunkData


def get_or_create_repo(db: Session, name: str, url: str, clone_dir: str) -> Repo:
    """获取或创建仓库记录（单仓库场景）。"""
    repo = db.execute(select(Repo).where(Repo.name == name)).scalar_one_or_none()
    if repo is None:
        repo = Repo(name=name, url=url, clone_dir=clone_dir)
        db.add(repo)
    else:
        repo.url = url
        repo.clone_dir = clone_dir
    db.flush()
    return repo


def clear_repo(db: Session, repo_id: int, collection) -> None:
    """幂等重建：清空该仓库的 PG 文件/切片，并清空 Chroma 集合。

    一期为单仓库场景，Chroma 直接清空全部文档；将来多仓库可按 metadata 过滤。
    """
    file_ids = list(
        db.execute(select(CodeFile.id).where(CodeFile.repo_id == repo_id)).scalars()
    )
    if file_ids:
        db.execute(delete(Chunk).where(Chunk.file_id.in_(file_ids)))
    db.execute(delete(CodeFile).where(CodeFile.repo_id == repo_id))
    db.flush()

    # 这里的 collection.get() 最多返回 100 条，后期多仓库需要完善功能
    if collection.count() > 0:
        collection.delete(ids=collection.get()["ids"])


def save_code_file(
    db: Session, repo_id: int, path: str, language: str = "java", parse_ok: bool = True
) -> CodeFile:
    """写入源文件记录，flush 以获得自增 id。"""
    row = CodeFile(repo_id=repo_id, path=path, language=language, parse_ok=parse_ok)
    db.add(row)
    db.flush()
    return row


def save_chunk(
    db: Session, file_id: int, chunk: ChunkData, parent_id_map: dict[str, int]
) -> Chunk:
    """写入切片，flush 获得 id，并维护父切片 id 映射。

    parent_id_map 将类型切片的 temp_key 映射到其数据库 id；成员切片入库时据此回填
    parent_chunk_id。调用方需保证父切片先入库（chunker 的 DFS 顺序已满足）。
    """
    parent_id = (
        parent_id_map.get(chunk.parent_temp_key) if chunk.parent_temp_key else None
    )
    row = Chunk(
        file_id=file_id,
        chunk_type=chunk.chunk_type,
        name=chunk.name,
        signature=chunk.signature,
        content=chunk.content,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        strategy=chunk.strategy,
        parent_chunk_id=parent_id,
        chunk_index=chunk.chunk_index,
    )
    db.add(row)
    db.flush()

    if chunk.temp_key:
        parent_id_map[chunk.temp_key] = row.id
    return row
