"""切片浏览接口（只读）：仓库 → 文件 → 切片。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Chunk, CodeFile, Repo
from app.schemas.chunk import ChunkDetailOut, ChunkOut, FileOut, FilePage, RepoOut

router = APIRouter(prefix="/api", tags=["chunks"])


def _chunk_out(row: Chunk) -> ChunkOut:
    """ORM 行 → 出参（PG 主键对外暴露为 chunk_id）。"""
    return ChunkOut(
        chunk_id=row.id,
        chunk_type=row.chunk_type,
        name=row.name,
        signature=row.signature,
        start_line=row.start_line,
        end_line=row.end_line,
        strategy=row.strategy,
        parent_chunk_id=row.parent_chunk_id,
        chunk_index=row.chunk_index,
    )


@router.get("/repos", response_model=list[RepoOut])
def list_repos(db: Session = Depends(get_db)):
    """仓库列表。"""
    return db.execute(select(Repo).order_by(Repo.id)).scalars().all()


@router.get("/repos/{repo_id}/files", response_model=FilePage)
def list_files(
    repo_id: int,
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    size: int = Query(20, ge=1, le=200, description="每页条数"),
    language: str | None = Query(None, description="按语言过滤，如 java"),
    db: Session = Depends(get_db),
):
    """某仓库下的文件分页列表。"""
    if db.get(Repo, repo_id) is None:
        raise HTTPException(status_code=404, detail="repo not found")

    stmt = select(CodeFile).where(CodeFile.repo_id == repo_id)
    if language:
        stmt = stmt.where(CodeFile.language == language)

    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()
    items = (
        db.execute(stmt.order_by(CodeFile.path).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return FilePage(total=total, page=page, size=size, items=items)


@router.get("/files/{file_id}/chunks", response_model=list[ChunkOut])
def list_chunks(
    file_id: int,
    strategy: str | None = Query(None, pattern="^(ast|fixed)$"),
    db: Session = Depends(get_db),
):
    """某文件的切片列表，按 chunk_index 升序扁平返回。"""
    if db.get(CodeFile, file_id) is None:
        raise HTTPException(status_code=404, detail="file not found")

    stmt = select(Chunk).where(Chunk.file_id == file_id)
    if strategy:
        stmt = stmt.where(Chunk.strategy == strategy)
    rows = (
        db.execute(stmt.order_by(Chunk.chunk_index, Chunk.id)).scalars().all()
    )
    return [_chunk_out(row) for row in rows]


@router.get("/chunks/{chunk_id}", response_model=ChunkDetailOut)
def get_chunk(chunk_id: int, db: Session = Depends(get_db)):
    """单切片详情：元信息 + 原文。"""
    row = db.get(Chunk, chunk_id)
    if row is None:
        raise HTTPException(status_code=404, detail="chunk not found")
    return ChunkDetailOut(
        **_chunk_out(row).model_dump(),
        file_id=row.file_id,
        content=row.content,
    )
