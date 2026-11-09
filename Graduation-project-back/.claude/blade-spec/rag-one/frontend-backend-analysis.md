# Code RAG 前后端对比分析文档

> 分析对象：后端 `C:\no_space_demand\Graduation-project-back`，前端 `C:\no_space_demand\Graduation-project-front`
> 分析基准：以实际代码为准，辅以 `.claude/blade-spec/rag-one/result.md` 的建库验收记录
> 分析日期：2026-11-06
> **版本：v2 —— 「前端对齐后端」修订版**（v1 的思路是"后端补表补字段去满足前端抽象"；v2 反过来：页面结构、交互与主要功能不动，只把细节展示的数据源换成后端真实可得的数据）
> 核对口径：不再问"有没有同名字段"，而是问"**从 PostgreSQL 表 / Chroma 元数据 / clone_dir 源码，能否直接查、聚合或推导出来**"，逐字段归入 A/B/C/D 四档
> 数据核对方式：初稿（2026-11-06）Docker 未启动，读 Chroma 持久化库 `data/chroma/chroma.sqlite3` 的 5936 条 metadata + 精读 `chunker.py`/`persist.py`；**复核（2026-11-07）数据库已启动，直接连 PostgreSQL 逐项 `SELECT` 验证**，结论全部一致，修正记录见 §8.4
> 结论定位：v2 的设计已全部落地实施，实施清单、接口契约与实际降级表现见 `frontend-backend-integration-result.md`；本文保留为设计与判定依据（v1 分析部分不改，实测修正见 §8.4）

---

## 0. 结论摘要（先看这一段）

1. **真实数据规模（Chroma 持久化库直读 5936 条 metadata）**：264 个文件 / 5936 个切片 / **700 个类型级模块**（class 647、interface 27、enum 26）；其中 AST 切片 3993（class/interface/enum 700 + method 2955 + constructor 338），fixed 滑窗 1943。`language` 只有 `java`，`strategy` 只有 `ast` / `fixed`。前端 mock 的 25 模块 / 335 切片 / 3 仓库与真实数据完全对不上。

2. **`module.summary` 有结论：能用 `signature`，但只能算"声明式摘要"**。`chunk.signature` 在 3993 条 AST 切片上有值（fixed 无），平均 59 字符、最长 405；内容是**从节点起点到 `{` 的声明文本**（含注解、修饰符、泛型、参数、throws），**不含 Javadoc、不含方法体、不含前导注释**。清洗注解行 + 折叠空白 + 截断即可填卡片。`chunk.metadata`（用户所说的 "mdata"，表里没有叫 `mdata` 的列）**从未被写入，全部为 NULL**，不能当数据源。语义级摘要需二期从源码 Javadoc（264 个 Java 文件中有 229 个含 `/**`，共 950 个 Javadoc 块）离线提取或 LLM 生成。

3. **语言统计是 B 档，一条 SQL 即可**。唯一可靠来源是 `code_file.language`（Chroma metadata 里也有，但 PG 是主数据）。按文件 `GROUP BY`，并用 `FILTER` 同时给出模块数/切片数；只有 java 时筛选器只剩一项，属正常结果而非缺陷。

4. **D 档（现有存储与简单推导都拿不到）精确为 8 项**：`module.highlights`、`module.callChain`、`module.references`、`module.relatedModuleIds`（在线）、`parameters.default`、`repo.description`、`repo.progress` / 统计卡"同步中"、切片 `score`。这 8 项在前端**都已具备条件渲染或空态**（`length === 0` / `?? "—"`），后端返回空数组、0 或空串即可自然降级，**页面结构与交互无需改动**（详见 4.5）。

5. **A/B/C 档约占字段总量的 80%**：

   - **A 档（直接给）**：`id/name/path/language/start_line/end_line/code/indexed_at/url/clone_dir` 等，改返回结构即可；
   - **B 档（查询聚合）**：模块数、切片数、语言统计、每文件切片数、模块子树切片数、策略集合、仓库状态、文件行数（`max(end_line)`）；
   - **C 档（推导变通）**：`summary`（signature 清洗）、`tags`（路径 + 注解 + implements）、`complexity`（行数 + 分支关键字计数）、`parameters`（解析 signature）、`ast_path`（`parent_chunk_id` 递归）、`token_count`（字符估算）、`branch`（读 `.git/HEAD`）。

6. **前端必须改的只有 4 处细节**：`Language` 补 `java`（否则 `LANGUAGE_META['java']` 为 undefined 直接运行时崩）、`ModuleType` 补 `interface`/`enum`、`sliceStrategy` 从"5 选 1 联合类型"改为普通字符串、删掉切片预览里的伪"相似度"。其余组件已有空态，返回空数据即可。

7. **前端目前仍是零后端调用**：全仓 `fetch` 只命中两个 Next.js 自己的 Route Handler（`/api/chat`、`/api/retrieve`），没有 `NEXT_PUBLIC_API_BASE`、没有 API 封装层、后端也没有 CORS。这是所有对齐工作的前置项。

8. **拉取仓库仍是纯 UI 假动作**：`handleSubmit()` 只做 `setOpen(false)` + `toast.success("仓库拉取已开始")`，后端没有写接口、没有任务表，`scripts/build_index.py` 硬编码单仓库 `gson`。该功能的完整设计保留在第 5 节。

9. **⚠️ `persist.py` L38 的 TabError 仍是阻断项**（实测 `py_compile` 失败）：当前代码无法重建库，与本次"前端对齐"无关但必须先修，见 8.2 #0。

10. **2G2核下，向量化进程与 API 进程必须分离**（预算与参数见第 6 节）：`torch + bge-small + batch` 峰值约 700–1000MB，若与 FastAPI、PG 同进程/同容器，2G 会 OOM。

---

## 1. 现状概述

### 1.1 后端（Python / FastAPI / PostgreSQL / ChromaDB）

**技术栈与目录**

| 层     | 文件                                           | 说明                                                                                    |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| 配置   | `app/config.py`                                | pydantic-settings 读 `.env`，`APP_ENV=local/prod` 解析 DB 主机；`URL.create` 生成连接串 |
| 数据库 | `app/database.py`                              | `create_engine(pool_pre_ping=True)`、`SessionLocal`、`Base`、`get_db` 依赖              |
| ORM    | `app/models.py`                                | `repo` / `code_file` / `chunk` 三表                                                     |
| 路由   | `app/routers/chunks.py`                        | 4 个只读浏览接口                                                                        |
| 路由   | `app/routers/query.py`                         | `POST /api/query` 固定返回 501                                                          |
| 契约   | `app/schemas/chunk.py`、`app/schemas/query.py` | Pydantic 出入参                                                                         |
| 索引   | `app/services/indexing/cloner.py`              | `git clone --depth 1`，目录已存在则跳过                                                 |
| 索引   | `app/services/indexing/chunker.py`             | tree-sitter-java AST 层级切分 + fixed 40/10 滑窗                                        |
| 索引   | `app/services/indexing/embedder.py`            | sentence-transformers `bge-small-zh-v1.5` + Chroma `code_chunks`（cosine）              |
| 索引   | `app/services/indexing/persist.py`             | repo/file/chunk 落库、幂等清理、父 id 回填                                              |
| 编排   | `scripts/build_index.py`                       | 离线全流程脚本（唯一入口，非 HTTP）                                                     |
| 入口   | `app/main.py`                                  | 注册两个 router，**无 CORS、无中间件、无鉴权**                                          |

**三张表结构**（`app/models.py`）

`repo`（L22-32）：`id, name, url, clone_dir, created_at, indexed_at`
`code_file`（L35-46）：`id, repo_id, path, language, parse_ok, sha256, created_at`
`chunk`（L49-73）：`id, file_id, chunk_type, name, signature, content, start_line, end_line, strategy, parent_chunk_id, chunk_index, content_hash, token_count, metadata(JSONB), indexed_at`

**关键实现事实**

- 只遍历 `.java`（`chunker.walk_paths(root, ".java")`），`language` 恒为 `"java"`（`scripts/build_index.py` L93）。
- AST 只切 `class_declaration` / `interface_declaration` / `enum_declaration` → 类型级；`method_declaration` / `constructor_declaration` → 成员级，`parent_chunk_id` 关联（`chunker.py` L20-28、L164-177）。字段/注解/局部类不切。
- fixed 基线**总是同时生成**：40 行窗口、10 行重叠（`chunker.py` L31-32），作为消融对照组。
- `chunk.content` 是节点原文，**类级 chunk 已包含其内部所有方法体**。
- `chunk.token_count`、`content_hash`、`code_file.sha256`、`chunk.metadata` 四个字段**已建但从未写入**（`persist.save_code_file` / `persist.save_chunk` 均未赋值）。
- `Chroma` 单集合 `code_chunks`，metadata 只写 `chunk_id/file_path/chunk_type/strategy/start_line/end_line/language/name/signature`（`embedder.build_metadata` L49-59），**没有 `repo_id`**。
- 建库是单仓库硬编码：`REPO_NAME = "gson"`、`target_dir = data/repos/gson`（`build_index.py` L29、L67），`clear_repo` 直接清空整个 Chroma 集合（L25-42）。

**数据规模（已核实）**

| 指标                     | 值                 | 来源                        |
| ------------------------ | ------------------ | --------------------------- |
| Java 文件数              | 264                | 本地 `data/repos/gson` 实测 |
| Java 源码体积            | 2.08 MB            | 本地实测                    |
| 仓库总体积               | 2.41 MB / 313 文件 | 本地实测                    |
| AST 切片                 | 3993               | `result.md`                 |
| fixed 切片               | 1943               | `result.md`                 |
| 切片总数 / Chroma 文档数 | 5936 / 5936        | `result.md`                 |
| 解析失败文件             | 0                  | `result.md`                 |
| Chroma 持久化目录体积    | 64.6 MB            | 本地 `data/chroma` 实测     |
| 仓库记录数               | 1（gson）          | `result.md` 冒烟结果        |

> 说明：本机 Docker 当前未启动（`docker ps` 连不上 `dockerDesktopLinuxEngine`），因此 PG 行数未实时查询；切片规模取自 `result.md` 的建库输出，并与 `data/` 磁盘实测、Chroma 持久化库直读结果三方对齐。

**真实数据核对（v2 新增，直接读 `data/chroma/chroma.sqlite3`）**

| 核对项                     | 实测结果                                                                                                                                    | 对"前端对齐"的含义                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 切片类型分布               | class 647、interface 27、enum 26、method 2955、constructor 338、fixed 1943                                                                  | "模块"只能取前三种，共 **700** 个；`3993` 是 AST 切片总数，不是模块数 |
| 切片总数                   | 5936（Chroma 与 `result.md` 一致）                                                                                                          | 统计卡"总切片数"直接用 `count(chunk)`                                 |
| `signature` 覆盖           | 3993 条有值（fixed 的 1943 条为 NULL）                                                                                                      | 只能给 AST 类型/方法切片做摘要；fixed 需按行号兜底                    |
| `signature` 长度           | 平均 59 字符，最长 405                                                                                                                      | 卡片 `line-clamp-2` 约容纳 100–120 字符，必须截断                     |
| `signature` 内容特征       | 2502 条含 `@` 注解、248 条含 `extends/implements`、37 条含 `{`（注解数组初始化）                                                            | 做 summary 时要先剔除注解行；不能简单按第一个 `{` 截断                |
| `signature` 是否含 Javadoc | **不含**。class 级切片里 124/647 出现 `/**`，那是**类内部成员的注释**；method 级 3/2955                                                     | 库内没有"类/方法自己的文档注释"，语义摘要需要另取源码                 |
| 源码 Javadoc 存量          | 264 个 Java 文件里 229 个含 `/**`，共 950 块                                                                                                | 二期可从 `clone_dir` 提取，作为 `metadata.javadoc_summary`            |
| `chunk.metadata`           | 列存在（ORM 属性 `metadata_json`），但 `persist.save_chunk` **从未赋值**；**已实测 `count(*) filter (where metadata is null)` = 5936/5936** | 用户所说的 "mdata" 目前没有数据；不能作为摘要来源                     |
| Chroma metadata 键         | 仅 9 个：`chunk_id/file_path/chunk_type/name/signature/strategy/start_line/end_line/language`，**无 `repo_id`**                             | 语言可从 `code_file.language` 取；多仓库时必须补 `repo_id`            |
| Chroma `document`          | 是 `enriched_text`（形如 `[class: X] ...`），**不是** PG 的原始 `content`                                                                   | 语义摘要不能拿 Chroma document 直接当代码原文                         |
| 语言                       | 只有 `java`                                                                                                                                 | 语言统计返回单值属正常；前端枚举必须补 `java`                         |

### 1.2 前端（Next.js 16 / React 19 / Zustand / 全静态数据）

**技术栈**

- Next.js 16 App Router，`output: "standalone"`；`next.config.ts` 开启 `typescript.ignoreBuildErrors: true`（类型错误不阻断构建，**这会掩盖第 3 条枚举不兼容问题**）。
- 状态管理 Zustand + `persist`（localStorage），存会话、主题、当前仓库（`src/lib/rag/store.ts`）。
- 无真实后端调用；数据全部来自 `src/lib/rag/mock-data.ts`（61KB）。

**视图结构**（`src/app/page.tsx` L58-65）

| ViewId      | 组件                 | 说明                         |
| ----------- | -------------------- | ---------------------------- |
| `modules`   | `module-browser.tsx` | 模块卡片列表（主页面）       |
| `detail`    | `module-detail.tsx`  | 模块详情（从卡片进入）       |
| `chat`      | `chat-page.tsx`      | 对话问答（主页面，本期不做） |
| `knowledge` | `knowledge-base.tsx` | 知识库（主页面）             |

**所有业务数据的真实来源**

| 前端常量                           | 位置                  | 消费方                                                                                 |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `REPOS`（3 条）                    | `mock-data.ts` L11-60 | `app-sidebar` L64、`app-header` L33/L159、`module-browser` L184、`knowledge-base` L146 |
| `MODULES`（**17 条**）             | L247-1158             | `module-browser` L86、`module-detail` L67、`command-palette`                           |
| `SOURCE_CHUNKS`（**5 条**）        | L1159-1280            | `store.ts` L3、`/api/retrieve`、chat 引用                                              |
| `FILE_TREE` / `FILE_TREES_BY_REPO` | L1461-1857            | `knowledge-base` L539                                                                  |
| `CHAT_SESSIONS`                    | L1282-1460            | `store.ts` L202 初始会话                                                               |
| `SLICE_STRATEGIES`（5 种）         | L62-113               | 拉取仓库弹窗 L391                                                                      |
| `CHAT_SUGGESTIONS`                 | L1876-1881            | 对话页                                                                                 |

> 注意：`mock-data.ts` 里还残留 `ChatPanel` / `SearchBar` / `ChatService` / `useChatStore` 等一整段**未被引用的演示组件代码**（L115-1158 区间混杂），属于 AI 生成残留，不参与运行，但会让"这份文件到底是不是 mock 数据"产生误判。

### 1.3 两端数据抽象对照（问题根源）

```
后端：repo → code_file → chunk(语法节点)
                          ├─ ast:  class/interface/enum（父）
                          │        └─ method/constructor（子）
                          └─ fixed: 40 行滑窗

前端：repo → CodeModule(产品化模块) → chunkBoundaries
                     ├─ summary / highlights / tags
                     ├─ complexity / parameters
                     ├─ callChain / references / relatedModuleIds
                     └─ code / astPath / lineCount / chunkCount
```

后端能回答"这个类在哪几行、原文是什么、它下面有哪些方法"；
前端想问"这个模块是干什么的、有哪些亮点、谁调用它、复杂度多高、参数说明是什么"。
后者需要**额外的语义增强**，不是 SQL 能直接查出来的。

---

## 2. 接口清单

### 2.1 后端已实现的 HTTP 接口

注册入口：`app/main.py` L7-10（`chunks.router` + `query.router`）。

| #   | 方法 | 路径                          | 入参                                                    | 返回                                                                                                   | 位置                                                                                                                                                       |
| --- | ---- | ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GET  | `/`                           | —                                                       | `{"message":"Code RAG backend is running"}`                                                            | `main.py` L13-16                                                                                                                                           |
| 2   | GET  | `/api/repos`                  | 无                                                      | `RepoOut[]`：`id, name, url, clone_dir, created_at, indexed_at`（**无分页、无统计**）                  | `chunks.py` L31-34                                                                                                                                         |
| 3   | GET  | `/api/repos/{repo_id}/files`  | `page≥1`（默认1）、`size 1..200`（默认20）、`language?` | `{total, page, size, items: FileOut[]}`；`FileOut = id, repo_id, path, language, parse_ok, created_at` | `chunks.py` L37-61                                                                                                                                         |
| 4   | GET  | `/api/files/{file_id}/chunks` | `strategy?` 正则 `^(ast                                 | fixed)$`                                                                                               | `ChunkOut[]`（扁平数组，按 `chunk_index, id` 升序）：`chunk_id, chunk_type, name, signature, start_line, end_line, strategy, parent_chunk_id, chunk_index` |
| 5   | GET  | `/api/chunks/{chunk_id}`      | 路径参数                                                | `ChunkDetailOut = ChunkOut + file_id + content`                                                        | `chunks.py` L83-93                                                                                                                                         |
| 6   | POST | `/api/query`                  | `QueryRequest{question, session_id?, strategy, top_k}`  | **501**（仅契约）                                                                                      | `query.py` L10-17                                                                                                                                          |

**契约模型要点**（`app/schemas/chunk.py`、`query.py`）

- 全部 **snake_case**；前端类型全部 **camelCase**，字段名需适配层转换。
- `ChunkOut` 不含 `file_id`、不含 `content`、不含 `token_count`、不含 `repo_id`。
- `FileOut` 不含 `line_count`、不含 `chunk_count`。
- `Citation` = `{chunk_id, file_path, start_line, end_line, content}`；无 `score / rerankedScore / language / moduleId / tokenCount`。

### 2.2 前端"接口"（其实是 Next.js Route Handler，与后端无关）

| 方法 | 路径            | 真实行为                                                                                                 | 位置                                   |
| ---- | --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| GET  | `/api`          | 返回 `{"message":"Hello, world!"}`                                                                       | `src/app/api/route.ts`                 |
| POST | `/api/chat`     | 调 `z-ai-web-dev-sdk` 的 LLM，返回 `{content}`；**`body.repoId` 读了但完全没用**；无检索、无引用、非流式 | `src/app/api/chat/route.ts` L46-90     |
| POST | `/api/retrieve` | **假检索**：循环取 `SOURCE_CHUNKS[i % 5]`，分数用 `0.86 - i*0.035 ± 随机抖动` 编造                       | `src/app/api/retrieve/route.ts` L41-63 |

前端引用/检索调试面板的所有 `score`、`rerankedScore`、`latencyMs`、`vectorWeight/keywordWeight` 都由客户端或这两个假接口生成（`chat-page.tsx` L110-135、L893-931）。

### 2.3 前后端调用关系

| 期望                                   | 实际                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| 前端 → 后端 `http://<host>:8000/api/*` | **0 次调用**；无 `NEXT_PUBLIC_API_BASE`、无 axios/fetch 封装                     |
| 浏览器跨域                             | 后端 `main.py` **未注册 CORSMiddleware**，前端 3000 → 后端 8000 会被浏览器拦截   |
| 分页                                   | 后端 `size ≤ 200`；前端文件树一次性要全量（264 文件需 2 页手动拼接，或加树接口） |

### 2.4 契约不一致清单（结构层面）

| 项         | 后端                                          | 前端                                                   | 影响                                                |
| ---------- | --------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| 命名风格   | snake_case                                    | camelCase                                              | 需 adapter 或后端 alias                             |
| 语言枚举   | 只有 `java`                                   | 7 种且**无 java**                                      | **运行时崩溃**（`LANGUAGE_META['java']` undefined） |
| 类型枚举   | class/interface/enum/method/constructor/fixed | function/class/component/hook/util/service/config/page | 无法直接映射                                        |
| 仓库统计   | 无                                            | 6 个统计字段                                           | 卡片大面积空缺                                      |
| 文件统计   | 无 line_count/chunk_count                     | 文件树每行都要显示                                     | 每个文件再发一次请求才能算                          |
| 切片 token | 字段存在但**未写值**                          | 详情页显示 `tok`、预览显示 tokens                      | 恒为 0/空                                           |
| 切片分数   | 无（检索未实现）                              | 切片预览显示"相似度 %"                                 | 语义错误：未检索不应有相似度                        |

> **v2 补充**：上表是"当前接口结构"层面的差异，不是"后端拿不到"。其中仓库统计、文件 line_count/chunk_count、切片 token 都可在查询期聚合/估算（B/C 档，见 §4.3、§4.4.6）；只有"切片分数"是真正无法提供的（D8）。命名风格用前端适配层解决，不改后端契约。

---

## 3. 字段级对照表（v1 原始记录，保留）

> 本节保留 v1 的逐字段比对，用于"前端到底展示了什么、数据从哪来"的溯源。
> **v2 的可得性判定（A/B/C/D）与取数规则以第 4 节为准**；本节图例中 ❌/⚠️ 只表示"当前无接口/无直接字段"，不代表后端拿不到（很多已在第 4 节归为 B/C 档）。

图例：✅ 可直接提供 ｜ ⚠️ 需聚合/推导/改造后可提供 ｜ ❌ 当前接口无对应字段（不代表无法推导）

### 3.1 模块浏览页（`module-browser.tsx` + `module-card.tsx`）

数据来源：`MODULES` / `REPOS`（L86、L184），无接口。

| 页面位置     | 字段                             | 前端数据来源                          | 后端是否可提供 | 缺口原因 / 映射                                                                              |
| ------------ | -------------------------------- | ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| 顶部仓库下拉 | `Repo.name`                      | `REPOS[].name`                        | ✅              | `GET /api/repos` 的 `name`                                                                   |
| 顶部仓库下拉 | `Repo.id`                        | `REPOS[].id`                          | ✅              | `repo.id`（前端需从 string 改 number 或做字符串化）                                          |
| 顶部统计     | 模块总数                         | `MODULES.length` / `getModulesByRepo` | ⚠️              | 需定义"模块"= `strategy=ast` 且 `chunk_type∈{class,interface,enum}`，并做计数聚合            |
| 顶部统计     | 语言数量                         | 模块 `language` 去重                  | ⚠️              | 后端只有 java，数量恒为 1；且需 join file→chunk                                              |
| 卡片头       | `module.type`                    | 硬编码 `ModuleType`                   | ⚠️              | 后端 `chunk_type` 只有 5 种，且枚举集合不同（需映射表）                                      |
| 卡片头       | `module.language`                | 硬编码                                | ⚠️→❌            | `code_file.language="java"` 有数据，但**前端枚举无 java**；chunk 表无 language 字段，需 join |
| 卡片头       | 仓库徽标 `repo.name`             | `getRepoById(module.repoId)`          | ✅              | chunk→file→repo 两级 join                                                                    |
| 卡片头       | `module.chunkCount`              | 硬编码（3/2/1…）                      | ⚠️              | 需按 `parent_chunk_id` 统计子树切片数；当前无聚合接口                                        |
| 卡片标题     | `module.name`                    | 硬编码                                | ✅              | `chunk.name`（类型级切片）                                                                   |
| 卡片路径     | `module.filePath`                | 硬编码                                | ✅              | `code_file.path`                                                                             |
| 卡片摘要     | `module.summary`                 | 硬编码                                | ❌              | 无字段、无接口；需 LLM 生成或人工标注                                                        |
| 卡片亮点     | `module.highlights`              | 硬编码                                | ❌              | 同上                                                                                         |
| 卡片标签     | `module.tags`                    | 硬编码                                | ❌              | 无字段；可用包名/注解规则推导"部分"标签（如 `java.util`），语义标签不可得                    |
| 卡片复杂度环 | `module.complexity`              | 硬编码 low/medium/high                | ❌（可推导）    | 无字段；可用 LOC + `chunk` 数量 + 大括号/分支数启发式推导，但非真实圈复杂度                  |
| 排序         | `updated`                        | `module.updatedAt` 字符串             | ⚠️              | 只有 `code_file.created_at` / `chunk.indexed_at`（同一批建库，全相同），排序无意义           |
| 排序         | `name`                           | 前端排序                              | ✅              | 客户端排序即可                                                                               |
| 排序         | `chunks`                         | 前端排序                              | ⚠️              | 依赖 chunkCount 聚合                                                                         |
| 排序         | `lines`                          | `module.lineCount`                    | ⚠️              | 需 `code_file.line_count`（当前无该列）或 `max(chunk.end_line)`                              |
| 排序         | `complexity`                     | 前端排序                              | ❌              | 复杂度本身不可得                                                                             |
| 筛选         | 语言                             | `module.language`                     | ⚠️→❌            | 同语言枚举问题                                                                               |
| 筛选         | 类型                             | `module.type`                         | ⚠️              | 需枚举映射                                                                                   |
| 筛选         | 关键词（name/path/summary/tags） | 前端 filter                           | ⚠️              | name/path 可服务端过滤；summary/tags 不存在                                                  |
| 底部汇总     | 总切片数                         | `sum(module.chunkCount)`              | ⚠️              | 需 `count(chunk)` 聚合                                                                       |

### 3.2 模块详情页（`module-detail.tsx`）

| 页面位置     | 字段                                                      | 前端来源                      | 后端可提供      | 缺口原因                                                                                                    |
| ------------ | --------------------------------------------------------- | ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 面包屑       | 仓库名/分支                                               | `getRepoById` / `repo.branch` | 仓库名 ✅ 分支 ❌ | `repo` 表无 `branch` 列                                                                                     |
| 头部         | 类型/语言                                                 | `CodeModule`                  | ⚠️               | 枚举映射问题                                                                                                |
| 头部         | 复杂度标签                                                | `COMPLEXITY_META`             | ❌               | 无字段                                                                                                      |
| 头部         | `summary`                                                 | 硬编码                        | ❌               | 无字段                                                                                                      |
| 头部         | `tags`                                                    | 硬编码                        | ❌               | 无字段                                                                                                      |
| 头部         | `filePath`                                                | 硬编码                        | ✅               | `code_file.path`                                                                                            |
| 代码 Tab     | `module.code`（整段源码）                                 | 硬编码字符串                  | ✅               | 两条路径：① 用类级 `chunk.content`（已含方法体）；② 新增 `GET /api/files/{id}/content` 读 `clone_dir` 全文  |
| 代码 Tab     | 行高亮（chunkBoundaries）                                 | 硬编码                        | ✅               | `chunk.start_line/end_line`                                                                                 |
| 元数据 Tab   | `parameters[]`（name/type/required/description/default）  | 硬编码                        | ⚠️（部分）       | `chunk.signature` 含参数原文，可解析"名称+类型"；`required/description/default` **不可靠**，属 Javadoc 语义 |
| 元数据 Tab   | `lineCount`                                               | 硬编码                        | ⚠️               | 无 `line_count` 列；可用 `max(end_line)` 或建库时统计                                                       |
| 元数据 Tab   | `chunkCount`                                              | 硬编码                        | ⚠️               | 子树计数                                                                                                    |
| 元数据 Tab   | `updatedAt`                                               | 硬编码                        | ⚠️               | `indexed_at`（仓库级）                                                                                      |
| 元数据 Tab   | `astPath`                                                 | 硬编码 `Program > …`          | ⚠️（弱）         | 无字段；可由 `parent_chunk_id` 链 + `chunk_type/name` 拼出 `file > class > method`，但不是精确 AST 路径     |
| 调用链 Tab   | `callChain[]`（incoming/outgoing）                        | 硬编码                        | ❌               | 无调用图；需 tree-sitter 抽 `method_invocation`/`object_creation_expression` 并建边表（跨文件还需符号解析） |
| 切片边界 Tab | `chunkBoundaries[]`（chunkId/start/end/label/tokenCount） | 硬编码                        | ✅/⚠️             | id、行号、label（`name`）可得；**`tokenCount` 为 NULL**                                                     |
| 右侧栏       | `relatedModuleIds`                                        | 硬编码                        | ❌               | 无关联关系数据                                                                                              |
| 右侧栏       | `references[]`（moduleId/line/snippet/kind）              | 硬编码                        | ❌               | 无引用表；需全局符号索引                                                                                    |

### 3.3 知识库页（`knowledge-base.tsx`）

| 区块         | 字段                                                    | 前端来源                                   | 后端可提供  | 缺口原因                                                                                                   |
| ------------ | ------------------------------------------------------- | ------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| 统计卡       | 仓库数                                                  | `REPOS.length`                             | ✅           | `GET /api/repos` 长度                                                                                      |
| 统计卡       | 总模块数                                                | `sum(REPOS[].totalModules)` = **25（假）** | ⚠️           | 需聚合；且前端这个 25 与 `MODULES` 17 条自相矛盾                                                           |
| 统计卡       | 总切片数                                                | `sum(REPOS[].totalChunks)` = **335（假）** | ⚠️           | 需 `count(chunk)`；真实为 5936                                                                             |
| 统计卡       | 同步中数量                                              | `REPOS.filter(status==="syncing")`         | ❌           | 无任务/状态表；一期可恒为 0                                                                                |
| 仓库卡       | `repo.name`                                             | `REPOS`                                    | ✅           | `repo.name`                                                                                                |
| 仓库卡       | `repo.url`                                              | `REPOS`                                    | ✅           | `repo.url`                                                                                                 |
| 仓库卡       | `repo.branch`                                           | `REPOS`                                    | ❌           | 无列；克隆后用 `git rev-parse --abbrev-ref HEAD` 可回填                                                    |
| 仓库卡       | `repo.status`（synced/syncing/failed/pending）          | `REPOS`                                    | ❌（可推导） | 无状态列；一期用 `indexed_at` 推导：非空→synced，空→pending；failed 需任务表                               |
| 仓库卡       | `repo.description`                                      | `REPOS`                                    | ❌           | 无列；可加 `description` 由用户填写                                                                        |
| 仓库卡       | `repo.lastSyncAt`                                       | 硬编码                                     | ⚠️           | `repo.indexed_at` 可得，需格式化 + 时区                                                                    |
| 仓库卡       | `repo.progress`                                         | 硬编码 64                                  | ❌           | 无任务进度；P1 任务表后可提供                                                                              |
| 仓库卡       | `repo.embeddingModel`                                   | 硬编码 `bge-m3`                            | ⚠️           | 无 per-repo 列；只能返回全局 `settings.embedding_model`（`bge-small-zh-v1.5`），与前端展示的 `bge-m3` 不符 |
| 仓库卡       | `repo.sliceStrategy`                                    | 硬编码单选                                 | ⚠️           | 无 repo 级列；`chunk.strategy` 有 `ast/fixed` 两种，实际是**双策略**，与前端"单选 5 种"模型冲突            |
| 仓库卡       | `totalModules / totalChunks / totalFiles`               | 硬编码                                     | ⚠️           | 需 3 个聚合；`totalFiles` 可通过 `/files` 的 `total` 拿到，但要额外请求                                    |
| 操作         | 查看文件树                                              | 仅切 view                                  | ✅           | 无请求                                                                                                     |
| 操作         | 重新同步                                                | 仅 toast                                   | ❌           | 无接口                                                                                                     |
| 操作         | 导出 / 删除                                             | 仅 toast                                   | ❌           | 无接口                                                                                                     |
| 拉取仓库弹窗 | `url / branch / embedding / strategy / strategyOptions` | 表单本地 state                             | ❌ 全部      | **无 POST 接口**；且策略/模型选项与后端能力不符（见 5.1）                                                  |
| 文件树       | 目录 `name/path/children`                               | `FILE_TREES_BY_REPO`                       | ✅           | `code_file.path` 按 `/` 分组，客户端建树                                                                   |
| 文件树       | 文件 `language`                                         | 硬编码枚举                                 | ⚠️→❌         | 值为 `java`，前端枚举无 java                                                                               |
| 文件树       | 文件 `chunkCount`                                       | 硬编码                                     | ⚠️           | `count(chunk where file_id)`，需聚合                                                                       |
| 文件树       | 文件 `lineCount`                                        | 硬编码                                     | ❌           | 无列；建库时可写入                                                                                         |
| 文件树       | 目录 `chunkCount`                                       | 硬编码                                     | ⚠️           | 子文件求和（客户端或服务端）                                                                               |
| 切片预览     | 切片 `label`                                            | 由文件名合成                               | ⚠️           | ast 有 `name`；fixed 无 name → 只能显示 `Lx-Ly`                                                            |
| 切片预览     | `startLine/endLine`                                     | `synthesizeChunks` 伪造                    | ✅           | `chunk.start_line/end_line`                                                                                |
| 切片预览     | `tokens`                                                | 伪造 `120 + i*180`                         | ⚠️→❌         | 字段存在但**从未写入**                                                                                     |
| 切片预览     | `score`（相似度 %）                                     | 伪造 `0.92 - i*0.07`                       | ❌           | 非检索场景，不应存在该指标（建议删 UI）                                                                    |
| 切片预览     | 切片原文                                                | 未展示                                     | ✅           | `chunk.content`（经 `/api/chunks/{id}`）                                                                   |

### 3.4 对话问答页（`chat-page.tsx`，本期只做差距记录）

| 能力         | 前端现状                                                                 | 后端现状                                      | 结论     |
| ------------ | ------------------------------------------------------------------------ | --------------------------------------------- | -------- |
| 问答生成     | `/api/chat` 调外部 SDK，非流式 + 客户端打字机                            | `POST /api/query` 501                         | 三期     |
| 检索         | `/api/retrieve` 循环取 5 条 mock + 随机分                                | 无检索实现（`services/retrieval/*` 为空文件） | 二期     |
| 引用         | `SourceChunk` 富结构（score/rerankedScore/moduleId/language/tokenCount） | `Citation` 只有 5 个字段                      | 需扩契约 |
| 检索调试面板 | topK/rerank/vectorWeight/keywordWeight/rerankModel/latency               | `QueryRequest` 只有 `top_k`/`strategy`        | 需扩契约 |
| 会话         | localStorage（`store.ts` persist）                                       | 无 session/message 表                         | 三期     |
| 仓库上下文   | `repoId` 传给 `/api/chat`，但路由内**未使用**                            | 无                                            | 需修     |

### 3.5 字段归类小结

| 类别                                     | 数量（按字段计，约） | 代表字段                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 后端完全无法提供（无表字段、无接口）  | 16                   | `summary`、`highlights`、`tags`、`complexity`、`parameters`（语义部分）、`callChain`、`references`、`relatedModuleIds`、`astPath`、`repo.branch`、`repo.description`、`repo.embeddingModel`、`repo.progress`、切片 `score`、同步/删除/导出、拉取仓库 |
| B. 后端有数据，但接口未开放 / 结构对不上 | 14                   | 文件全文、`line_count`、`chunk_count`、`total_*` 聚合、`repository.status`、`lastSyncAt`、`language=java` 枚举、`token_count`（字段空）、分页形态、snake/camel、`file_id` 缺失、`repo_id` 缺失（Chroma metadata）                                    |
| C. 可由现有数据组合/计算                 | 9                    | 文件树、模块列表（类型级切片）、切片边界、模块代码（类 chunk）、模块行数（max end_line）、模块切片数（父子计数）、目录切片数、lastSyncAt、状态初判                                                                                                   |

---

## 4. 对齐设计（前端对齐后端）

> 本章是 v2 的核心：不再要求后端补新表去迎合前端的"语义模块"，而是**用现有 `repo` / `code_file` / `chunk` 三张表 + Chroma 元数据 + `clone_dir` 源码**，把前端每个字段的取数方式定下来。页面结构、交互和主要功能保持不变，只替换数据源与细节展示。

### 4.1 四档判定口径

| 档位  | 定义                                                        | 典型实现                                                  | 本期是否做        |
| ----- | ----------------------------------------------------------- | --------------------------------------------------------- | ----------------- |
| **A** | 后端已有现成列 / 现成接口字段，改返回结构即可               | `chunk.id`、`code_file.path`、`chunk.start_line`          | 一期              |
| **B** | 需要 `JOIN` / `GROUP BY` / `FILTER` / 递归 CTE / 子查询聚合 | 模块数、切片数、语言统计、每文件切片数                    | 一期              |
| **C** | 需要清洗、拼接、解析、估算，或读 `clone_dir` 源码           | `summary`、`tags`、`complexity`、`parameters`、`ast_path` | 一期（部分）/二期 |
| **D** | 现有存储没有、简单查询和推导也拿不到，必须新增分析管线      | `callChain`、`references`、`highlights`、`score`          | 不做，前端降级    |

**判定依据**：`app/models.py` 的三表结构 + Chroma 5936 条真实 metadata（已直读核对）+ `app/services/indexing/chunker.py` 的写入逻辑。

---

### 4.2 A 档：后端可直接提供

| 前端字段                              | 具体来源（表.列 / JSON key）                                                      | 接口形态                            | 前端类型映射                        | 一期 |
| ------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- | ---- |
| `module.id`                           | `chunk.id`                                                                        | `GET /api/modules` 返回 `module_id` | `string(chunk.id)`                  | ✅    |
| `module.repoId`                       | `code_file.repo_id` → `repo.id`                                                   | 同上，JOIN 带出                     | `string(repo_id)`                   | ✅    |
| `module.name`                         | `chunk.name`                                                                      | 同上                                | `name`                              | ✅    |
| `module.filePath`                     | `code_file.path`                                                                  | 同上                                | `file_path`                         | ✅    |
| `module.language`                     | `code_file.language`（当前恒为 `java`）                                           | 同上                                | `language`（**前端枚举需补 java**） | ✅    |
| `module.lineCount`                    | `chunk.end_line - chunk.start_line + 1`                                           | 同上                                | 整数                                | ✅    |
| `module.updatedAt`                    | `chunk.indexed_at`（建库时间，ISO/UTC）                                           | 同上                                | 统一格式化为 `YYYY-MM-DD HH:mm`     | ✅    |
| `module.code`                         | `chunk.content`（类型级切片已含整个类体 + 内部方法）                              | `GET /api/modules/{id}` 返回 `code` | 原样字符串                          | ✅    |
| `chunkBoundaries[].chunkId`           | `chunk.id`                                                                        | `GET /api/modules/{id}` 返回        | `string`                            | ✅    |
| `chunkBoundaries[].startLine/endLine` | `chunk.start_line/end_line`                                                       | 同上                                | 整数                                | ✅    |
| `chunkBoundaries[].label`             | `chunk.name`；fixed 无 name 时用 `L{start}-{end}`                                 | 同上（Python 兜底）                 | 字符串                              | ✅    |
| `repo.id/name/url/clone_dir`          | `repo` 表同名列                                                                   | `GET /api/repos`                    | 原样                                | ✅    |
| `repo.lastSyncAt`                     | `repo.indexed_at`                                                                 | `GET /api/repos`                    | 格式化                              | ✅    |
| `repo.embeddingModel`                 | 全局配置 `settings.embedding_model`（`BAAI/bge-small-zh-v1.5`），不是 per-repo 列 | `GET /api/repos` 回填同一值         | 原样                                | ✅    |
| `file.id/path/language`               | `code_file` 同名列                                                                | `GET /api/repos/{id}/tree`          | 原样                                | ✅    |

> 说明：`module.code` 用类级 `chunk.content` 有一个**已存在的小偏差**——它不含文件头部的 `package`/`import`，也不含类自身的 Javadoc；但包含类内部全部方法与注释。前端"模块代码"视图按类展示，这个粒度正合适；如需整文件，再加 `GET /api/files/{id}/content`（读 `clone_dir`，见 4.6 接口 6）。

---

### 4.3 B 档：查询 / 聚合 / 筛选可得

#### 4.3.1 仓库级统计（知识库统计卡 + 仓库卡）

**SQL（一次查全部仓库）**

```sql
SELECT
  r.id, r.name, r.url, r.clone_dir, r.created_at, r.indexed_at,
  COALESCE(f.file_count, 0)   AS total_files,
  COALESCE(c.chunk_count, 0)  AS total_chunks,
  COALESCE(c.module_count, 0) AS total_modules,
  COALESCE(c.strategies, ARRAY[]::text[]) AS strategies,
  CASE WHEN r.indexed_at IS NULL THEN 'pending' ELSE 'synced' END AS status
FROM repo r
LEFT JOIN (
  SELECT repo_id, count(*) AS file_count
  FROM code_file GROUP BY repo_id
) f ON f.repo_id = r.id
LEFT JOIN (
  SELECT cf.repo_id,
         count(*) AS chunk_count,
         count(*) FILTER (
           WHERE ch.strategy = 'ast'
             AND ch.chunk_type IN ('class','interface','enum')
         ) AS module_count,
         array_agg(DISTINCT ch.strategy) AS strategies
  FROM chunk ch
  JOIN code_file cf ON cf.id = ch.file_id
  GROUP BY cf.repo_id
) c ON c.repo_id = r.id;
```

| 前端字段                         | 来源                                                            | 说明                                     |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| `stats.repos`                    | `count(repo)`                                                   | A                                        |
| `stats.modules`                  | `total_modules`（700）                                          | B；**不是** 3993（3993 是 AST 切片总数） |
| `stats.chunks`                   | `total_chunks`（5936）                                          | B                                        |
| `stats.syncing`                  | 一期恒 0（无任务表），二期由 `index_job` 统计                   | D→B                                      |
| `repo.status`                    | `indexed_at` 推导：`pending` / `synced`                         | B；`failed/syncing` 需任务表             |
| `repo.sliceStrategy`             | `strategies = {ast,fixed}` → 展示 "AST + fixed（双策略）"       | B；前端类型需从 5 选 1 改为字符串        |
| `repo.totalFiles/Modules/Chunks` | 同上三个统计                                                    | B                                        |
| `repo.branch`                    | 读 `clone_dir/.git/HEAD`（`ref: refs/heads/master` → `master`） | C，见 4.4                                |
| `repo.progress`                  | 一期 0（`status` 不会为 `syncing`，进度条不渲染）               | D                                        |

#### 4.3.2 每文件切片数 / 行数（文件树）

```sql
SELECT
  cf.id AS file_id,
  cf.path,
  cf.language,
  count(ch.id) AS chunk_count,
  COALESCE(
    max(ch.end_line) FILTER (WHERE ch.strategy = 'fixed'),
    max(ch.end_line)
  ) AS line_count
FROM code_file cf
LEFT JOIN chunk ch ON ch.file_id = cf.id
WHERE cf.repo_id = :repo_id
GROUP BY cf.id, cf.path, cf.language
ORDER BY cf.path;
```

| 前端字段                  | 来源                                      | 说明                        |
| ------------------------- | ----------------------------------------- | --------------------------- |
| `FileTreeNode.chunkCount` | `count(chunk)`                            | B；264 行一次返回，约 30KB  |
| `FileTreeNode.lineCount`  | `max(end_line)`（优先 fixed，它覆盖全文） | B；无需新增 `line_count` 列 |
| 目录 `chunkCount`         | 前端 `file-tree.tsx` 现有聚合逻辑求和     | A（客户端）                 |
| 文件树结构                | `path` 按 `/` 分组                        | A（客户端）                 |

#### 4.3.3 模块列表（模块浏览页的核心）

**"模块"定义**：`strategy='ast'` 且 `chunk_type ∈ {class, interface, enum}` → 真实 **700** 个。
提供 `level` 参数兼容前端 `function` 类型：`level=type`（默认，700）/ `level=member`（method+constructor）/ `level=all`（3993）。

**模块数 + 子树切片数（递归 CTE）**

```sql
WITH modules AS (
  SELECT ch.id, ch.name, ch.chunk_type, ch.parent_chunk_id,
         cf.id AS file_id, cf.path, cf.language,
         ch.start_line, ch.end_line, ch.signature, ch.indexed_at,
         (ch.end_line - ch.start_line + 1) AS line_count,
         COALESCE(array_length(
           regexp_split_to_array(ch.content, '\m(if|for|while|switch|catch)\M'), 1
         ) - 1, 0) AS branch_count
  FROM chunk ch
  JOIN code_file cf ON cf.id = ch.file_id
  WHERE (:repo_id IS NULL OR cf.repo_id = :repo_id)
    AND ch.strategy = 'ast'
    AND (
      (:level = 'type'   AND ch.chunk_type IN ('class','interface','enum')) OR
      (:level = 'member' AND ch.chunk_type IN ('method','constructor')) OR
      (:level = 'all')
    )
    AND (:chunk_type IS NULL OR ch.chunk_type = :chunk_type)
    AND (:language  IS NULL OR cf.language   = :language)
    AND (:keyword   IS NULL OR ch.name ILIKE '%' || :keyword || '%'
                            OR cf.path ILIKE '%' || :keyword || '%')
),
subtree AS (
  SELECT m.id AS root_id, m.id AS node_id FROM modules m
  UNION ALL
  SELECT s.root_id, c.id
  FROM subtree s
  JOIN chunk c ON c.parent_chunk_id = s.node_id
)
SELECT m.*,
       (SELECT count(*) FROM subtree s WHERE s.root_id = m.id) AS chunk_count
FROM modules m
ORDER BY
  CASE :sort
    WHEN 'name'       THEN m.name
    WHEN 'lines'      THEN NULL
    WHEN 'chunks'     THEN NULL
    WHEN 'complexity' THEN NULL
    WHEN 'updated'    THEN NULL
  END,
  CASE :sort WHEN 'lines'      THEN m.line_count END DESC,
  CASE :sort WHEN 'chunks'     THEN (SELECT count(*) FROM subtree s WHERE s.root_id=m.id) END DESC,
  CASE :sort WHEN 'complexity' THEN m.branch_count + ceil(m.line_count / 50.0) END DESC,
  CASE :sort WHEN 'updated'    THEN m.indexed_at END DESC,
  m.name ASC;
```

> `ORDER BY` 的写法在真实实现里建议拆成 5 个分支的 `ORDER BY`（避免 `CASE` 混合类型），逻辑等价。
> 规模：700 个模块 / 3993 个 AST 节点，递归 CTE 毫秒级；一次返回约 200–400KB，前端可以继续用现有的客户端筛选/排序（`module-browser.tsx` L102-133），**不用改交互**。

| 前端字段                                           | 来源 / 规则                                                                                         | 档位 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| `module.chunkCount`                                | 递归 CTE 统计"自己 + 所有后代"（含嵌套类与成员）                                                    | B    |
| `module.type`                                      | `chunk_type` 映射：class→`class`、interface→`interface`、enum→`enum`、method/constructor→`function` | B    |
| 顶部"模块数"                                       | `count(modules)`                                                                                    | B    |
| 顶部"总切片数"                                     | `sum(chunk_count)` 或 `count(chunk)`                                                                | B    |
| 类型筛选                                           | `chunk_type` / `type` 映射后的集合                                                                  | B    |
| 关键词搜索                                         | `chunk.name` + `code_file.path`（当前前端还搜 summary/tags，见 4.7 的取舍）                         | B    |
| 排序 `chunks` / `lines` / `updated` / `complexity` | 对应列 / 表达式                                                                                     | B/C  |

#### 4.3.4 仓库状态与策略

| 字段            | 规则                                                                      | 档位 |
| --------------- | ------------------------------------------------------------------------- | ---- |
| `status`        | `indexed_at IS NULL → pending`；否则 `synced`                             | B    |
| `sliceStrategy` | `array_agg(DISTINCT strategy)` → `["ast","fixed"]`，前端展示"AST + fixed" | B    |
| `lastSyncAt`    | `indexed_at`                                                              | A    |
| `totalFiles`    | `count(code_file)`                                                        | B    |

---

### 4.4 C 档：可推导 / 变通得到

#### 4.4.1 `module.summary`（详见 4.9 专项）

| 项       | 规则                                                       |
| -------- | ---------------------------------------------------------- |
| 取数列   | `chunk.signature`（3993 条有值；fixed 为 NULL）            |
| 清洗     | 按行删除以 `@` 开头的注解行 → 合并空白 → 去掉行尾 `{`      |
| 截断     | > 120 字符时在最后一个空格处截断并加 `…`                   |
| 兜底     | `signature` 为空（fixed）→ `固定窗口：第 {start}-{end} 行` |
| 展示效果 | 卡片两行（`line-clamp-2`）显示一条声明；详情页同样一行     |
| 风险     | 是"声明式摘要"，不是语义摘要；会与类名重复（可接受）       |
| 升级     | 二期从源码 Javadoc 提取，写入 `chunk.metadata` → 变 A 档   |

#### 4.4.2 `module.tags`

```
规则（按优先级，去重，最多 4 个）：
1. 包路径：cf.path 中 "java/" 之后的目录段，取最后 1–2 段（如 com/google/gson/internal/bind → ["internal","bind"]）
2. 继承：正则 `implements\s+([\w.]+)` / `extends\s+([\w.]+)`，取末段（如 TypeAdapterFactory）
3. 注解白名单：@Deprecated / @FunctionalInterface / @SerializedName（忽略 @Override / @SuppressWarnings）
4. 类型：class / interface / enum
```

展示效果：卡片底部最多 3 个标签 + `+N`（现有 `module-card.tsx` L201-215 逻辑不变）。
说明：这是"结构化标签"，不是语义主题标签；可接受，且可复现。

#### 4.4.3 `module.complexity`

```
line_count   = end_line - start_line + 1
branch_count = content 中 \m(if|for|while|switch|catch)\M 的出现次数（SQL 已算）
score        = branch_count + ceil(line_count / 50)
low:    score <= 5
medium: score <= 15
high:   否则
```

展示效果：卡片右侧 `COMPLEXITY_META` 环 + 详情"复杂度"标签，均可直接复用。
风险：不是严格圈复杂度（不含 `&&`/`||`/`?:` 与嵌套深度）；论文中需注明公式，不能声称 McCabe。

#### 4.4.4 `module.parameters`

| 子字段        | 规则                                                 | 档位                |
| ------------- | ---------------------------------------------------- | ------------------- |
| `name`        | `signature` 括号内按顶层逗号切分，每段最后一个标识符 | C                   |
| `type`        | 该段去掉注解、`final` 后的剩余文本                   | C                   |
| `required`    | Java 语义下恒为 `true`（除非类型标注 `@Nullable`）   | B/C                 |
| `description` | 当前库没有 Javadoc `@param`，返回 `""`（单元格留空） | D→C（二期解析源码） |
| `default`     | Java 无默认参数值，返回 `null`（前端 `?? "—"`）      | D                   |

解析伪代码：

```python
def parse_params(sig: str) -> list[dict]:
    if "(" not in sig: return []
    start = sig.index("("); depth = 0; end = None
    for i in range(start, len(sig)):
        c = sig[i]
        if c == "(": depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0: end = i; break
    if end is None: return []
    raw = sig[start + 1:end]
    parts, depth, buf = [], 0, ""
    for c in raw:
        if c in "<([": depth += 1
        elif c in ">)]": depth -= 1
        if c == "," and depth == 0: parts.append(buf); buf = ""
        else: buf += c
    if buf.strip(): parts.append(buf)
    out = []
    for p in parts:
        p = re.sub(r"@\w+(\([^)]*\))?", "", p)      # 去注解
        p = re.sub(r"\bfinal\b", "", p)
        toks = p.strip().split()
        if len(toks) < 2: continue
        out.append({"name": toks[-1].replace("...", ""), "type": " ".join(toks[:-1])})
    return out
```

示例（结构）：`create(Gson gson, TypeToken<T> type)` → `[{name:"gson",type:"Gson"},{name:"type",type:"TypeToken<T>"}]`。
展示效果：表格"名称/类型"两列有值，"必填"显示"必填"，"描述"留空，"默认值"显示 `—`。

#### 4.4.5 `module.astPath`

```
规则：从 chunk.parent_chunk_id 向上递归到根，拼成 `文件名 > Outer > Inner`
SQL：WITH RECURSIVE up AS (...) SELECT string_agg(name, ' > ' ORDER BY lvl DESC)
```

展示效果：详情页"AST 路径"显示 `InterceptorFactory.java > InterceptorFactory`。
风险：不是 tree-sitter 的完整节点路径（没有 `program/class_body`），但对用户更可读。

#### 4.4.6 `chunkBoundaries[].tokenCount`

```
一期：round(length(chunk.content) / 4.0)
二期：建库时用 embedding tokenizer 精确计数写入 chunk.token_count
```

展示效果：`{tokenCount} tok`；建议加 title="约为估算值"。

#### 4.4.7 `repo.branch`

```
读 <clone_dir>/.git/HEAD：
  "ref: refs/heads/<branch>" → branch
  commit hash（detached）      → 显示短 hash
读不到（clone_dir 被清理）→ null，前端隐藏分支徽标
```

档位 C；不需要加列。

#### 4.4.8 `repo.description`

- 真实描述：**D**（无列、无来源）。
- 变通：用 URL host + 语言拼一句，如 `github.com 上的 Java 代码仓库`（C）。若坚持"不造假"，则前端条件渲染，description 为空时不显示该行。

---

### 4.5 后端完全无法提供的参数清单（D 档）

> 判定标准：现有 PG 表、Chroma 元数据、`clone_dir` 都拿不到，且无法通过 SQL/简单推导得到；必须新增分析管线（调用图、引用索引、LLM）。下列 8 项**前端均已有空态或条件渲染**，后端返回空值即可。

| #   | 前端字段                          | 前端位置                                                 | 为什么确实拿不到                                                                                      | 前端最小改动（保留布局）                                                                  |
| --- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D1  | `module.highlights`               | `module-card.tsx` L184-196                               | 库内无任何"亮点"文本；用 signature 拼 2–3 条会与 `summary` 重复，属于造假                             | 后端返回 `[]`；卡片 `highlights.length > 0` 条件渲染自动隐藏，无需改代码                  |
| D2  | `module.callChain`                | `module-detail.tsx` L430-448（Tab + `CallChainSection`） | 无调用边表；`chunk.content` 里虽有方法调用文本，但跨文件/重载/多态需全仓符号解析，不是一条 SQL 能得出 | 后端返回 `[]`；现有 `emptyText="无调用方/无被调用"` 自动显示，Tab 保留                    |
| D3  | `module.references`               | `module-detail.tsx` L561-613                             | 无引用索引；需对全仓库做符号级搜索并建反向索引                                                        | 后端返回 `[]`；现有空态保留                                                               |
| D4  | `module.relatedModuleIds`         | `module-detail.tsx` L518-558                             | PG 无关系表；Chroma 向量近邻可离线预计算，但**在线 API 不加载 Chroma**（2G 内存约束）                 | 后端返回 `[]`；现有"无关联模块"空态（L524）自动生效                                       |
| D5  | `parameters.default`              | `module-detail.tsx` L370-372                             | Java 没有默认参数值语义；annotation 默认值不属于方法参数                                              | 返回 `null`，前端 `p.default ?? "—"` 自动显示破折号                                       |
| D6  | `repo.description`                | `knowledge-base.tsx` L227-229                            | 无列；GitHub/Gitee 的描述未采集，且不是建库必需数据                                                   | 二选一：① 条件渲染，空则不显示该行；② 用 "host + 语言" 拼一句（见 4.4.8）                 |
| D7  | `repo.progress` / `stats.syncing` | `knowledge-base.tsx` L234-241、L89                       | 无任务表，没有进度与"同步中"状态；一期 `status` 只会是 `pending/synced`                               | 返回 `progress=0`、`syncing=0`；`status !== "syncing"` 时进度条分支本就不渲染，**零改动** |
| D8  | 切片 `score`（相似度）            | `knowledge-base.tsx` L722-741（`ChunkPreview` 进度条）   | 知识库浏览没有 query，不存在相似度；该值原本就是 mock 随机数                                          | 删除"相似度"行，保留 `tokens` 与行号；这是唯一需要动 DOM 的 D 项                          |

**额外说明（不算字段，但需明确）**

| 项                           | 结论                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| "语义版" `summary`           | 当前 D；`summary` 字段本身用 C 档声明式摘要填充，页面不缺内容。二期用 Javadoc/LLM 升级                   |
| `module.code` 的完整文件视角 | 当前 A（类级 content）；若要 `package/import`，需新增 `GET /api/files/{id}/content`（A，读 `clone_dir`） |
| 方法级调用关系               | D；若答辩需要，建议降级为"同名方法搜索"并在论文标注为近似                                                |

---

### 4.6 接口汇总与字段映射

> 返回统一 `snake_case`；前端 `src/lib/api/client.ts` 做 `snake→camel` 递归转换（约 30 行），不改后端契约。

| #   | 方法     | 路径                             | 关键入参                                                           | 返回                                                                   | 对应前端                           | 一期            |
| --- | -------- | -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------- | --------------- |
| 1   | GET      | `/api/repos`                     | —                                                                  | `RepoOut[]` + 4.3.1 的统计字段 + `languages[]`                         | 知识库统计卡、仓库卡、侧栏仓库列表 | ✅               |
| 2   | GET      | `/api/modules`                   | `repo_id? level? chunk_type? language? keyword? sort? page? size?` | `{total, items[]}`（默认一次给 700 条）                                | 模块浏览页                         | ✅               |
| 3   | GET      | `/api/modules/{chunk_id}`        | —                                                                  | 模块详情 + `code` + `parameters[]` + `chunk_boundaries[]` + `ast_path` | 模块详情页 4 个 Tab                | ✅               |
| 4   | GET      | `/api/repos/{repo_id}/tree`      | —                                                                  | `{items:[{file_id,path,language,line_count,chunk_count}]}`             | 知识库文件树                       | ✅               |
| 5   | GET      | `/api/repos/{repo_id}/languages` | —                                                                  | `{items:[{language,file_count,module_count,chunk_count}]}`             | 模块浏览语言筛选/统计              | ✅（也可并入 1） |
| 6   | GET      | `/api/files/{file_id}/content`   | —                                                                  | `{file_id,path,language,line_count,content}`                           | 可选：整文件查看                   | 可选            |
| 7   | GET/POST | `/api/jobs...`                   | —                                                                  | 见第 5 节                                                              | 拉取仓库                           | P1              |

**`GET /api/modules` 返回示例**

```json
{
  "total": 700,
  "items": [{
    "module_id": 101,
    "repo_id": 1,
    "name": "InterceptorFactory",
    "chunk_type": "class",
    "type": "class",
    "file_id": 12,
    "file_path": "gson/src/main/java/com/google/gson/internal/bind/InterceptorFactory.java",
    "language": "java",
    "start_line": 22,
    "end_line": 58,
    "line_count": 37,
    "chunk_count": 6,
    "summary": "public final class InterceptorFactory implements TypeAdapterFactory",
    "tags": ["internal", "bind", "TypeAdapterFactory", "class"],
    "complexity": "low",
    "parent_chunk_id": null,
    "ast_path": "InterceptorFactory.java > InterceptorFactory",
    "indexed_at": "2026-11-02T08:12:33Z"
  }]
}
```

**`GET /api/modules/{id}` 额外字段**

```json
{
  "code": "public final class InterceptorFactory implements TypeAdapterFactory { ... }",
  "parameters": [
    {"name": "gson", "type": "Gson", "required": true, "description": "", "default": null}
  ],
  "chunk_boundaries": [
    {"chunk_id": 101, "label": "InterceptorFactory", "start_line": 22, "end_line": 58, "token_count": 420},
    {"chunk_id": 102, "label": "create", "start_line": 30, "end_line": 55, "token_count": 260}
  ],
  "ast_path": "InterceptorFactory.java > InterceptorFactory"
}
```

---

### 4.7 前端改动点清单（最小改动）

| 文件                                                           | 位置                        | 改动                                                                    | 必须性                                           |
| -------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `src/lib/rag/types.ts`                                         | L15                         | `Language` 增加 `"java"`、`"unknown"`                                   | **必须**（否则运行时崩）                         |
| `src/lib/rag/types.ts`                                         | `ModuleType` / `TYPE_ORDER` | 增加 `"interface"`、`"enum"`                                            | 必须（否则徽标映射缺失）                         |
| `src/lib/rag/shared/meta.ts`                                   | L34-42                      | `LANGUAGE_META` 补 java/unknown（label/color）                          | 必须                                             |
| `src/lib/rag/shared/meta.ts`                                   | `TYPE_META`                 | 补 interface/enum 的 label 与颜色                                       | 必须                                             |
| `src/components/rag/modules/module-card.tsx`                   | L15-23                      | `LANGUAGE_BORDER` 补 java                                               | 必须                                             |
| `src/components/rag/modules/code-viewer.tsx`                   | L22-30、L60-95              | `LANGUAGE_ICON` 补 java；关键字表补 Java 分支（或 java 复用 TS 关键字） | 必须                                             |
| `src/lib/rag/types.ts`                                         | `Repo.sliceStrategy`        | 改为 `string`（后端返回 `"ast+fixed"`）                                 | 必须（否则 `STRATEGY_LABELS[...]` 为 undefined） |
| `src/components/rag/knowledge/knowledge-base.tsx`              | L202                        | `STRATEGY_LABELS[repo.sliceStrategy] ?? repo.sliceStrategy`             | 必须                                             |
| `src/components/rag/modules/module-browser.tsx`                | L85-88                      | `MODULES` → `useModules(repoFilter)`                                    | 必须                                             |
| 同上                                                           | L90-94                      | `languages` 改为后端 `languages[]` 的 `language` 去重                   | 按本次要求                                       |
| 同上                                                           | L102-133                    | 保留客户端筛选/排序（700 条完全放得下）                                 | 不改                                             |
| `src/components/rag/modules/module-detail.tsx`                 | 全局                        | 数据源从 `getModuleById` 改为 `useModuleDetail(id)`                     | 必须                                             |
| `src/components/rag/knowledge/knowledge-base.tsx`              | L85-91                      | 统计改为 `GET /api/repos` 聚合值                                        | 必须                                             |
| 同上                                                           | L193-304                    | `RepoCard` 字段按 4.3.1 映射                                            | 必须                                             |
| 同上                                                           | L533-672                    | 文件树改用 `GET /api/repos/{id}/tree`                                   | 必须                                             |
| 同上                                                           | L682-741                    | 删除"相似度"进度条                                                      | 按 D8                                            |
| `src/components/rag/shared/app-sidebar.tsx` / `app-header.tsx` | L64 / L33                   | 仓库列表改用 `GET /api/repos`（或由 store 注入）                        | 必须                                             |
| `src/lib/db.ts` + `.env`                                       | —                           | 新增 `NEXT_PUBLIC_API_BASE`；删除无关的 `DATABASE_URL`                  | 必须                                             |
| `app/main.py`                                                  | L7-10                       | 注册 `CORSMiddleware`（允许 `NEXT_PUBLIC_ORIGIN`）                      | **必须**（否则浏览器拦请求）                     |

**关于搜索的取舍**：现有前端会把 `summary` 和 `tags` 一起做关键词匹配（`module-browser.tsx` L108）。若这些字段由后端派生，最省事的做法是**后端一次返回全部 700 条**，前端保留原逻辑（无需改搜索）；若数据量增长到数千条再改为服务端搜索。一期推荐前者。

---

### 4.8 专项一：语言统计

#### 4.8.1 统计维度选择

| 维度   | 字段                                         | 用途                 | 是否推荐       |
| ------ | -------------------------------------------- | -------------------- | -------------- |
| 文件数 | `code_file.language`                         | 知识库"文件"维度     | ✅ 主维度       |
| 模块数 | `chunk.chunk_type IN (class,interface,enum)` | 模块浏览的语言筛选   | ✅ 必须同时返回 |
| 切片数 | 所有 `chunk`                                 | 统计口径对齐"总切片" | ✅ 同时返回     |

**为什么用 `code_file.language` 而不是 `chunk.metadata->>'language'`**：`chunk.metadata` 全为 NULL；Chroma metadata 虽有 `language`，但 API 不加载 Chroma；`code_file.language` 是唯一在 PG 内可直接 `GROUP BY` 的来源。

#### 4.8.2 SQL

```sql
SELECT
  COALESCE(NULLIF(cf.language, ''), 'unknown') AS language,
  COUNT(DISTINCT cf.id) AS file_count,
  COUNT(*) FILTER (
    WHERE ch.strategy = 'ast'
      AND ch.chunk_type IN ('class','interface','enum')
  ) AS module_count,
  COUNT(*) AS chunk_count
FROM code_file cf
JOIN chunk ch ON ch.file_id = cf.id
WHERE cf.repo_id = :repo_id          -- 全部仓库模式去掉这一行（或 GROUP BY repo_id, language）
GROUP BY COALESCE(NULLIF(cf.language, ''), 'unknown')
ORDER BY module_count DESC, file_count DESC;
```

- 用 `COUNT(DISTINCT cf.id)`：JOIN chunk 后文件行会重复，必须去重。
- 期望输出（Gson）：`{"language":"java","file_count":264,"module_count":700,"chunk_count":5936}`。
- 若某文件 0 切片（解析失败），`JOIN` 会漏掉；需要完整文件口径时改用 `LEFT JOIN`，并把 `module_count/chunk_count` 用 `FILTER` 保持 0。

#### 4.8.3 返回结构

```json
{
  "repo_id": 1,
  "items": [
    {"language": "java", "file_count": 264, "module_count": 700, "chunk_count": 5936}
  ],
  "unknown_count": 0
}
```

#### 4.8.4 前端替换点

| 位置                        | 现状                                    | 改法                                                                                 |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `module-browser.tsx` L90-94 | 从 `candidateModules` 去重 `m.language` | 改为 `stats.languages.map(l => l.language)`（来自 `GET /api/repos` 或 `/languages`） |
| `module-browser.tsx` L105   | `language !== "all"` 过滤               | 不变（模块结果已带 `language`）                                                      |
| 顶部"语言数量"              | `languages.length`                      | 不变，数据源换了即可                                                                 |
| 语言下拉                    | `languages.map(...)`                    | `unknown` 显示"未知"；空数组时只保留"全部语言"                                       |
| `language` 值映射           | `LANGUAGE_META[language]`               | 后端出现未知值 → 适配层转 `"unknown"`，避免 undefined                                |

#### 4.8.5 空数据 / 未知语言兜底

| 情况                        | 后端             | 前端                                                                                         |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| 无任何文件                  | `items: []`      | 顶部显示"语言：—"，下拉只剩"全部语言"                                                        |
| `language` 为 NULL/空串     | 归为 `"unknown"` | `LANGUAGE_META["unknown"] = {label:"未知", color:...}`                                       |
| 出现未来新语言（如 python） | 原样返回         | 适配层：不在 `Language` 联合类型内 → 映射为 `"unknown"`，保留 `language_raw` 供 tooltip 显示 |
| 只有一种语言                | 单项数组         | 属正常，不隐藏统计                                                                           |

---

### 4.9 专项二：`module.summary`

#### 4.9.1 候选数据源评估

| 数据源                      | 实际内容                                                  | 粒度                           | 含注释/文档？                     | 能否做 summary       | 结论     |
| --------------------------- | --------------------------------------------------------- | ------------------------------ | --------------------------------- | -------------------- | -------- |
| `chunk.signature`           | 节点起点到 `{` 的声明文本（注解/修饰符/泛型/参数/throws） | 每个 AST 切片一条（3993）      | **不含** Javadoc，不含方法体      | ✅ 可做**声明式摘要** | **采用** |
| `chunk.metadata`（"mdata"） | 列存在但从未写入，全 NULL                                 | —                              | —                                 | ❌                    | 不用     |
| Chroma `document`           | `enriched_text`（`[class: X]` + content）                 | 每切片                         | 与 content 相同，无 Javadoc       | ⚠️ 可截断但含前缀噪声 | 不用     |
| `clone_dir` 源码            | 完整 Java 文件，含 Javadoc                                | 文件级，可按 `start_line` 对齐 | ✅ 229/264 文件有 `/**`，共 950 块 | ✅ 可提取**语义摘要** | 二期     |
| LLM                         | 无                                                        | —                              | —                                 | ✅ 质量最高           | 二期     |

**结论**：一期用 `signature`，展示"这条声明的原文"；不要把它包装成"这段代码做了什么"的语义摘要。二期再从源码 Javadoc 提取（写入 `metadata`），或离线 LLM 生成。

#### 4.9.2 取数规则（一期）

```python
MAX_LEN = 120

def build_summary(sig: str | None, chunk_type: str, name: str, start: int, end: int) -> str:
    if not sig:
        return f"固定窗口：第 {start}-{end} 行"
    # 1) 去注解行（多行注解也能处理）
    lines = [ln for ln in sig.splitlines() if not ln.strip().startswith("@")]
    # 2) 折叠空白
    s = " ".join(" ".join(lines).split())
    # 3) 去掉尾部 "{"
    s = s.rstrip("{").strip()
    # 4) 截断（优先在空格处断，避免截断标识符）
    if len(s) > MAX_LEN:
        cut = s[:MAX_LEN].rsplit(" ", 1)[0]
        s = (cut if cut else s[:MAX_LEN]) + "…"
    # 5) 兜底（理论上不会为空）
    return s or f"{chunk_type} {name}"
```

#### 4.9.3 展示效果

| 场景         | 输入（`signature`）                                                     | 输出（卡片两行）                                             |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 类           | `public final class Foo implements Bar`                                 | 同左（120 字符内原样）                                       |
| 带注解的方法 | `@Override\npublic TypeAdapter<T> create(Gson gson, TypeToken<T> type)` | `public TypeAdapter<T> create(Gson gson, TypeToken<T> type)` |
| 超长泛型     | 405 字符的声明                                                          | 截断到 120 字符 + `…`                                        |
| fixed 切片   | `NULL`                                                                  | `固定窗口：第 120-159 行`                                    |

卡片 `line-clamp-2` 恰好容纳 2 行，不会撑破布局；详情页 summary 区域同样是一行声明。

#### 4.9.4 多切片如何合并

- **模块 = 类型级切片**：一个模块对应一条 `signature`，**不需要合并**。
- 若未来"模块 = 文件"（`level=file`）：合并规则为 `包名 + 该文件所有类型名`，例如 `com.google.gson.internal.bind（InterceptorFactory, TypeAdapterRuntimeTypeWrapper）`；不要拼接多条完整声明（会超长且难读）。
- fixed 切片：不参与模块摘要，只在切片预览里用 `L{start}-{end}`。

#### 4.9.5 无签名 / 空值兜底顺序

```
signature 有值 → 清洗截断
signature 为 NULL 且 chunk_type ∈ {method,constructor} → "{name}（无签名）"
signature 为 NULL 且 strategy=fixed → "固定窗口：第 {start}-{end} 行"
全部失败 → "{chunk_type} {name}"
```

#### 4.9.6 二期升级路径（语义摘要）

1. 建库时按 `start_line` 回扫源码：从 `start_line - 2` 向上跳过空行，遇到 `*/` 则向前找 `/**`，截取整块 Javadoc。
2. 去掉 `*` 前缀与 `@param/@return/@throws/@see/@since` 行，保留首段 1–2 句。
3. 截断 160 字符，写入 `chunk.metadata = {"javadoc_summary": "..."}`。
4. 接口优先取 `metadata->>'javadoc_summary'`，缺失时回落到 `signature`。
5. 效果：该类从"public final class X implements Y"升级为真正的"用于拦截/适配……"；且纯 SQL 可读（A 档）。

**风险与边界**：Javadoc 可能很长、含 HTML 标签、含中文/英文混排；需要去标签（`<p>`/`{@link}`）后再截断。若 Javadoc 缺失，仍回落到声明式，不影响页面。

---

## 5. 「拉取仓库」功能改造设计

### 5.1 前端现状（完全未接通）

**入口**：`knowledge-base.tsx` L117 `<PullRepoDialog />`，按钮"拉取仓库"（L354-357）。

**表单字段**（L325-481）：

| 字段              | 默认值                                        | 后端是否支持                                                                  |
| ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `url`             | 空                                            | 后端无接口                                                                    |
| `branch`          | `"main"`                                      | 无列、克隆未指定分支                                                          |
| `strategy` 单选   | `ast-semantic`                                | 后端只有 `ast` / `fixed`，**且总是双策略同时构建**                            |
| `strategyOptions` | maxTokens 1200 / overlap 8 / keepImports 是 … | 后端只有 `WINDOW_LINES=40`、`OVERLAP_LINES=10` 两个常量，无 token/import 配置 |
| `embedding`       | `bge-m3`                                      | 后端固定 `BAAI/bge-small-zh-v1.5`，不支持切换                                 |

**提交行为**（L343-349）：只 `setOpen(false)` + `toast.success("仓库拉取已开始")` + `reset()`。**没有 fetch、没有错误处理、URL 甚至没做合法性校验**。

**结论**：这不是"对接不完整"，是"演示占位"。改造时前端必须同步改字段语义，否则接上后端也会 422。

### 5.2 后端差距

| 能力        | 现状                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| HTTP 写接口 | 无（全部只读 + 501）                                                             |
| 任务表      | 无                                                                               |
| 队列/worker | 无                                                                               |
| 异步执行    | 无（`build_index.py` 是阻塞脚本）                                                |
| 多仓库      | 硬编码 `REPO_NAME="gson"`，`clear_repo` 清空整个集合                             |
| 克隆参数    | `clone_repo(url, target)` 固定 `--depth 1`，无 branch / 无超时 / 无重试 / 无凭证 |
| 进度反馈    | 仅 `print`，无结构化进度                                                         |
| 失败清理    | 失败时不删除半成品目录                                                           |

### 5.3 接口设计

#### 5.3.1 创建拉取任务

`POST /api/repos`（202 Accepted）

```json
{
  "url": "https://github.com/google/gson.git",
  "branch": "master",
  "strategies": ["ast", "fixed"],
  "embedding_model": "BAAI/bge-small-zh-v1.5",
  "auth": { "type": "token", "value": "ghp_xxx" }
}
```

响应 202：

```json
{
  "job_id": 12,
  "repo_id": 1,
  "status": "queued",
  "queue_position": 1,
  "poll_url": "/api/jobs/12"
}
```

约定：

- `url` 必填；只允许 `http/https`；`ssh://` 仅在服务端预置 key 时允许。
- `branch` 可选，缺省用远端 HEAD。
- `strategies` 一期只接受 `["ast"]`、`["fixed"]`、`["ast","fixed"]`，默认 `["ast","fixed"]`。**不接受 5 种策略**——后端只有两套切分器。
- `embedding_model` 一期只允许服务端白名单（当前就一个），传其他值返回 422 并给出可用列表。
- `auth` 只在请求体内存在，**不落库、不落日志、不进 URL**。
- 同 `url + branch` 已在 `queued/running` 时返回 409 + 已有 `job_id`（幂等去重）。
- 队列满时返回 429 + `Retry-After`。

#### 5.3.2 任务状态查询

`GET /api/jobs/{job_id}`

```json
{
  "job_id": 12,
  "repo_id": 1,
  "status": "running",
  "stage": "embedding",
  "progress": {
    "files_total": 264,
    "files_done": 80,
    "chunks_total": 5936,
    "chunks_done": 1200,
    "percent": 32
  },
  "queued_at": "2026-11-06T10:00:00Z",
  "started_at": "2026-11-06T10:00:05Z",
  "updated_at": "2026-11-06T10:03:12Z",
  "error": null,
  "cancel_requested": false
}
```

`status` 枚举：`queued | running | succeeded | failed | canceled | partial`
`stage` 枚举：`queued | cloning | scanning | chunking | embedding | persisting | done`

配套：

- `GET /api/jobs?repo_id=&status=&page=&size=` 历史列表（知识库页可显示"上次同步失败原因"）。
- `POST /api/jobs/{job_id}/cancel` → 202，worker 在文件/批次边界检查 `cancel_requested`，落 `canceled`。
- 可选 `GET /api/jobs/{job_id}/events`（SSE）；**默认不启用**，理由见 6.4。

#### 5.3.3 建议的 job 表

```
index_job
  id BIGSERIAL PK
  repo_id BIGINT NULL            -- clone 成功、repo 创建后才回填
  url VARCHAR(1024)
  branch VARCHAR(255)
  strategies VARCHAR(64)[]       -- 或 JSONB
  embedding_model VARCHAR(255)
  status VARCHAR(20)             -- queued/running/...
  stage VARCHAR(20)
  files_total INT
  files_done INT
  chunks_total INT
  chunks_done INT
  clone_dir VARCHAR(1024)
  error_code VARCHAR(64)
  error_message TEXT
  cancel_requested BOOLEAN DEFAULT false
  queued_at / started_at / finished_at / updated_at TIMESTAMPTZ
  INDEX (status, id)
```

> 一期不建议建 `snapshot`/版本表：需求已明确"单版本、无 commit_hash"。

### 5.4 拉取执行方式

#### 5.4.1 clone 还是 archive？

**结论：浅克隆 `git clone --depth 1 --single-branch`。**

| 方案                                            | 可行性                                                                     | 结论                |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ------------------- |
| `git archive --remote`                          | GitHub **不支持** HTTPS 的 upload-archive；GitLab 也只支持 SSH；且无法增量 | ❌ 不可用            |
| 完整 `git clone`                                | 对 2G 内存无影响，但大仓库 IO/磁盘翻倍（历史对象）                         | ❌ 浪费              |
| `git clone --depth 1 --single-branch --no-tags` | 只取一个分支的一个提交，Gson 约 2.4MB                                      | ✅ 推荐              |
| `--filter=blob:none` 部分克隆                   | checkout 时仍要拉全部 blob，对本场景无收益                                 | ❌                   |
| 平台 tarball（`/archive/refs/heads/x.tar.gz`）  | 更快、无需 git，但**私有仓库鉴权、GitLab/Gitea 路径差异**要额外适配        | 备选（P1 可选优化） |

推荐命令：

```bash
git clone --depth 1 --single-branch --no-tags \
  --branch <branch> <url> <tmpdir>
```

环境变量：

```
GIT_TERMINAL_PROMPT=0        # 禁止交互式要账号，避免挂死
GIT_ASKPASS=<临时脚本>        # 私有仓库凭证注入（见 5.4.3）
GIT_CONFIG_NOSYSTEM=1
```

#### 5.4.2 超时与失败重试

| 参数            | 值                                                                                                           | 说明                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `CLONE_TIMEOUT` | 300s                                                                                                         | 2G/2核 + 150MB 仓库上限，300s 足够；超时 kill 进程组                                           |
| `CLONE_RETRY`   | 2 次（5s、15s 退避）                                                                                         | 仅对网络类错误重试（`Could not resolve host`/`Connection timed out`/`RPC failed`/`early EOF`） |
| 不重试          | 认证失败（`Authentication failed` / `could not read Username` / `repository not found`）、URL 非法、仓库超限 | 重试只会放大等待                                                                               |
| 进程终止        | Linux：`start_new_session=True` + `os.killpg`；Windows：`taskkill /T /F`                                     | 防止 git 子进程残留                                                                            |

失败分类映射到 `error_code`：`INVALID_URL / AUTH_FAILED / NOT_FOUND / CLONE_TIMEOUT / REPO_TOO_LARGE / TOO_MANY_FILES / EMBED_OOM / JOB_TIMEOUT / INTERNAL`，前端据此给不同文案。

#### 5.4.3 私有仓库凭证

三个层次，按安全性从高到低：

1. **`GIT_ASKPASS` 临时脚本（推荐）**：创建临时可执行脚本，内容仅 `echo "$GIT_TOKEN"`，token 通过**子进程环境变量**传入，argv 与 `ps` 中不出现，也不写入 `.git/config`；任务结束 `finally` 删除脚本与 env。
2. `-c http.extraHeader="Authorization: Basic <base64(x-access-token:TOKEN)>"`：同样不进 URL，但会出现在 `ps` 的 argv 里（同机其他用户可见）。
3. URL 内嵌 `https://token@host/repo.git`：**禁止**（会进 git log、错误信息、shell history）。

其他约束：

- token 只在该 job 生命周期存在；**不写 `index_job` 表**（如确需"记住私有仓库"，存 credential 引用名，不存明文）。
- 日志中统一把 `token`、`Authorization`、`extraHeader` 值替换为 `***`。
- 禁止 `user:pass@` 形式的 URL（校验时直接 422）。

### 5.5 与建库/向量化流水线的衔接

**现状问题**：唯一入口是 `scripts/build_index.py`，逻辑（clone → 清库 → 切分 → 落 PG → 向量化 → 写 Chroma → 打 `indexed_at`）全部写死在 `main()` 里，且 `REPO_NAME` 常量硬编码。接口要复用这段逻辑，必须先抽出可调用的服务函数。

**改造方案（不改算法，只抽结构）**：

```
app/services/indexing/pipeline.py        # 新增
    run_index_job(job_id: int) -> None   # 供 worker 调用
    _clone(...) _scan(...) _chunk(...) _embed(...) _persist(...)
    ProgressReporter                     # 批量更新 index_job（每 N 文件/每 M 切片）
scripts/build_index.py                   # 保留为 CLI 壳：创建 job → run_index_job
```

衔接要点：

| 阶段    | 动作                                                                                                                                                  | 进度写回        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| clone   | 克隆到 `data/repos/{repo_id}-{slug}`（**不再用固定 gson 目录**）                                                                                      | `stage=cloning` |
| scan    | `walk_paths` + 文件大小/数量校验                                                                                                                      | `files_total`   |
| chunk   | 逐文件 `chunk_java_file`（解析失败 `parse_ok=false` 继续）                                                                                            | `files_done`    |
| persist | **现状**：逐文件 `db.commit()`（`build_index.py` L96），264 文件 = 264 次提交；**改造**：每 `COMMIT_EVERY_FILES=20` 文件提交一次（减少 WAL/连接抖动） | `chunks_done`   |
| embed   | batch 16 → `collection.add` 每 200 条                                                                                                                 | `chunks_done`   |
| finish  | `repo.indexed_at=now()`、`job.status=succeeded`                                                                                                       | `percent=100`   |

**幂等与重建**：`clear_repo` 必须同时清理 PG（`chunk`→`code_file`）与 Chroma（`where={"repo_id": id}`），并且 **Chroma metadata 必须先补 `repo_id`**（当前 `build_metadata` 没有，见 `embedder.py` L49-59）。

**现状的内存隐患**：`_index_file()`（`build_index.py` L32-61）对**单个文件的全部切片一次性**调用 `embedder.encode(documents)`，随后一次性 `collection.add`。Gson 单文件切片数不多，所以没暴露；但遇到 500+ 切片的巨型文件会瞬间申请数百 MB。改造时必须按 `EMBED_BATCH_SIZE` 切批，这是 `MAX_SINGLE_FILE_BYTES=1MB` 之外的第二道保险。

**中断续跑（P1 可选）**：`index_job` 增加 `checkpoint_file_id`；重启后从该文件继续。若不做续跑，失败即 `partial`，提示用户重跑（全量重建是幂等的）。

### 5.6 时序说明

```mermaid
sequenceDiagram
    participant FE as 前端 knowledge-base
    participant API as FastAPI (API 容器)
    participant DB as PostgreSQL
    participant W as Worker 容器
    participant G as 远端 Git

    FE->>API: POST /api/repos {url, branch, strategies, auth}
    API->>API: 校验 URL/白名单/队列水位
    API->>DB: INSERT index_job(status=queued)
    API-->>FE: 202 {job_id, queue_position}
    loop 每 1.5s
        FE->>API: GET /api/jobs/{job_id}
        API-->>FE: {status, stage, progress}
    end
    W->>DB: SELECT ... FOR UPDATE SKIP LOCKED (queued 最旧)
    W->>DB: UPDATE status=running, stage=cloning
    W->>G: git clone --depth 1 --single-branch (timeout 300s)
    alt 克隆失败
        W->>DB: status=failed, error_code
        W->>W: 删除临时目录
    else 克隆成功
        W->>DB: INSERT repo(branch, indexed_at=null)；回填 job.repo_id
        W->>W: scan .java → files_total
        W->>W: chunk（AST + fixed）
        W->>DB: 每 20 文件提交 code_file/chunk，更新 files_done
        W->>W: embed batch 16（torch 2 threads）
        W->>DB: 写 Chroma 每 200 条 → chunks_done
        W->>DB: repo.indexed_at=now(); job.status=succeeded
        FE->>API: GET /api/repos → 刷新统计与文件树
    end
```

取消路径：`FE → POST /api/jobs/{id}/cancel → DB.cancel_requested=true → worker 在下一个文件/批次边界 break → status=canceled → 清理半成品目录与已写入的 PG/Chroma 数据（按 repo_id 幂等删除）`。

### 5.7 并发与资源控制（2G / 2 核）

**进程模型（关键决策）**

| 方案                                             | 内存峰值                                                                            | 结论                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| A. 索引跑在 FastAPI 进程内（线程）               | API 基座 150MB + torch/模型/Chroma 900MB ≈ **1.05–1.2GB**，再叠 PG ≈ 1.5GB+，无余量 | ❌ 2G 下会 OOM，且一次索引会阻塞所有浏览请求 |
| B. 独立 worker 容器 + PG 任务表（`SKIP LOCKED`） | API 300MB + worker 1024MB + PG 320MB ≈ 1.6GB                                        | ✅ 推荐；无需 Redis（省 ~80MB）              |
| C. Celery/RQ + Redis                             | 多一个 Redis 进程（~80–120MB）                                                      | ❌ 2G 下不划算，且毕设无必要                 |

**并发限制**

- `WORKER_CONCURRENCY = 1`（**单 worker 串行**）：2 核下两路 torch 会互相抢核，吞吐不升反降，还会让内存翻倍。
- `QUEUE_MAX = 2`（1 running + 2 pending），超出返回 429。为什么是 2：一个 Gson 规模仓库约 5–10 分钟，2 个排队 ≈ 20 分钟可接受；再多用户也不会等，且会占满磁盘。
- 同一 `url+branch` 去重（409），防重复提交。

**硬阈值（建议值）**

| 参数                                  | 建议值                                                | 依据                                                                            |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `MAX_REPO_BYTES`                      | 150 MB                                                | Gson 实测 2.4MB；典型中型 Java 仓库 10–50MB；150MB 留 3 倍余量；再大 2 核跑不完 |
| `MAX_JAVA_FILES`                      | 3000                                                  | Gson 264；按 3000 × 8KB ≈ 24MB 源码、约 4–5 万切片，已超 30 分钟预算            |
| `MAX_CHUNKS_PER_REPO`                 | 20000                                                 | 5936 对应 5–10 分钟；2 万切片 = 3.4 倍 ≈ 20–35 分钟，是 30 分钟 watchdog 的上限 |
| `MAX_SINGLE_FILE_KB`                  | 1024                                                  | 跳过压缩/生成代码（单文件超 1MB 基本是生成物）                                  |
| `CLONE_TIMEOUT`                       | 300s                                                  | 150MB 仓库 + 2 核 checkout                                                      |
| `JOB_TIMEOUT`                         | 1800s                                                 | 覆盖 2 万切片 worst case；到点 kill 并标 `partial`                              |
| `EMBED_BATCH`                         | 16（可降到 8/4）                                      | batch 32 在 2 核上收益有限但内存涨；16 是内存/吞吐平衡点                        |
| `CHROMA_ADD_BATCH`                    | 200                                                   | 避免一次构造 2000 条 documents 的 Python 对象峰值                               |
| `DB_COMMIT_EVERY`                     | 20 文件                                               | 264 文件 → 14 次提交，减少 WAL/连接抖动                                         |
| `TORCH_NUM_THREADS`                   | 2                                                     | 等于物理核数；再多会线程切换                                                    |
| `OMP_NUM_THREADS` / `MKL_NUM_THREADS` | 2                                                     | 防止 OpenMP 默认起 8+ 线程把内存/CPU 打满                                       |
| `UVICORN_WORKERS`                     | 1                                                     | 2 核跑多 worker 只会互相超卖；且每个 worker 都吃 120MB+                         |
| PG `shared_buffers`                   | 64 MB                                                 | 单客户端、数据量 < 100MB                                                        |
| PG `work_mem`                         | 4 MB                                                  | 聚合/排序都是小结果集                                                           |
| PG `max_connections`                  | 20                                                    | 2 个进程 × 连接池 5，留余量                                                     |
| 容器内存上限                          | api 300MB / worker 1024MB（memswap 1536MB）/ pg 320MB | 见 6.1 预算                                                                     |
| 启动前水位检查                        | `MemAvailable ≥ 500MB`，否则排队等待（60s 重试）      | 防止 PG 与 worker 同时冲高导致 OOM-kill                                         |

**降级策略**

| 触发条件                         | 降级动作                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| 队列满                           | 429 + `queue_position`，前端显示"排队中，前面 N 个任务"                                 |
| 仓库超限（clone 后 `du`/文件数） | 立即停止，删除临时目录，413 + `REPO_TOO_LARGE`，提示"请选择更小的仓库或子目录"          |
| 切片超阈值                       | 中止并 413 `TOO_MANY_CHUNKS`；不静默截断（会污染实验数据）                              |
| 内存不足（embed 抛 OOM）         | batch 减半重试（16→8→4→1）；仍失败则 `failed` + `EMBED_OOM`，保留已建部分并标 `partial` |
| 任务超时                         | kill worker 子进程组，`partial`，保留已完成切片（可续跑或重跑）                         |
| 单文件解析失败                   | 不中断：`parse_ok=false` + fixed 兜底（现有逻辑已具备）                                 |
| 单文件读取失败                   | 跳过该文件，计入 `files_skipped`（现有脚本会直接抛错，需改）                            |
| 索引期间浏览请求变慢             | 浏览接口走 PG 索引（`idx_chunk_file`），不加缓存；必要时 `statement_timeout=10s` 保护   |
| 宿主机内存告急                   | worker 容器 memswap 上限触发 → 进程被 kill → job 标 `failed`，API 不受影响（进程隔离）  |

**为什么这些参数在 2G/2核 下合理（逐项论证）**

1. **worker 1024MB**：`import torch` ≈ 200–300MB；`sentence-transformers` + `transformers` + `tokenizers` ≈ +100MB；bge-small-zh-v1.5（24M 参数 fp32）≈ 96MB；batch 16 × 512 token 的激活 ≈ 100–200MB；Chroma + HNSW ≈ 60–120MB。稳态 ≈ 600–800MB，峰值 ≈ 1.0GB。给 1024MB 上限是"刚好覆盖峰值 + 少量抖动"，再高会挤占 PG 与 OS。
2. **API 300MB**：只要不 import torch/chroma（现有 `chunks.py` 确实不 import），uvicorn 单进程 + SQLAlchemy + psycopg2 ≈ 120–180MB；300MB 留出峰值。
3. **PG 320MB**：`shared_buffers=64MB` + 连接/排序 ≈ 200–300MB；`code_rag` 数据量 < 100MB（5936 行 chunk，`content` 总计约 2–3MB），完全装得下。
4. **OS + dockerd 300–400MB**：Ubuntu 最小化 + docker 引擎 + sshd。
   → 300 + 1024 + 320 = 1644MB，剩 ~400MB 给 OS 与页缓存；加 1–2GB swap 兜底。**若 API 与 worker 共用进程，峰值 1.2G + PG 0.3G + OS 0.35G ≈ 1.85G，只剩 150MB，任何一次并发浏览的 ORM 对象分配都可能触发 OOM**，所以进程分离是硬要求。
5. **单并发**：2 核下 torch 已占满 2 个 intra-op 线程，再并发只会延长单任务总时长并翻倍内存。
6. **150MB 仓库上限**：Gson 2.4MB → 索引约 5–10 分钟；按线性外推，150MB ≈ 60 倍文件量，已远超 30 分钟 watchdog，因此这个上限其实是"防止无意义排队"的护栏，真正可跑的上限是 `MAX_CHUNKS_PER_REPO=20000`。

**吞吐估算（用于前端文案）**

| 阶段           | Gson（264 文件 / 5936 切片）            |
| -------------- | --------------------------------------- |
| clone          | 2–20s（2.4MB，受网络影响）              |
| scan + chunk   | < 5s（tree-sitter 单文件毫秒级）        |
| embed          | 15–25 chunk/s → 4–7 分钟                |
| PG/Chroma 写入 | 14 次批量提交 + Chroma 30 批 → 1–2 分钟 |
| **合计**       | **约 6–10 分钟**                        |

> 前端进度条文案建议：不要承诺"预计剩余时间"（CPU 抖动大），只显示"已处理 X/Y 文件 · Z 切片"。

---

## 6. 2G2核资源预算与参数建议（汇总表）

### 6.1 内存预算

| 组件                                           | 常驻             | 峰值             | 容器上限                  | 依据                               |
| ---------------------------------------------- | ---------------- | ---------------- | ------------------------- | ---------------------------------- |
| OS + dockerd + sshd                            | 250–400 MB       | —                | —                         | 最小化 Ubuntu                      |
| PostgreSQL                                     | 200–300 MB       | 320 MB           | 320 MB                    | `shared_buffers=64MB`，数据 <100MB |
| FastAPI API（1 worker，不加载 torch）          | 120–180 MB       | 250 MB           | 300 MB                    | 只做 PG 查询                       |
| Worker（torch + bge-small + batch16 + Chroma） | 600–800 MB       | ~1000 MB         | 1024 MB（memswap 1536MB） | 见 5.7 论证                        |
| 页缓存/突发余量                                | —                | 300–400 MB       | —                         | 依赖 swap 兜底                     |
| **合计**                                       | **≈ 1.2–1.5 GB** | **≈ 1.7–1.9 GB** | —                         | 建议磁盘 swap 2GB                  |

### 6.2 参数总表（可直接作为 `.env` 草案）

```ini
# ---- 进程/并发 ----
WORKER_CONCURRENCY=1
QUEUE_MAX_PENDING=2
UVICORN_WORKERS=1
TORCH_NUM_THREADS=2
OMP_NUM_THREADS=2
MKL_NUM_THREADS=2

# ---- 拉取限制 ----
MAX_REPO_BYTES=157286400        # 150 MB
MAX_JAVA_FILES=3000
MAX_CHUNKS_PER_REPO=20000
MAX_SINGLE_FILE_BYTES=1048576   # 1 MB
CLONE_TIMEOUT_SECONDS=300
CLONE_RETRY=2
JOB_TIMEOUT_SECONDS=1800

# ---- 流水线批处理 ----
EMBED_BATCH_SIZE=16
EMBED_MIN_BATCH_SIZE=1
CHROMA_ADD_BATCH=200
DB_COMMIT_EVERY_FILES=20
MIN_FREE_MEMORY_MB=500

# ---- PostgreSQL ----
PG_SHARED_BUFFERS=64MB
PG_WORK_MEM=4MB
PG_MAX_CONNECTIONS=20
```

### 6.3 前端进度反馈方式（配合后端）

- 轮询 `GET /api/jobs/{id}`，间隔 **1.5s**（queued 时 3s），连续失败 3 次后降到 5s。
- 页面卸载/切换视图时停止轮询（`useEffect` cleanup）。
- 进度条显示 `files_done/files_total`，次行显示 `chunks_done`。
- `failed` 时展示 `error_message` 的人话映射（例如 `AUTH_FAILED` → "仓库需要登录，请填写访问令牌"）。
- **不推荐 SSE**：每处理一个文件推一条事件，对 2 核是额外 CPU 负担；轮询一次查询仅 1 条 SQL。

---

## 7. 实施优先级与工作量预估

> 工作量为**个人开发**（含联调、自测）的粗估人日，不含论文写作。P0 全部完成即可让"模块浏览 + 知识库"脱离 mock。

### 7.1 P0（一期只读对齐，建议先做）

> v2 调整：不再新增表/列去补前端抽象。`line_count` 用 `max(end_line)` 聚合、`token_count` 用字符数估算、`sha256`/`code_file.line_count` 都**不落库**；新增的只有查询接口与少量派生逻辑。

| 序号 | 任务                                                                                          | 涉及文件（后端 / 前端）                                                                   | 工作量           |
| ---- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| 0    | **修复 `persist.py` L38 TabError**，并加 `python -m compileall app scripts` 自检              | `app/services/indexing/persist.py`                                                        | 0.2              |
| 1    | 后端 CORS + 扩展 `GET /api/repos`（stats/status/strategies/languages）                        | `app/main.py`、`app/routers/chunks.py`、`app/schemas/chunk.py`                            | 0.5              |
| 2    | 新增 `GET /api/modules`（筛选/排序 + 递归 CTE 子树切片数 + summary/tags/complexity/ast_path） | 新 `app/routers/modules.py`、新 `app/services/module_view.py`、新 `app/schemas/module.py` | 1.5              |
| 3    | 新增 `GET /api/modules/{chunk_id}`（code / parameters / chunk_boundaries）                    | 同上                                                                                      | 1                |
| 4    | 新增 `GET /api/repos/{repo_id}/tree`（文件树 + line_count/chunk_count 聚合）                  | `app/routers/chunks.py`、`app/schemas/chunk.py`                                           | 0.5              |
| 5    | 新增 `GET /api/repos/{repo_id}/languages`（也可并入任务 1）                                   | 同上                                                                                      | 0.3              |
| 6    | 前端枚举/meta 补齐（`java`、`interface`/`enum`、`sliceStrategy` 改 `string`）                 | `types.ts`、`meta.ts`、`module-card.tsx`、`code-viewer.tsx`                               | 0.5              |
| 7    | 前端 API 适配层（`NEXT_PUBLIC_API_BASE` + snake→camel + 未知语言归一 `unknown`）              | 新增 `src/lib/api/client.ts`、`src/lib/api/repos.ts`、`modules.ts`                        | 0.5–1            |
| 8    | 模块浏览页接 `/api/modules` + 详情页接 `/api/modules/{id}`                                    | `module-browser.tsx`、`module-card.tsx`、`module-detail.tsx`                              | 1.5–2            |
| 9    | 知识库页接 `/api/repos` + `/tree`（统计/仓库卡/文件树）                                       | `knowledge-base.tsx`、`file-tree.tsx`                                                     | 1.5–2            |
| 10   | 删除伪"相似度"（D8）、description 条件渲染（D6）、策略文案兜底                                | `knowledge-base.tsx`                                                                      | 0.5              |
|      | **小计**                                                                                      |                                                                                           | **约 8–10 人日** |

> `GET /api/files/{id}/content`（整文件含 `package`/`import`）降为**可选**，不属于 P0 阻塞项。

### 7.2 P1（拉取仓库 + 任务体系）

| 序号 | 任务                                                               | 涉及文件                                                     | 工作量          |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------ | --------------- |
| 11   | `index_job` 表 + 状态查询/取消接口                                 | `models.py`、新 `routers/jobs.py`、`schemas/job.py`          | 1               |
| 12   | 建库逻辑抽成 `pipeline.run_index_job()`，脚本改 CLI 壳             | 新 `services/indexing/pipeline.py`、`scripts/build_index.py` | 1–1.5           |
| 13   | 克隆器增强：branch / 超时 / 重试 / GIT_ASKPASS / 大小校验          | `cloner.py`                                                  | 1               |
| 14   | Worker 进程（PG 队列 `SKIP LOCKED`）+ 进度写回 + 心跳/看门狗       | 新 `worker.py`、`docker-compose`                             | 1.5–2           |
| 15   | 多仓库清理改造（`repo_id` 写入 Chroma metadata、按 metadata 删除） | `embedder.py`、`persist.py`                                  | 0.5             |
| 16   | 前端拉取弹窗接接口 + 进度轮询 + 错误文案                           | `knowledge-base.tsx` 新 `pull-repo-dialog.tsx`               | 1               |
| 17   | 删除/重同步接口 + 前端操作改造                                     | `routers/repos.py`                                           | 1               |
|      | **小计**                                                           |                                                              | **约 7–9 人日** |

### 7.3 P2（语义增强，按答辩需要取舍）

> v2 调整：`tags` / `complexity` / `parameters` / `ast_path` 已确定为 C 档并归入 P0（§4.4），下表只保留真正需要新增分析管线或新数据的项。

| 序号 | 任务                                                                                   | 对应档位 | 工作量 |
| ---- | -------------------------------------------------------------------------------------- | -------- | ------ |
| 18   | 建库时从 `clone_dir` 提取 Javadoc → `chunk.metadata.javadoc_summary`（summary 语义化） | C→A      | 1–1.5  |
| 19   | 用 embedding tokenizer 精确计算 `chunk.token_count` 落库（替代字符估算）               | C→A      | 0.5    |
| 20   | 近似调用图（`method_invocation` 抽取 + `code_edge` 表）                                | D→B      | 2–3    |
| 21   | Chroma 向量近邻离线预计算 → `relatedModuleIds`（需解决在线内存约束）                   | D→C      | 1.5–2  |
| 22   | 全仓符号反向索引 → `references`                                                        | D→B      | 2      |

### 7.4 依赖顺序（建议排期）

```
P0-1(CORS/repos 统计) → P0-4(tree) → P0-5(languages) ┐
P0-2(modules 列表) ───→ P0-3(modules 详情) ──────────┼→ 首个可演示版本
P0-6(java 枚举) → P0-7(API 适配层) → P0-8(模块浏览) ─┤
                                  → P0-9(知识库) ────┘ → P0-10(降级项清理)

P1-12(pipeline 抽取) → P1-11(job 表) → P1-13(cloner 增强)
                     → P1-14(worker) → P1-16(前端拉取) → P1-15(多仓库清理) → P1-17(删除/重同步)

P2-18(Javadoc) / P2-19(token 精确) 可随时插入；P2-20/21/22 视答辩需要
```

**先做 P0 的理由**：P0 不依赖任务体系，且能立刻用真实的 700 个模块 / 5936 条切片替换 17 条 mock，答辩时"数据是真的"这件事最有说服力；P1 的拉取功能如果没有 P0 的浏览接口配合，拉完也看不到结果。

---

## 8. 附录

### 8.1 代码位置索引

| 主题                          | 位置                                                                        |
| ----------------------------- | --------------------------------------------------------------------------- |
| 三张表定义                    | `app/models.py` L22-73                                                      |
| 4 个只读接口                  | `app/routers/chunks.py` L31-93                                              |
| 出参契约                      | `app/schemas/chunk.py` L10-66                                               |
| 501 问答                      | `app/routers/query.py` L10-17                                               |
| 无 CORS                       | `app/main.py` L7-10                                                         |
| 克隆（无分支/无超时）         | `app/services/indexing/cloner.py` L9-30                                     |
| AST 层级切分                  | `app/services/indexing/chunker.py` L20-33、L118-182                         |
| fixed 40/10                   | `app/services/indexing/chunker.py` L31-32、L85-115                          |
| Chroma metadata（缺 repo_id） | `app/services/indexing/embedder.py` L49-62                                  |
| 未写 token_count/sha256       | `app/services/indexing/persist.py` L45-83                                   |
| **TabError（阻断）**          | `app/services/indexing/persist.py` L38                                      |
| 清空整个 Chroma 集合          | `app/services/indexing/persist.py` L25-42                                   |
| 硬编码单仓库                  | `scripts/build_index.py` L29、L67-68、L80-96                                |
| 前端 Repo 类型                | `src/lib/rag/types.ts` L17-32                                               |
| 前端 CodeModule 类型          | `src/lib/rag/types.ts` L90-111                                              |
| 前端 Language 枚举（缺 java） | `src/lib/rag/types.ts` L15                                                  |
| 前端 REPOS / MODULES / 树     | `src/lib/rag/mock-data.ts` L11、L247、L1159、L1461、L1642                   |
| 模块浏览取数                  | `src/components/rag/modules/module-browser.tsx` L85-88                      |
| 模块卡片字段                  | `src/components/rag/modules/module-card.tsx` L112-227                       |
| 模块详情四个 Tab + 右侧栏     | `src/components/rag/modules/module-detail.tsx` L268-575                     |
| 知识库统计                    | `src/components/rag/knowledge/knowledge-base.tsx` L85-91                    |
| 拉取弹窗（假提交）            | `src/components/rag/knowledge/knowledge-base.tsx` L325-481（提交 L343-349） |
| 切片预览伪造分数              | `src/components/rag/knowledge/knowledge-base.tsx` L682-741、L783-801        |
| 侧栏/顶栏用 mock 仓库         | `src/components/rag/shared/app-sidebar.tsx` L64、`app-header.tsx` L33/L126  |
| 假检索接口                    | `src/app/api/retrieve/route.ts` L41-63                                      |
| LLM 路由（repoId 未使用）     | `src/app/api/chat/route.ts` L46-90                                          |

### 8.2 文档与代码不一致 / 需修正的既有结论

| #   | 位置                           | 问题                                                                                                                                                                                                 |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `persist.py` L38               | **代码当前无法编译**：制表符缩进的裸字符串触发 `TabError`，`scripts/build_index.py` 导入即失败。`result.md` 的建库成功记录只能说明"当时是好的"，现在的代码不能重建库。修复优先级最高                 |
| 1   | `requirements.md` L151         | 写"`tree-sitter`、`tree-sitter-java` 未在 `requirements.txt` 中"，但 `requirements.txt` L106-107 已固定为 `tree-sitter==0.26.0`、`tree-sitter-java==0.23.5`。该条约束已过期                          |
| 2   | `persist.py` L38-43            | 该处备注承认"`collection.get()` 最多返回 100 条"，与 `result.md` "PG↔Chroma 完全一一对应" 的结论存在潜在矛盾。本次建库若集合为空则无影响，但**多仓库/增量重建必然残留**，P1 必须改为按 metadata 删除 |
| 3   | `result.md` L76                | "单仓库场景下 `clear_repo` 直接清空整个 Chroma 集合" —— 一旦支持拉取多仓库，这是数据正确性缺陷（清 A 会把 B 的向量删掉），必须先修再做 P1                                                            |
| 4   | `mock-data.ts` L11-60 vs L247  | `REPOS` 声明 25 模块 / 335 切片，`MODULES` 实际 17 条、`SOURCE_CHUNKS` 5 条；知识库统计卡与实际列表完全对不上                                                                                        |
| 5   | `mock-data.ts` L115-1158       | 混入大量未被引用的旧演示代码（`ChatPanel`/`SearchBar`/`ChatService`/`useChatStore`），建议清理，避免后续误读                                                                                         |
| 6   | `app/api/chat/route.ts` L41-44 | 接收 `repoId` 但从未使用，前端"按仓库提问"实际不生效                                                                                                                                                 |
| 7   | `next.config.ts` L6-8          | `ignoreBuildErrors: true` 会掩盖 `Language` 枚举缺失这类致命类型错误，接真实接口前建议至少对该目录开严格检查                                                                                         |

> **v2 新增（真实数据核对中发现，均为本次直读 Chroma / 精读写入代码确认）**

| #   | 位置                                    | 结论                                                                                                                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `persist.save_chunk` L58-83             | `chunk.metadata`（JSONB）**从未赋值**，5936 条全为 NULL。用户所说的 "mdata" 在表结构中不存在同名/近名列，不能作为 summary 数据源                                           |
| 9   | `chunker._node_text` / `signature` 生成 | `signature` 是"节点起点→body 起点"的声明文本，**不含前置 Javadoc**。实测 class 级 124/647 出现的 `/**` 属于**类内部成员注释**，method 级仅 3/2955；语义摘要须另取源码      |
| 10  | `embedder.build_metadata` L49-59        | Chroma `document` 写入的是 `enriched_text`（`[class: X] ...` 前缀 + content），**不是** PG 的 `chunk.content`；不要拿它当代码原文或摘要源                                  |
| 11  | `result.md` 的 "3993 AST 切片"          | 3993 是 AST 切片总数（class 647 + interface 27 + enum 26 + method 2955 + constructor 338），**"模块"只有 700 个**。统计卡与 `/api/modules` 默认 `level=type` 必须按 700 计 |

### 8.3 复现本文结论的验证命令

```powershell
# 后端（需先 docker start code-rag-pg）
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
# 浏览器打开 http://localhost:8000/docs，逐个调用 4 个 GET + /api/query

# 前端
bun dev            # 或 npm run dev，端口 3000
# 打开模块浏览/知识库，对照本文第 3 节逐字段核对

# 数据规模复核
Get-ChildItem data\repos\gson -Recurse -Filter *.java | Measure-Object Length -Sum
```

**v2：不启动 PG 也能核对切片类型 / signature（直读 Chroma 持久化库）**

```python
# 保存为 check_chroma.py 后运行：python check_chroma.py
import sqlite3, collections
c = sqlite3.connect(r'd:\path\to\Graduation-project-back\data\chroma\chroma.sqlite3')
print(collections.Counter(
    r[0] for r in c.execute("select string_value from embedding_metadata where key='chunk_type'")
))
# 实测输出：method 2955 / fixed 1943 / class 647 / constructor 338 / interface 27 / enum 26 → 合计 5936
print(c.execute(
    "select count(*) from embedding_metadata where key='signature' and string_value<>''"
).fetchone())
# 实测输出：(3993,) —— AST 切片全部有 signature，fixed 的 1943 条为 NULL
```

### 8.4 实测修正（2026-11-07 数据库启动后逐项复核）

| 项                                                  | 初稿状态                        | 实测结果                                                                                    | 结论                           |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| PG 表实际行数                                       | 未直连，取自 result.md + Chroma | `repo=1`、`code_file=264`、`chunk=5936`                                                     | 一致，无需修正                 |
| 切片类型分布                                        | Chroma 直读                     | class 647 / interface 27 / enum 26 / method 2955 / constructor 338 / fixed 1943             | 一致                           |
| 模块数                                              | 推算 700                        | SQL `strategy='ast' and chunk_type in ('class','interface','enum')` = **700**               | 一致                           |
| `signature` 有值                                    | Chroma 直读 3993                | PG `count(*) filter (where signature<>'')` = **3993**                                       | 一致                           |
| `chunk.metadata` 全 NULL                            | 代码推定                        | PG `count(*) filter (where metadata is null)` = **5936/5936**                               | 推定为真                       |
| `token_count` / `content_hash` / `code_file.sha256` | 代码推定未写入                  | 分别 5936 / 5936 / 264 全 NULL                                                              | 推定为真                       |
| 语言                                                | 只有 java                       | `select language,count(*)` = java/264                                                       | 一致                           |
| `parent_chunk_id`                                   | 未核对条数                      | 3741 条非空                                                                                 | 为子树计数提供依据             |
| `branch`                                            | 设计读 `.git/HEAD`              | `refs/heads/main` → `main`                                                                  | 方案可行                       |
| 源码 Javadoc 数量（229/264 文件、950 块）           | 本地扫描                        | 未做 AST 级与 `start_line` 对齐验证                                                         | 二期实现前需补验证             |
| `/api/modules` 聚合性能                             | 未实测                          | 实测选型：一次性取该仓库 AST 节点（id, parent），Python 迭代 DFS 求子树大小；接口响应毫秒级 | 未使用递归 CTE，见联调结果文档 |
