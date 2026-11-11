"""离线建库：复用与 ``POST /api/repos`` 完全相同的入库流水线。

运行：在项目根目录执行 ``python scripts/build_index.py``。
等价的在线方式是启动服务后调用 ``POST /api/repos``。

说明：旧版本在这里自己实现了一遍 clone/切片/写库/向量化，且克隆目录存在时会跳过，
导致"重新入库"拿不到最新代码、也没有按仓库清理向量。现在统一走
``app.services.ingest.run_ingest_job``：重新克隆、全量重建、按 repo_id 清向量。
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models  # noqa: F401  确保 ORM 模型注册
from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models import RepoJob
from app.services.ingest import run_ingest_job


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_url ON repo (url)")
        )

    db = SessionLocal()
    try:
        job = RepoJob(
            repo_url=settings.repo_url, status="queued", phase="queued", progress=0
        )
        db.add(job)
        db.commit()
        job_id = job.id
    finally:
        db.close()

    print(f"[建库] 任务 {job_id} 开始：{settings.repo_url}")
    run_ingest_job(job_id)

    db = SessionLocal()
    try:
        job = db.get(RepoJob, job_id)
        if job is None or job.status != "succeeded":
            print(f"[建库] 失败：{job.error if job else '任务记录丢失'}")
            sys.exit(1)
        print("=" * 60)
        print(f"状态        : {job.status}")
        print(f"文件数      : {job.processed_files}/{job.total_files}")
        print(f"切片数      : {job.processed_chunks}/{job.total_chunks}")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
