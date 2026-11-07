"""问答接口契约占位：一期返回 501，三期填充实现。"""

from fastapi import APIRouter, HTTPException

from app.schemas.query import QueryRequest, QueryResponse

router = APIRouter(prefix="/api", tags=["query"])


@router.post(
    "/query",
    response_model=QueryResponse,
    responses={501: {"description": "一期未实现检索与生成链路"}},
)
def query(payload: QueryRequest) -> QueryResponse:
    """问答（一期仅占位）。"""
    raise HTTPException(status_code=501, detail="Not Implemented")
