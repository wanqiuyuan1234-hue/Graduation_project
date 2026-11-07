"""问答接口的契约模型（一期仅定义，返回 501）。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    """问答请求。"""

    question: str = Field(..., min_length=1, description="用户问题")
    session_id: int | None = Field(None, description="会话 ID，三期启用多轮对话")
    strategy: Literal["ast", "fixed"] = Field("ast", description="使用的切片策略")
    top_k: int = Field(5, ge=1, le=50, description="召回条数")


class Citation(BaseModel):
    """引用来源：定位到具体切片。"""

    chunk_id: int
    file_path: str
    start_line: int
    end_line: int
    content: str


class QueryResponse(BaseModel):
    """问答响应。"""

    answer: str
    citations: list[Citation] = Field(default_factory=list)
    latency_ms: int
