"""切片浏览接口的出入参模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RepoOut(BaseModel):
    """仓库。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str | None = None
    clone_dir: str | None = None
    created_at: datetime
    indexed_at: datetime | None = None


class FileOut(BaseModel):
    """源文件。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_id: int
    path: str
    language: str | None = None
    parse_ok: bool
    created_at: datetime


class FilePage(BaseModel):
    """文件分页结果。"""

    total: int
    page: int
    size: int
    items: list[FileOut]


class ChunkOut(BaseModel):
    """切片列表项：前端按 parent_chunk_id 自行组装树。"""

    model_config = ConfigDict(from_attributes=True)

    chunk_id: int
    chunk_type: str
    name: str | None = None
    signature: str | None = None
    start_line: int
    end_line: int
    strategy: str
    parent_chunk_id: int | None = None
    chunk_index: int | None = None


class ChunkDetailOut(ChunkOut):
    """单切片详情，额外带归属文件与原文。"""

    file_id: int
    content: str
