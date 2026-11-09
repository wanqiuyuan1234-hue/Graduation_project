"""FastAPI 应用入口：注册切片浏览、模块浏览与问答契约路由。"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import chunks, modules, query

app = FastAPI(title="Code RAG API", version="0.1.0")

# 允许前端（默认 localhost:3000）跨域访问只读接口。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(chunks.router)
app.include_router(modules.router)
app.include_router(query.router)


@app.get("/")
def root():
    return {"message": "Code RAG backend is running"}
