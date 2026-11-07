"""数据库连接：SQLAlchemy 引擎、会话工厂、声明式基类与请求级 Session 依赖。"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

# pool_pre_ping：容器重启后旧连接自动失效重连，避免悬空连接
engine = create_engine(settings.sqlalchemy_url, echo=False, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()


def get_db():
    """FastAPI 依赖：每个请求一个 Session，用完关闭。把 db 交给 FastAPI，让路由函数去执行"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
