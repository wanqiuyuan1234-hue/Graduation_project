"""ORM 模型：repo / code_file / chunk 三张表。"""

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.database import Base


class Repo(Base):
    """代码仓库（单版本，无 commit_hash / branch）。"""

    __tablename__ = "repo"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    url = Column(String(1024), nullable=False, unique=True)
    clone_dir = Column(String(1024))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    indexed_at = Column(DateTime(timezone=True), nullable=True)


class CodeFile(Base):
    """源文件。"""

    __tablename__ = "code_file"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    repo_id = Column(BigInteger, ForeignKey("repo.id", ondelete="CASCADE"), nullable=False)
    path = Column(String(1024), nullable=False)
    language = Column(String(50))
    parse_ok = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    sha256 = Column(CHAR(64))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Chunk(Base):
    """代码切片：类/接口/枚举/方法/构造器，或 fixed 基线切片。"""

    __tablename__ = "chunk"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    file_id = Column(BigInteger, ForeignKey("code_file.id", ondelete="CASCADE"), nullable=False)
    chunk_type = Column(String(50), nullable=False)
    name = Column(String(255))
    signature = Column(String(1024))
    content = Column(Text, nullable=False)
    start_line = Column(Integer, nullable=False)
    end_line = Column(Integer, nullable=False)
    strategy = Column(String(20), nullable=False)
    parent_chunk_id = Column(BigInteger, ForeignKey("chunk.id"))
    chunk_index = Column(Integer)
    content_hash = Column(CHAR(64))
    token_count = Column(Integer)
    # 属性名避开 SQLAlchemy 保留的 Base.metadata，列名仍为 metadata
    metadata_json = Column("metadata", JSONB)
    indexed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_chunk_file", "file_id"),
        Index("idx_chunk_strategy", "strategy"),
        Index("idx_chunk_parent", "parent_chunk_id"),
    )


class RepoJob(Base):
    """仓库入库任务：记录阶段、进度、错误与取消标记。

    状态机：queued → running → succeeded / failed / canceled
    阶段：queued → cloning → parsing → persisting → embedding → done
    """

    __tablename__ = "repo_job"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    repo_id = Column(BigInteger, ForeignKey("repo.id", ondelete="CASCADE"), nullable=True)
    repo_url = Column(String(1024), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'queued'"))
    phase = Column(String(20), nullable=False, server_default=text("'queued'"))
    progress = Column(Integer, nullable=False, server_default=text("0"))
    total_files = Column(Integer, nullable=False, server_default=text("0"))
    processed_files = Column(Integer, nullable=False, server_default=text("0"))
    total_chunks = Column(Integer, nullable=False, server_default=text("0"))
    processed_chunks = Column(Integer, nullable=False, server_default=text("0"))
    message = Column(String(500))
    error = Column(Text)
    cancel_requested = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_repo_job_repo", "repo_id"),
        Index("idx_repo_job_status", "status"),
    )
