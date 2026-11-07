# Code RAG 一期（索引构建管线）完成总结

> Spec：rag-one
> 完成时间：2026-11-02
> 任务：11/11 全部完成

## 1. 交付内容

| 模块     | 文件                                            | 说明                                                                                                                         |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 配置     | `app/config.py`、`.env`、`.env.example`         | `APP_ENV=local\|prod` 一键切换数据库；`DB_HOST`/`DATABASE_URL` 可覆盖；`URL.create` 生成连接串                               |
| 数据库   | `app/database.py`、`app/models.py`              | engine/SessionLocal/Base/get_db；repo / code_file / chunk 三表与索引                                                         |
| 索引管线 | `app/services/indexing/cloner.py`               | 克隆仓库（执行git clone命令），已存在跳过                                                                                    |
|          | `app/services/indexing/chunker.py`              | tree-sitter AST 层级切分（class/interface/enum + method/constructor）+ fixed （总是执行，兜底）40 行/重叠 10 基线 + 增强文本 |
|          | `app/services/indexing/embedder.py`             | bge-small-zh-v1.5 批量归一化编码；Chroma 客户端与 `code_chunks` 集合（cosine）                                               |
|          | `app/services/indexing/persist.py`              | repo/file/chunk 持久化、幂等清理、`parent_temp_key → 真实 id` 回填                                                           |
| 编排     | `scripts/build_index.py`                        | clone → 清库 → 切分 → 先 PG 拿 id → embed → 写 Chroma → 汇总与抽样输出                                                       |
| 浏览接口 | `app/schemas/chunk.py`、`app/routers/chunks.py` | `GET /api/repos`、`/api/repos/{id}/files`、`/api/files/{id}/chunks?strategy=`、`/api/chunks/{id}`                            |
| 问答契约 | `app/schemas/query.py`、`app/routers/query.py`  | `POST /api/query` 返回 501，出入参契约固定                                                                                   |
| 入口     | `app/main.py`                                   | 注册上述路由                                                                                                                 |

## 2. 验证结果（T-011）

编译：`python -m py_compile` 全量 13 个文件通过。

建库（本地 `code-rag-pg`，APP_ENV=local）：

| 指标                | 结果                                                  |
| ------------------- | ----------------------------------------------------- |
| 文件总数            | 264                                                   |
| AST 切片            | 3993                                                  |
| fixed 切片          | 1943                                                  |
| 切片总数            | 5936                                                  |
| Chroma 文档数       | 5936                                                  |
| 解析失败文件        | 0                                                     |
| PG ↔ Chroma id 差集 | pg_only=0，chroma_only=0（完全一一对应）              |
| 父子关系抽样        | method id=8 `toString` L35-38，parent=6 class `Event` |

接口冒烟（TestClient）：

| 用例                                                    | 结果                                    |
| ------------------------------------------------------- | --------------------------------------- |
| `GET /api/repos`                                        | 200，返回 1 个仓库（indexed_at 已写入） |
| `GET /api/repos/{id}/files?page=1&size=5&language=java` | 200，total=264                          |
| `GET /api/files/{id}/chunks?strategy=ast`               | 200，chunk_index 升序                   |
| `GET /api/files/{id}/chunks?strategy=fixed`             | 200                                     |
| `GET /api/chunks/{id}`                                  | 200，含 file_id 与 content              |
| `POST /api/query`                                       | 501 `{"detail":"Not Implemented"}`      |
| 不存在的 file / 非法 strategy                           | 404 / 422                               |

## 3. 数据库一键切换（R-010）

- `APP_ENV=local` → host `localhost`（本机 Docker 容器 `code-rag-pg`）
- `APP_ENV=prod` → host `pg`（服务器 compose 中后端与 PG 独立容器，走服务名）
- 账号/库名/端口两边一致：`rag/rag123`、`code_rag`、`5432`
- 切换只改环境变量，不改代码；`DATABASE_URL` 默认保持注释，避免覆盖 APP_ENV 解析

## 4. 运行说明

```powershell
# 本地首次建库（Gson 仓库已克隆到 data/repos/gson）
docker start code-rag-pg
.\.venv\Scripts\python.exe scripts\build_index.py

# 启动服务
.\.venv\Scripts\uvicorn.exe app.main:app --reload
```

> 网络提示：本机无法直连 huggingface.co，首次下载 `BAAI/bge-small-zh-v1.5` 需设置镜像
> `$env:HF_ENDPOINT="https://hf-mirror.com"`（本次验证即通过该镜像下载，模型已缓存到本地）。

## 5. 遗留与后续

- 一期仅索引构建与只读浏览；检索（向量/关键词/混合/重排）与问答生成属二期、三期。
- `sha256` / `content_hash` / `token_count` / `metadata` 字段已预留，供增量重建与成本控制。
- 单仓库场景下 `clear_repo` 直接清空整个 Chroma 集合；多仓库时需改为按 metadata 过滤删除。
- Chroma 导入前已关闭遥测（`ANONYMIZED_TELEMETRY=False`），避免离线环境导入阻塞。
