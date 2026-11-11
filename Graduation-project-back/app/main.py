"""FastAPI 应用入口：注册仓库入库、切片浏览、模块浏览与问答契约路由。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import chunks, modules, query, repos
from app.services.ingest import manager, recover_interrupted_jobs


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动入库 worker；把上次进程遗留的未完成任务标记失败。"""
    interrupted = recover_interrupted_jobs()
    if interrupted:
        print(f"[启动] 已将 {interrupted} 个未完成任务标记为失败（服务重启中断）")
    manager.start()
    yield


app = FastAPI(title="Code RAG API", version="0.2.0", lifespan=lifespan)

# 允许前端（默认 localhost:3000）跨域访问只读接口与入库接口。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(chunks.router)
app.include_router(modules.router)
app.include_router(repos.router)
app.include_router(query.router)


@app.get("/")
def root():
    return {"message": "Code RAG backend is running"}
