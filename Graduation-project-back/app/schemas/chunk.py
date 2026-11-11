"""切片浏览接口的出入参模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LanguageStatOut(BaseModel):
    """按语言维度的统计：文件数 / 模块数 / 切片数。"""

    language: str
    file_count: int
    module_count: int
    chunk_count: int


class RepoOut(BaseModel):
    """仓库 + 聚合统计。

    统计字段全部由查询期聚合得到，不依赖新增列：
    - total_files / total_chunks：分别统计 code_file / chunk
    - total_modules：strategy='ast' 且 chunk_type ∈ (class, interface, enum)
    - strategies：该仓库实际出现的切片策略集合
    - status：indexed_at 为空 → pending，否则 synced
    - branch：读取 clone_dir/.git/HEAD（拿不到则为 None）
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str | None = None
    clone_dir: str | None = None
    created_at: datetime
    indexed_at: datetime | None = None

    status: str = "pending"
    branch: str | None = None
    total_files: int = 0
    total_chunks: int = 0
    total_modules: int = 0
    strategies: list[str] = []
    languages: list[LanguageStatOut] = []
    embedding_model: str | None = None

    # 最近一次入库任务（无任务时为空）；status 取值为 pending/syncing/synced/failed
    job_id: int | None = None
    phase: str | None = None
    progress: int = 0
    error: str | None = None
    processed_files: int = 0
    processed_chunks: int = 0


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


class FileTreeItem(BaseModel):
    """文件树的一行：路径 + 行数 + 切片数。"""

    file_id: int
    path: str
    language: str | None = None
    line_count: int
    chunk_count: int


class FileTreeOut(BaseModel):
    """某仓库的扁平文件列表（前端按 path 分组为树）。"""

    repo_id: int
    total: int
    items: list[FileTreeItem]


class LanguageStatsOut(BaseModel):
    """某仓库的语言统计。"""

    repo_id: int
    items: list[LanguageStatOut]


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
    # 原文长度（字符）。前端按 4 字符≈1 token 估算展示，避免加载整段内容。
    char_count: int = 0


class ChunkDetailOut(ChunkOut):
    """单切片详情，额外带归属文件与原文。"""

    file_id: int
    content: str
