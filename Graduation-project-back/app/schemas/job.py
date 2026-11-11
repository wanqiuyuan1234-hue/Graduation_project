"""仓库入库任务的出入参模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RepoCreateIn(BaseModel):
    """提交入库：只需要仓库地址。"""

    url: str = Field(min_length=1, max_length=1024, description="git 仓库地址")


class JobOut(BaseModel):
    """任务状态：前端轮询这个结构展示阶段与进度。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_id: int | None = None
    repo_url: str
    status: str
    phase: str
    progress: int
    total_files: int = 0
    processed_files: int = 0
    total_chunks: int = 0
    processed_chunks: int = 0
    message: str | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class RepoCreateOut(BaseModel):
    """提交成功返回：job_id 用于轮询，repo_id 在克隆开始后才有值。"""

    job_id: int
    repo_id: int | None = None
    status: str
    phase: str
    message: str
