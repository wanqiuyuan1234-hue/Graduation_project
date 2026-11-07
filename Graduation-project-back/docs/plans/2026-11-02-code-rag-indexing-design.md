# Code RAG 一期（索引构建管线）后端详细设计

> 生成时间：2026-11-02
> 状态：已确认
> 技术栈：Python 3.10+ / FastAPI / SQLAlchemy / PostgreSQL(SQLite 起步) / ChromaDB / tree-sitter

## 背景与目标

面向代码仓库的检索增强问答系统，一期只做**索引构建管线**：把单个代码仓库（Gson）转换成「可检索的结构化切片 + 向量」，落地到 PostgreSQL 和 ChromaDB。检索链路与问答生成不在一期实现，仅**预留接口契约**。

### 已确认约束

- **同一仓库、同一版本**：克隆后不再提交代码，因此**不存 `commit_hash`**，也不做跨版本对比。
- **对比维度**：同仓库同版本下，对比**切分策略**（`ast` 层级切分 vs `fixed` 固定切分）和（二期）**检索策略**。
- **切分粒度**：**层级切分**——类/接口/枚举各成切片，其下方法/构造器各成子切片，靠 `parent_chunk_id` 建立父子层级。
- **接口预留**：切片浏览接口（一期可落地实现）、问答接口（仅契约，待三期）。

### 一期验收标准

1. `python scripts/build_index.py` 无报错跑通。
2. PG 的 `chunk` 表有数据、Chroma 有对应向量，二者以 `chunk.id` 一一对应。
3. 能打印若干切片的内容与行号，肉眼确认切分边界正确（类/方法完整未被切断）。
4. 前端能通过切片浏览接口读到文件列表与切片层级。

## 方案选型

| 决策点 | 选定方案 | 说明（为何不选其它） |
|-------|---------|-------------------|
| 仓库建模 | 单 `repo` 表，无 commit_hash、无 snapshot 表 | 单版本无跨版本对比，不需要版本快照 |
| 切分局粒度 | 层级切分（类/接口/枚举 + 方法/构造器父子） | 用户指定；与固定切分形成消融对照 |
| 向量存储 | 单 Chroma collection，`strategy` 放 metadata 过滤 | 单 collection + where 过滤即可按策略单独评测 |
| 原文/向量分工 | PG 存原文与元信息，Chroma 存增强文本 + 向量 + 检索元信息 | 避免大文本双份存储；改模型可重灌向量 |
| 关联方式 | PG `chunk.id` = Chroma 文档 `id` | 检索后回 PG 取原文/行号做溯源 |

## 详细设计

### 1. 整体架构与目录映射

数据流：`clone → 遍历 .java → tree-sitter AST 层级切分 → embedding → 入库(PG + Chroma)`。

一期落地的模块（对应已建目录）：

| 文件 | 职责 |
|------|------|
| `app/config.py` | 读 `.env`：REPO_URL、EMBEDDING_MODEL、CHROMA_DIR、DATABASE_URL |
| `app/database.py` | SQLAlchemy 引擎、`get_db` 依赖 |
| `app/models.py` | ORM：`Repo` / `CodeFile` / `Chunk` |
| `app/services/indexing/cloner.py` | 克隆仓库（已存在则跳过） |
| `app/services/indexing/chunker.py` | AST 层级切分 + fixed 切分 |
| `app/services/indexing/embedder.py` | sentence-transformers 向量化、读写 Chroma |
| `app/services/indexing/persist.py` | 写 PG（file + chunk），幂等重建 |
| `scripts/build_index.py` | 编排上述流程 |
| `app/routers/chunks.py` | 切片浏览接口（一期实现，只读） |
| `app/routers/query.py` | 问答接口（仅契约，返回 501） |
| `app/schemas/chunk.py`、`app/schemas/query.py` | 两端点的 Pydantic 出入参 |

### 2. 数据模型

#### 2.1 PostgreSQL

字段分「核心」与「预留」两类；预留列均可空，一期不强行要求填值。

**repo（仓库）**

| 字段 | 类型 | 必要性 |
|------|------|--------|
| `id` | BIGSERIAL PK | 主键 |
| `name` | VARCHAR(255) NOT NULL | 仓库名，前端展示 |
| `url` | VARCHAR(1024) | 克隆地址，溯源 |
| `clone_dir` | VARCHAR(1024) | 本地克隆路径 |
| `created_at` | TIMESTAMPTZ | 默认 now() |
| `indexed_at` | TIMESTAMPTZ NULL | 最近建库时间 |

> 无 `commit_hash`、无 `branch`（单版本）。

**code_file（源文件）**

| 字段 | 类型 | 必要性 |
|------|------|--------|
| `id` | BIGSERIAL PK | 主键 |
| `repo_id` | BIGINT FK → repo | 所属仓库 |
| `path` | VARCHAR(1024) NOT NULL | 相对仓库根路径，展示/溯源 |
| `language` | VARCHAR(50) | 编程语言（java） |
| `parse_ok` | BOOLEAN DEFAULT true | AST 是否解析成功（失败样本作论文素材） |
| `sha256` | CHAR(64) NULL | **[预留]** 内容哈希，供增量重建 |
| `created_at` | TIMESTAMPTZ | 默认 now() |

**chunk（切片）** —— 一期核心

| 字段 | 类型 | 必要性 |
|------|------|--------|
| `id` | BIGSERIAL PK | 切片主键，**亦为 Chroma 文档 id** |
| `file_id` | BIGINT FK → code_file | 归属文件 |
| `chunk_type` | VARCHAR(50) NOT NULL | `class/interface/enum/method/constructor`；fixed 策略时为 `fixed` |
| `name` | VARCHAR(255) NULL | 类名/方法名（fixed 可空） |
| `signature` | VARCHAR(1024) NULL | 完整签名，如 `public <T> T fromJson(String, Class<T>)` |
| `content` | TEXT NOT NULL | 切片原文 |
| `start_line` / `end_line` | INT NOT NULL | 起止行号，溯源基础 |
| `strategy` | VARCHAR(20) NOT NULL | `ast` / `fixed`，消融对比关键字段 |
| `parent_chunk_id` | BIGINT NULL FK → chunk | 层级切分父指针 |
| `chunk_index` | INT NULL | 同文件内顺序（保证展示稳定） |
| `content_hash` | CHAR(64) NULL | **[预留]** 内容哈希，去重/增量 |
| `token_count` | INT NULL | **[预留]** 三期成本/截断控制 |
| `metadata` | JSONB NULL | **[预留]** 灵活扩展 |
| `indexed_at` | TIMESTAMPTZ | 默认 now() |

索引：`chunk(file_id)`、`chunk(strategy)`、`chunk(parent_chunk_id)`。
（二期的关键词检索 `pg_trgm(name)` 索引暂不建。）

```sql
CREATE TABLE repo (
  id         BIGSERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  url        VARCHAR(1024),
  clone_dir  VARCHAR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at TIMESTAMPTZ
);

CREATE TABLE code_file (
  id         BIGSERIAL PRIMARY KEY,
  repo_id    BIGINT NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  path       VARCHAR(1024) NOT NULL,
  language   VARCHAR(50),
  parse_ok   BOOLEAN NOT NULL DEFAULT true,
  sha256     CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chunk (
  id              BIGSERIAL PRIMARY KEY,
  file_id         BIGINT NOT NULL REFERENCES code_file(id) ON DELETE CASCADE,
  chunk_type      VARCHAR(50) NOT NULL,
  name            VARCHAR(255),
  signature       VARCHAR(1024),
  content         TEXT NOT NULL,
  start_line      INT NOT NULL,
  end_line        INT NOT NULL,
  strategy        VARCHAR(20) NOT NULL,
  parent_chunk_id BIGINT REFERENCES chunk(id),
  chunk_index     INT,
  content_hash    CHAR(64),
  token_count     INT,
  metadata        JSONB,
  indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunk_file     ON chunk(file_id);
CREATE INDEX idx_chunk_strategy ON chunk(strategy);
CREATE INDEX idx_chunk_parent   ON chunk(parent_chunk_id);
```

#### 2.2 ChromaDB

```python
collection = client.get_or_create_collection(
    name="code_chunks",
    metadata={"hnsw:space": "cosine"},
)
# 每条记录：
#   id        = str(chunk.id)          # 与 PG 一一对应
#   document  = 增强文本（见 3.3）
#   embedding = bge-small-zh-v1.5 计算的 512 维向量
#   metadata  = {
#       "chunk_id":   int,
#       "file_path":  str,
#       "chunk_type": str,
#       "name":       str or None,
#       "signature":  str or None,
#       "strategy":   "ast" | "fixed",
#       "start_line": int,
#       "end_line":   int,
#       "language":   "java",
#   }
```

- `strategy` 放 metadata，做消融时 `where={"strategy": "ast"}` 单测 ast、`where={"strategy": "fixed"}` 单测 fixed。
- Chroma 不重复存原文，只存检索与展示所需的最小字段。

### 3. 层级切分算法（chunker.py）

#### 3.1 chunk_type 与父规则

| 语法节点（tree-sitter Java） | chunk_type | 父切片 |
|------------------------------|-----------|--------|
| class_declaration            | class      | 无（或外层类） |
| interface_declaration        | interface  | 无（或外层类） |
| enum_declaration             | enum       | 无（或外层类） |
| method_declaration           | method     | 所在类切片 |
| constructor_declaration      | constructor| 所在类切片 |
| 嵌套 class/interface/enum    | 同上      | 外层类切片 |

示例（Gson）：

```java
public final class Gson {                        // chunk #1  class, parent=NULL
    public String toJson(Object src) { ... }     // chunk #2  method, parent=1
    public <T> T fromJson(String json, Class<T> classOfT) {...} // #3 method, parent=1
}
```

#### 3.2 切分流程

1. `tree_sitter_java` 解析 `.java` 得语法树。
2. 遍历顶层声明节点；类/接口/枚举 → 生成一个「类型级切片」。
3. 逐子节点找方法/构造器 → 生成「成员级切片」，`parent_chunk_id` 指向该类切片。
4. 嵌套类递归处理，parent 指向外层类切片。
5. 每片提取：`name`（标识符）、`signature`（修饰符+返回类型+方法名+参数）、`start/end_line`、`content`（源码文本）、`chunk_type`、`chunk_index`（同文件按出现顺序递增）、`strategy='ast'`。
6. `fixed` 基线：按固定字数/行数滑窗切分，`strategy='fixed'`、`chunk_type='fixed'`、`name/signature/parent_chunk_id` 均空。

> 解析失败的文件：`parse_ok=false`，仅用 `fixed` 兜底切分并记录。

#### 3.3 增强文本（embedding 输入）

切片入库/送 embedding 前，拼接语义前缀后再编码；原文仍存 PG 的 `content`。

```
方法: [method: Gson] public <T> T fromJson(String json, Class<T> classOfT)
      + content
类:   [class: Gson] public final class Gson
      + content
```

`document = f"{prefix}\n{content}"`，保证「类名 + 签名」这些高价值标识词进入向量，提升二期的语义检索命中。

### 4. 建库流程（build_index.py 编排）

```
cloner.clone()              # 克隆，已存在则跳过
files = walker.find(".java")        # 递归找 Java 源文件
for f in files:
    ast_chunks, fixed_chunks = chunker.chunk(f)   # 层级 + 固定
    save code_file(f)
    for c in ast_chunks + fixed_chunks:
        vec = embedder.embed(c.enriched_text)     # bge-small → 512 维
        chroma.add(id=str(c.id), doc, vec, metadata)
        persist chunk(f, c)
print 汇总 + 抽样切片（内容/行号）
```

**幂等重建**：单版本无 commit，重跑前先清空该 `repo` 的 `code_file`/`chunk` 及 Chroma 对应文档，全量重建（研究项目最简单可靠；`sha256`/`content_hash` 预留用于将来增量优化）。

### 5. 前端接口契约

#### 5.1 切片浏览（一期实现，只读）

| 方法/路径 | 说明 |
|-----------|------|
| `GET /api/repos` | 仓库列表（当前 1 个） |
| `GET /api/repos/{repo_id}/files?page=&size=&language=` | 文件分页列表 |
| `GET /api/files/{file_id}/chunks?strategy=ast\|fixed` | 某文件切片（含层级字段） |
| `GET /api/chunks/{chunk_id}` | 单切片详情（content + 元信息） |

响应中切片含 `chunk_id / chunk_type / name / signature / start_line / end_line / parent_chunk_id / chunk_index`，返回按 `chunk_index` 排序的**扁平列表**，前端按 `parent_chunk_id` 自行组装树。

#### 5.2 问答（一期仅契约，返回 501）

`POST /api/query`

```json
// request
{ "question": "fromJson 如何反序列化数组?", "session_id": null, "strategy": "ast", "top_k": 5 }
// response（三期实现）
{
  "answer": "...",
  "citations": [
    { "chunk_id": 12, "file_path": "com/google/gson/Gson.java",
      "start_line": 100, "end_line": 108, "content": "..." }
  ],
  "latency_ms": 213
}
```

一期 `routers/query.py` 返回占位（如 501 Not Implemented），`schemas/query.py` 定好入参与出参模型，三期不改契约直接填实现。

### 6. 异常处理

| 场景 | 处理 |
|------|------|
| 仓库已存在 | `cloner` 跳过克隆，直接复用本地目录 |
| 克隆失败/网络异常 | 抛错终止，日志说明，不写半成品数据 |
| AST 解析失败 | `parse_ok=false`，`fixed` 兜底切分，仍入库 |
| embedding 模型加载/推理失败 | 抛错终止（模型较大，建议启动时只加载一次） |
| PG / Chroma 连接失败 | 抛错终止，提示检查 `.env` 与服务状态 |
| 重复建库 | 先清后建（幂等），避免重复累积 |

## 待决事项

- Embedding 模型：先用 `BAAI/bge-small-zh-v1.5`（512 维），若要换代码专用模型（如 jina/CodeBERT 系）向量维度变化需重灌 Chroma，PG 侧不受影响。
- `field` / 注解 / 文档注释是否纳入 AST 切分范围（一期默认只切类/接口/枚举/方法/构造器）。
- 类切片是否也参与二期的向量检索（默认参与；如需"只检索方法、类作上下文扩展"则二期在检索层调整）。