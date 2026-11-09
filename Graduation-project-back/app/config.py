"""应用配置：读取 .env，支持本地 / 服务器数据库连接一键切换。

切换规则（优先级从高到低）：
1. DATABASE_URL 显式给出 → 直接使用；
2. DB_HOST 显式给出 → 使用该主机；
3. 否则按 APP_ENV 解析：local → localhost，prod → pg（docker-compose 服务名）。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    """全局配置。本地与服务器仅数据库主机不同，账号/库名/端口保持一致。"""

    # 部署环境：local | prod
    app_env: str = "local"

    # 数据库连接参数（本地与服务器一致）
    db_user: str = "rag"
    db_password: str = "rag123"
    db_name: str = "code_rag"
    db_port: int = 5432
    # 显式覆盖主机（留空则按 APP_ENV 自动解析）
    db_host: str | None = None

    # 显式完整连接串（最高优先级，便于临时切换 SQLite 调试）
    database_url: str | None = None

    # 向量库与模型
    chroma_dir: str = "./data/chroma"
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    repo_url: str = "https://github.com/google/gson.git"

    # 前端跨域白名单（逗号分隔）。本地前端默认跑在 3000 端口。
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        """把逗号分隔的跨域白名单拆成列表。"""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


    @property
    def resolved_db_host(self) -> str:
        """按部署环境解析实际数据库主机。"""
        if self.db_host:
            return self.db_host
        return "localhost" if self.app_env.lower() == "local" else "pg"

    @property
    def sqlalchemy_url(self) -> str:
        """生成 SQLAlchemy 连接串。

        使用 URL.create 而非字符串拼接，避免密码含特殊字符时的转义问题。
        """
        if self.database_url:
            return self.database_url
        return URL.create(
            drivername="postgresql+psycopg2",
            username=self.db_user,
            password=self.db_password,
            host=self.resolved_db_host,
            port=self.db_port,
            database=self.db_name,
        ).render_as_string(hide_password=False)


settings = Settings()
