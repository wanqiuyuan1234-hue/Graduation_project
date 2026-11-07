"""FastAPI 应用入口：注册切片浏览与问答契约路由。"""

from fastapi import FastAPI

from app.routers import chunks, query

app = FastAPI(title="Code RAG API", version="0.1.0")

app.include_router(chunks.router)
app.include_router(query.router)


@app.get("/")
def root():
    return {"message": "Code RAG backend is running"}
