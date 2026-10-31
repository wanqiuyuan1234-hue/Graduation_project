from fastapi import FastAPI

app = FastAPI(title="Code RAG API", version="0.1.0")


@app.get("/")
def root():
    return {"message": "Code RAG backend is running"}