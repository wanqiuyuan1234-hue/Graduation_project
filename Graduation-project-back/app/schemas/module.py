"""模块浏览接口的出入参模型。

“模块”沿用文档定义：strategy='ast' 且 chunk_type ∈ {class, interface, enum}。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ModuleParameterOut(BaseModel):
    """从 signature 解析出的方法参数（Java 无默认值语义）。"""

    name: str
    type: str
    required: bool = True
    description: str = ""
    default: str | None = None


class ChunkBoundaryOut(BaseModel):
    """模块内部的切片边界（模块自身 + 其成员切片）。"""

    chunk_id: int
    label: str
    chunk_type: str
    start_line: int
    end_line: int
    token_count: int
    is_self: bool = False


class ModuleOut(BaseModel):
    """模块列表项。"""

    module_id: int
    repo_id: int
    name: str | None = None
    chunk_type: str
    type: str
    file_id: int
    file_path: str
    language: str | None = None
    start_line: int
    end_line: int
    line_count: int
    chunk_count: int
    parent_chunk_id: int | None = None
    summary: str
    tags: list[str] = []
    complexity: str = "low"
    ast_path: str
    indexed_at: datetime


class ModuleDetailOut(ModuleOut):
    """模块详情：额外带原文、参数与切片边界。"""

    code: str
    parameters: list[ModuleParameterOut] = []
    chunk_boundaries: list[ChunkBoundaryOut] = []


class ModulePage(BaseModel):
    """模块列表分页结果。"""

    total: int
    page: int
    size: int
    items: list[ModuleOut]
