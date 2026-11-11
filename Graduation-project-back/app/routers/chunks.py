"""切片浏览接口（只读）：仓库 → 文件 → 切片，以及仓库级聚合统计。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Chunk, CodeFile, Repo, RepoJob
from app.schemas.chunk import (
    ChunkDetailOut,
    ChunkOut,
    FileOut,
    FilePage,
    FileTreeItem,
    FileTreeOut,
    LanguageStatOut,
    LanguageStatsOut,
    RepoOut,
)
from app.services.module_view import read_git_branch

router = APIRouter(prefix="/api", tags=["chunks"])

MODULE_CHUNK_TYPES = ("class", "interface", "enum")

# 语言统计：文件数 / 模块数 / 切片数三个维度一次返回。
# 语言取 code_file.language（chunk.metadata 全为 NULL，Chroma 不在 API 进程内加载）。
_LANGUAGE_STATS_SQL = text(
    """
    SELECT
      cf.repo_id                                   AS repo_id,
      COALESCE(NULLIF(cf.language, ''), 'unknown') AS language,
      COUNT(DISTINCT cf.id)                        AS file_count,
      COUNT(*) FILTER (
        WHERE ch.strategy = 'ast'
          AND ch.chunk_type IN ('class', 'interface', 'enum')
      )                                            AS module_count,
      COUNT(ch.id)                                 AS chunk_count
    FROM code_file cf
    LEFT JOIN chunk ch ON ch.file_id = cf.id
    GROUP BY cf.repo_id, COALESCE(NULLIF(cf.language, ''), 'unknown')
    """
)

_FILE_TREE_SQL = text(
    """
    SELECT
      cf.id            AS file_id,
      cf.path          AS path,
      cf.language      AS language,
      count(ch.id)     AS chunk_count,
      COALESCE(
        max(ch.end_line) FILTER (WHERE ch.strategy = 'fixed'),
        max(ch.end_line),
        0
      )                AS line_count
    FROM code_file cf
    LEFT JOIN chunk ch ON ch.file_id = cf.id
    WHERE cf.repo_id = :repo_id
    GROUP BY cf.id, cf.path, cf.language
    ORDER BY cf.path
    """
)


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
        char_count=len(row.content or ""),
    )


def _build_repo_outs(db: Session, repos: list[Repo]) -> list[RepoOut]:
    """给仓库补上聚合统计、语言分布、状态与分支。"""
    if not repos:
        return []

    file_counts = dict(
        db.execute(
            select(CodeFile.repo_id, func.count()).group_by(CodeFile.repo_id)
        ).all()
    )
    chunk_counts = dict(
        db.execute(
            select(CodeFile.repo_id, func.count(Chunk.id))
            .join(Chunk, Chunk.file_id == CodeFile.id)
            .group_by(CodeFile.repo_id)
        ).all()
    )
    module_counts = dict(
        db.execute(
            select(CodeFile.repo_id, func.count(Chunk.id))
            .join(Chunk, Chunk.file_id == CodeFile.id)
            .where(Chunk.strategy == "ast", Chunk.chunk_type.in_(MODULE_CHUNK_TYPES))
            .group_by(CodeFile.repo_id)
        ).all()
    )
    strategy_rows = db.execute(
        select(CodeFile.repo_id, Chunk.strategy)
        .join(Chunk, Chunk.file_id == CodeFile.id)
        .distinct()
    ).all()
    strategies: dict[int, list[str]] = {}
    for repo_id, strategy in strategy_rows:
        strategies.setdefault(repo_id, []).append(strategy)

    languages: dict[int, list[LanguageStatOut]] = {}
    for row in db.execute(_LANGUAGE_STATS_SQL).mappings():
        languages.setdefault(row["repo_id"], []).append(
            LanguageStatOut(
                language=row["language"],
                file_count=row["file_count"],
                module_count=row["module_count"],
                chunk_count=row["chunk_count"],
            )
        )

    # 每个仓库最近一次入库任务（用于 syncing 状态与进度展示）
    latest_jobs: dict[int, RepoJob] = {}
    repo_ids = [repo.id for repo in repos]
    if repo_ids:
        for job in db.execute(
            select(RepoJob)
            .where(RepoJob.repo_id.in_(repo_ids))
            .order_by(RepoJob.id.desc())
        ).scalars():
            if job.repo_id is not None:
                latest_jobs.setdefault(job.repo_id, job)

    out: list[RepoOut] = []
    for repo in repos:
        job = latest_jobs.get(repo.id)
        if job is not None and job.status in ("queued", "running"):
            status = "syncing"
        elif job is not None and job.status == "failed":
            status = "failed"
        else:
            status = "synced" if repo.indexed_at else "pending"
        out.append(
            RepoOut(
                id=repo.id,
                name=repo.name,
                url=repo.url,
                clone_dir=repo.clone_dir,
                created_at=repo.created_at,
                indexed_at=repo.indexed_at,
                status=status,
                branch=read_git_branch(repo.clone_dir),
                total_files=file_counts.get(repo.id, 0),
                total_chunks=chunk_counts.get(repo.id, 0),
                total_modules=module_counts.get(repo.id, 0),
                strategies=sorted(strategies.get(repo.id, [])),
                languages=sorted(
                    languages.get(repo.id, []),
                    key=lambda s: (-s.module_count, -s.file_count, s.language),
                ),
                embedding_model=settings.embedding_model,
                job_id=job.id if job is not None else None,
                phase=job.phase if job is not None else None,
                progress=job.progress if job is not None else 0,
                error=job.error if job is not None else None,
                processed_files=job.processed_files if job is not None else 0,
                processed_chunks=job.processed_chunks if job is not None else 0,
            )
        )
    return out


@router.get("/repos", response_model=list[RepoOut])
def list_repos(db: Session = Depends(get_db)):
    """仓库列表（含模块数 / 切片数 / 文件数 / 语言分布等聚合统计）。"""
    repos = db.execute(select(Repo).order_by(Repo.id)).scalars().all()
    return _build_repo_outs(db, list(repos))


@router.get("/repos/{repo_id}/languages", response_model=LanguageStatsOut)
def list_languages(repo_id: int, db: Session = Depends(get_db)):
    """某仓库的语言统计（文件数 / 模块数 / 切片数）。"""
    if db.get(Repo, repo_id) is None:
        raise HTTPException(status_code=404, detail="repo not found")

    items = [
        LanguageStatOut(
            language=row["language"],
            file_count=row["file_count"],
            module_count=row["module_count"],
            chunk_count=row["chunk_count"],
        )
        for row in db.execute(_LANGUAGE_STATS_SQL).mappings()
        if row["repo_id"] == repo_id
    ]
    items.sort(key=lambda s: (-s.module_count, -s.file_count, s.language))
    return LanguageStatsOut(repo_id=repo_id, items=items)


@router.get("/repos/{repo_id}/tree", response_model=FileTreeOut)
def get_file_tree(repo_id: int, db: Session = Depends(get_db)):
    """某仓库的扁平文件列表；行数与切片数在查询期聚合，前端按 path 自行建树。"""
    if db.get(Repo, repo_id) is None:
        raise HTTPException(status_code=404, detail="repo not found")

    items = [
        FileTreeItem(
            file_id=row["file_id"],
            path=row["path"],
            language=row["language"],
            line_count=row["line_count"],
            chunk_count=row["chunk_count"],
        )
        for row in db.execute(_FILE_TREE_SQL, {"repo_id": repo_id}).mappings()
    ]
    return FileTreeOut(repo_id=repo_id, total=len(items), items=items)


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
