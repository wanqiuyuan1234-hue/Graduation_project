"""模块浏览接口（只读聚合）。

“模块”= strategy='ast' 且 chunk_type ∈ {class, interface, enum}，共 700 个。
列表与详情的派生字段全部在查询期计算，不新增表/列。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Chunk, CodeFile, Repo
from app.schemas.module import (
    ChunkBoundaryOut,
    ModuleDetailOut,
    ModuleOut,
    ModulePage,
    ModuleParameterOut,
)
from app.services.module_view import (
    build_ast_path,
    build_summary,
    derive_tags,
    estimate_complexity,
    estimate_token_count,
    map_module_type,
    parse_params,
)

router = APIRouter(prefix="/api", tags=["modules"])

MODULE_CHUNK_TYPES = ("class", "interface", "enum")
_COMPLEXITY_RANK = {"high": 2, "medium": 1, "low": 0}


def _parent_name_chain(
    chunk_id: int,
    info: dict[int, tuple[str | None, int | None]],
) -> list[str]:
    """沿 parent_chunk_id 向上收集名称，返回由外到内的顺序。"""
    chain: list[str] = []
    current = chunk_id
    seen: set[int] = set()
    while current is not None and current in info and current not in seen:
        seen.add(current)
        name, parent = info[current]
        if name:
            chain.append(name)
        current = parent
    chain.reverse()
    return chain


def _subtree_sizes(rows: list[tuple[int, int | None]]) -> dict[int, int]:
    """计算每个节点的子树大小（含自身）。用迭代 DFS，避免深递归。"""
    children: dict[int, list[int]] = {}
    for chunk_id, parent_id in rows:
        if parent_id is not None:
            children.setdefault(parent_id, []).append(chunk_id)

    sizes: dict[int, int] = {}
    for root in (cid for cid, _ in rows):
        if root in sizes:
            continue
        # 逐层深入，回溯时累加
        stack: list[tuple[int, bool]] = [(root, False)]
        while stack:
            node, expanded = stack.pop()
            if node in sizes:
                continue
            if expanded:
                sizes[node] = 1 + sum(sizes.get(c, 0) for c in children.get(node, []))
            else:
                stack.append((node, True))
                for child in children.get(node, []):
                    if child not in sizes:
                        stack.append((child, False))
    return sizes


@router.get("/modules", response_model=ModulePage)
def list_modules(
    repo_id: int | None = Query(None, description="仓库 id；不传则跨仓库"),
    chunk_type: str | None = Query(
        None, pattern="^(class|interface|enum)$", description="类型过滤"
    ),
    language: str | None = Query(None, description="按语言过滤，如 java"),
    keyword: str | None = Query(None, description="按名称/路径/签名模糊匹配"),
    sort: str = Query(
        "updated",
        pattern="^(updated|name|chunks|lines|complexity)$",
        description="排序：updated/name/chunks/lines/complexity",
    ),
    page: int = Query(1, ge=1),
    size: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """模块列表（分页）。默认按最近索引时间倒序。"""
    stmt = (
        select(Chunk, CodeFile)
        .join(CodeFile, Chunk.file_id == CodeFile.id)
        .where(Chunk.strategy == "ast", Chunk.chunk_type.in_(MODULE_CHUNK_TYPES))
    )
    if repo_id is not None:
        stmt = stmt.where(CodeFile.repo_id == repo_id)
    if chunk_type:
        stmt = stmt.where(Chunk.chunk_type == chunk_type)
    if language:
        stmt = stmt.where(CodeFile.language == language)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(
            Chunk.name.ilike(like)
            | CodeFile.path.ilike(like)
            | Chunk.signature.ilike(like)
        )

    rows = db.execute(stmt).all()

    # 节点结构一次取回，用于子树计数与 ast_path
    node_stmt = select(Chunk.id, Chunk.name, Chunk.parent_chunk_id).where(
        Chunk.strategy == "ast"
    )
    if repo_id is not None:
        node_stmt = node_stmt.join(CodeFile, Chunk.file_id == CodeFile.id).where(
            CodeFile.repo_id == repo_id
        )
    node_rows = db.execute(node_stmt).all()
    info = {cid: (name, parent) for cid, name, parent in node_rows}
    sizes = _subtree_sizes([(cid, parent) for cid, _, parent in node_rows])

    items: list[ModuleOut] = []
    for chunk, code_file in rows:
        line_count = chunk.end_line - chunk.start_line + 1
        items.append(
            ModuleOut(
                module_id=chunk.id,
                repo_id=code_file.repo_id,
                name=chunk.name,
                chunk_type=chunk.chunk_type,
                type=map_module_type(chunk.chunk_type),
                file_id=code_file.id,
                file_path=code_file.path,
                language=code_file.language,
                start_line=chunk.start_line,
                end_line=chunk.end_line,
                line_count=line_count,
                chunk_count=sizes.get(chunk.id, 1),
                parent_chunk_id=chunk.parent_chunk_id,
                summary=build_summary(
                    chunk.signature,
                    chunk.chunk_type,
                    chunk.name,
                    chunk.start_line,
                    chunk.end_line,
                ),
                tags=derive_tags(code_file.path, chunk.signature, chunk.chunk_type),
                complexity=estimate_complexity(chunk.content or "", line_count),
                ast_path=build_ast_path(
                    code_file.path, _parent_name_chain(chunk.id, info)
                ),
                indexed_at=chunk.indexed_at,
            )
        )

    if sort == "name":
        items.sort(key=lambda m: (m.name or "").lower())
    elif sort == "chunks":
        items.sort(key=lambda m: (-m.chunk_count, -(m.end_line - m.start_line)))
    elif sort == "lines":
        items.sort(key=lambda m: (-m.line_count, m.name or ""))
    elif sort == "complexity":
        items.sort(
            key=lambda m: (-_COMPLEXITY_RANK.get(m.complexity, 0), -m.line_count)
        )
    else:
        items.sort(key=lambda m: (-m.indexed_at.timestamp(), m.module_id))

    total = len(items)
    start = (page - 1) * size
    return ModulePage(total=total, page=page, size=size, items=items[start : start + size])


@router.get("/modules/{module_id}", response_model=ModuleDetailOut)
def get_module(module_id: int, db: Session = Depends(get_db)):
    """模块详情：原文 + 参数 + 切片边界 + 派生展示字段。"""
    chunk = db.get(Chunk, module_id)
    if chunk is None:
        raise HTTPException(status_code=404, detail="module not found")
    if chunk.chunk_type not in MODULE_CHUNK_TYPES or chunk.strategy != "ast":
        raise HTTPException(status_code=404, detail="module not found")

    code_file = db.get(CodeFile, chunk.file_id)
    if code_file is None:
        raise HTTPException(status_code=404, detail="file not found")

    node_rows = db.execute(
        select(Chunk.id, Chunk.name, Chunk.parent_chunk_id).where(
            Chunk.strategy == "ast", Chunk.file_id == code_file.id
        )
    ).all()
    info = {cid: (name, parent) for cid, name, parent in node_rows}
    sizes = _subtree_sizes([(cid, parent) for cid, _, parent in node_rows])

    line_count = chunk.end_line - chunk.start_line + 1
    base = dict(
        module_id=chunk.id,
        repo_id=code_file.repo_id,
        name=chunk.name,
        chunk_type=chunk.chunk_type,
        type=map_module_type(chunk.chunk_type),
        file_id=code_file.id,
        file_path=code_file.path,
        language=code_file.language,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        line_count=line_count,
        chunk_count=sizes.get(chunk.id, 1),
        parent_chunk_id=chunk.parent_chunk_id,
        summary=build_summary(
            chunk.signature, chunk.chunk_type, chunk.name, chunk.start_line, chunk.end_line
        ),
        tags=derive_tags(code_file.path, chunk.signature, chunk.chunk_type),
        complexity=estimate_complexity(chunk.content or "", line_count),
        ast_path=build_ast_path(code_file.path, _parent_name_chain(chunk.id, info)),
        indexed_at=chunk.indexed_at,
    )

    # 边界：模块自身 + 所有后代切片（同一文件内）
    descendants = [
        row
        for row in db.execute(
            select(Chunk)
            .where(Chunk.strategy == "ast", Chunk.file_id == code_file.id)
            .order_by(Chunk.start_line)
        ).scalars()
        if row.id == chunk.id or _is_descendant(row.id, chunk.id, info)
    ]
    boundaries = [
        ChunkBoundaryOut(
            chunk_id=row.id,
            label=row.name or row.chunk_type,
            chunk_type=row.chunk_type,
            start_line=row.start_line,
            end_line=row.end_line,
            token_count=estimate_token_count(row.content),
            is_self=row.id == chunk.id,
        )
        for row in descendants
    ]

    # 类型级切片本身没有参数；对 class/enum 退而取构造函数的参数（仍来自 signature）
    parameters = parse_params(chunk.signature)
    if not parameters:
        for row in descendants:
            if row.chunk_type == "constructor":
                parameters = parse_params(row.signature)
                break

    return ModuleDetailOut(
        **base,
        code=chunk.content or "",
        parameters=[ModuleParameterOut(**p) for p in parameters],
        chunk_boundaries=boundaries,
    )


def _is_descendant(node_id: int, root_id: int, info: dict[int, tuple[str | None, int | None]]) -> bool:
    """沿 parent 链判断 node 是否属于 root 的子树。"""
    current = info.get(node_id, (None, None))[1]
    seen: set[int] = set()
    while current is not None and current not in seen:
        if current == root_id:
            return True
        seen.add(current)
        current = info.get(current, (None, None))[1]
    return False
