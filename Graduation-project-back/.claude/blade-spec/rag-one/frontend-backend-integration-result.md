# 前后端接口联调结果文档

> 实施日期：2026-11-07
> 依据文档：`frontend-backend-analysis.md`（v2「前端对齐后端」修订版）
> 改造范围：后端 `C:\no_space_demand\Graduation-project-back`，前端 `C:\no_space_demand\Graduation-project-front`
> 目标页面：模块浏览、模块详情、知识库（文件树 + 切片预览）
> **未纳入本次范围**：对话问答（`/api/chat` 及其实时问答链路后端尚未实现，保持原状、未改一行）；拉取仓库（文档判定为 P1，本次只保留 UI，见第 9 节）
> 原则：A/B/C 档用后端真实数据，D 档按文档降级，不新增 mock；页面布局与交互不变

---

## 1. 这次改造解决了什么问题

改造前，前端三个页面全部读 `src/lib/rag/mock-data.ts`：17 个模块、5 条切片、3 个仓库，与数据库里真实的 **264 文件 / 5936 切片 / 700 模块** 完全对不上；页面看不到任何后端数据，"已建库"这件事在界面上无法证明。

改造后：

1. 模块浏览、模块详情、知识库三处的数据全部来自 PostgreSQL 的 `repo` / `code_file` / `chunk` 三张表；
2. 后端新增 3 个只读聚合接口、扩展 1 个既有接口，全部在查询期聚合，**没有新增表、没有新增列、没有改表结构**；
3. 前端新增一层轻量 API 适配层（`src/lib/api/`），把 snake_case DTO 转成现有 `Repo` / `CodeModule` / `FileTreeNode`，因此页面 JSX 结构基本没动；
4. 后端无法提供的 8 个字段按文档要求返回空数组 / null / 0，由页面既有空态承接；只有"切片相似度"按 D8 删除该行；
5. 修复了 `persist.py` 的 `TabError`（此前会导致任何建库脚本导入即失败）。

---

## 2. 改造前的实测核对（与文档结论逐条对齐）

数据库已启动，以下为**实连 PostgreSQL** 的结果（不是推定）：

| 核对项               | SQL / 方式                                            | 实测结果                                                                        | 与文档是否一致                         |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| 仓库数               | `select count(*) from repo`                           | 1（id=3，name=gson）                                                            | 一致                                   |
| 文件数               | `select count(*) from code_file`                      | 264，全部 `parse_ok=true`                                                       | 一致                                   |
| 切片数               | `select count(*) from chunk`                          | 5936                                                                            | 一致                                   |
| 切片类型分布         | `group by chunk_type, strategy`                       | class 647 / interface 27 / enum 26 / method 2955 / constructor 338 / fixed 1943 | 一致                                   |
| 模块数（类型级 AST） | `strategy='ast' and chunk_type in (...)`              | **700**                                                                         | 一致                                   |
| `signature` 非空     | `count(*) filter (where signature <> '')`             | **3993**（fixed 的 1943 条为 NULL）                                             | 一致                                   |
| `chunk.metadata`     | `count(*) filter (where metadata is null)`            | **5936（全 NULL）**                                                             | 一致（文档原为代码推定，现已实测确认） |
| `chunk.token_count`  | `count(*) filter (where token_count is null)`         | 5936（全 NULL）                                                                 | 一致                                   |
| `chunk.content_hash` | 同上                                                  | 5936（全 NULL）                                                                 | 一致                                   |
| `code_file.sha256`   | `count(*) filter (where sha256 is null)`              | 264（全 NULL）                                                                  | 一致                                   |
| 语言                 | `select language, count(*) from code_file group by 1` | 仅 `java` / 264                                                                 | 一致                                   |
| `parent_chunk_id`    | `count(*) filter (where parent_chunk_id is not null)` | 3741                                                                            | 一致                                   |
| 分支                 | 读 `data/repos/gson/.git/HEAD`                        | `ref: refs/heads/main` → `main`                                                 | 一致                                   |

> 结论：文档的四档判定、700 模块数、summary 数据源判断在实测下全部成立，无需推翻任何设计。

---

## 3. 后端改动清单

### 3.1 修复缺陷

| 文件                               | 改动                                        | 意义                                                                                                                     |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app/services/indexing/persist.py` | 把 L38 附近 Tab 缩进的裸字符串改为 `#` 注释 | 修复 `TabError`。此前 `scripts/build_index.py` 导入即失败，重建库/拉取全部不可用；FastAPI 仍能启动，容易误判为"后端正常" |

### 3.2 跨域与配置

| 文件            | 改动                                                | 意义                                                                         |
| --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `app/config.py` | 新增 `cors_origins: str` 与 `cors_origin_list` 属性 | 把前端来源做成可配置项，默认 `http://localhost:3000,http://127.0.0.1:3000`   |
| `app/main.py`   | 注册 `CORSMiddleware`；注册新的 `modules` 路由      | 浏览器从前端域名调用 `127.0.0.1:8000` 不再被拦；未引入新依赖（FastAPI 内置） |

### 3.3 新增派生逻辑（C 档规则集中地）

| 文件                                  | 作用                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/services/module_view.py`（新增） | 纯函数集合：`build_summary`（signature 清洗/截断）、`derive_tags`（路径 + 继承 + 注解白名单 + 类型）、`estimate_complexity`（分支关键字 + 每 50 行折算）、`parse_params`（signature 括号内按顶层逗号解析）、`estimate_token_count`（字符/4）、`build_ast_path`、`read_git_branch` |

### 3.4 出入参模型

| 文件                            | 改动                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/schemas/chunk.py`          | `RepoOut` 增加 `status/branch/total_files/total_chunks/total_modules/strategies/languages/embedding_model`；新增 `LanguageStatOut`、`LanguageStatsOut`、`FileTreeItem`、`FileTreeOut`、`FilePage`；`ChunkOut` 增加 `char_count`（原文长度，供前端估算 tokens） |
| `app/schemas/module.py`（新增） | `ModuleOut` / `ModuleDetailOut` / `ModulePage` / `ModuleParameterOut` / `ChunkBoundaryOut`                                                                                                                                                                     |

### 3.5 路由

| 文件                             | 改动                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/routers/chunks.py`          | 重写 `GET /api/repos`（补聚合统计）；新增 `GET /api/repos/{repo_id}/languages`、`GET /api/repos/{repo_id}/tree`；保留 `GET /api/repos/{repo_id}/files`、`GET /api/files/{file_id}/chunks`（返回值补 `char_count`）、`GET /api/chunks/{chunk_id}` |
| `app/routers/modules.py`（新增） | `GET /api/modules`（筛选/排序/分页 + 子树切片数 + 派生字段）、`GET /api/modules/{module_id}`（原文 + 参数 + 切片边界）                                                                                                                           |

**聚合实现要点**

- 仓库统计：三条 `select ... group by repo_id` + 一条带 `FILTER` 的语言统计 SQL，在 Python 里组装，避免 N+1；
- 模块子树切片数：一次性取回该仓库全部 AST 节点的 `(id, parent_chunk_id)`，用迭代 DFS 求"含自身"的子树大小（`3741` 条父子关系，毫秒级），不用递归 CTE；
- 模块列表在 Python 内完成排序与分页（700 条），避免为 5 种排序写 5 套 SQL；
- `language` 取 `code_file.language`，`COALESCE(NULLIF(language,''),'unknown')` 兜底空值。

---

## 4. 新增/扩展接口契约

统一前缀 `/api`，字段沿用后端既有 snake_case，无统一包装（直接返回资源或 `{total,page,size,items}`）。错误统一 `{"detail": "..."}` + 4xx。

### 4.1 `GET /api/repos`

返回数组，元素在原 `RepoOut` 基础上新增统计字段：

```json
[{
  "id": 3, "name": "gson", "url": "...", "clone_dir": "data\\repos\\gson",
  "created_at": "...", "indexed_at": "...",
  "status": "synced", "branch": "main",
  "total_files": 264, "total_chunks": 5936, "total_modules": 700,
  "strategies": ["ast", "fixed"],
  "languages": [{"language": "java", "file_count": 264, "module_count": 700, "chunk_count": 5936}],
  "embedding_model": "BAAI/bge-small-zh-v1.5"
}]
```

`status` 规则：`indexed_at` 为空 → `pending`，否则 `synced`（D7：没有任务表，不存在 `syncing`）。

### 4.2 `GET /api/repos/{repo_id}/languages`

```json
{"repo_id": 3,
 "items": [{"language": "java", "file_count": 264, "module_count": 700, "chunk_count": 5936}]}
```

统计维度：以 `code_file` 为行、按 `language` 分组，`COUNT(DISTINCT cf.id)` 取文件数、`COUNT(ch.id)` 取切片数、`FILTER` 取模块数（避免 JOIN 后文件重复计数）。仓库不存在 → 404。

### 4.3 `GET /api/repos/{repo_id}/tree`

```json
{"repo_id": 3, "total": 264,
 "items": [{"file_id": 12, "path": "gson/src/main/java/.../X.java",
            "language": "java", "line_count": 120, "chunk_count": 7}]}
```

`line_count = max(end_line) FILTER (WHERE strategy='fixed')`（fixed 窗口覆盖全文，比 AST 更接近真实行数），退化为 `max(end_line)`。前端按 `/` 把路径拼成目录树，不额外做后端树结构。

### 4.4 `GET /api/modules`

| 参数         | 类型       | 默认      | 说明                                                   |
| ------------ | ---------- | --------- | ------------------------------------------------------ |
| `repo_id`    | int        | 无        | 不传则跨仓库                                           |
| `chunk_type` | enum       | 无        | `class` / `interface` / `enum`                         |
| `language`   | str        | 无        | 如 `java`                                              |
| `keyword`    | str        | 无        | 名称 / 路径 / 签名 ILIKE                               |
| `sort`       | enum       | `updated` | `updated` / `name` / `chunks` / `lines` / `complexity` |
| `page`       | int ≥1     | 1         |                                                        |
| `size`       | int 1–1000 | 200       | 前端当前用 1000 一次取全                               |

返回：

```json
{"total": 700, "page": 1, "size": 200, "items": [
  {"module_id": 5918, "repo_id": 3, "name": "TestAction", "chunk_type": "interface",
   "type": "interface", "file_id": 264, "file_path": "gson/src/test/java/.../TestAction.java",
   "language": "java", "start_line": 25, "end_line": 26, "line_count": 2, "chunk_count": 1,
   "parent_chunk_id": 5907, "summary": "interface TestAction {",
   "tags": ["gson", "it", "interface"], "complexity": "low",
   "ast_path": "RawCollectionsExample.java > AbstractRawCollectionsExample > TestAction",
   "indexed_at": "2026-11-02T..."}
]}
```

字段映射：

| 前端                           | 后端来源                                                                          | 档位 |
| ------------------------------ | --------------------------------------------------------------------------------- | ---- |
| `module.id`                    | `chunk.id` → 字符串                                                               | A    |
| `module.name`                  | `chunk.name`，空则用 `chunk_type`                                                 | A    |
| `module.type`                  | `chunk_type` → `class/interface/enum`；`method/constructor` → `function`          | A    |
| `module.filePath` / `language` | `code_file.path` / `language`                                                     | A    |
| `module.lineCount`             | `end_line - start_line + 1`                                                       | B    |
| `module.chunkCount`            | 子树切片数（含自身）                                                              | B    |
| `module.summary`               | `signature` 清洗                                                                  | C    |
| `module.tags`                  | 路径末两段 + extends/implements + 白名单注解 + 类型（最多 4）                     | C    |
| `module.complexity`            | `if/for/while/switch/catch` 计数 + `ceil(行/50)`，≤5 low / ≤15 medium / else high | C    |
| `module.astPath`               | 文件名 + `parent_chunk_id` 链名称                                                 | C    |
| `module.updatedAt`             | `chunk.indexed_at` → `YYYY-MM-DD HH:mm`                                           | A    |
| `module.highlights`            | `[]`                                                                              | D1   |
| `module.callChain`             | `[]`                                                                              | D2   |
| `module.references`            | `[]`                                                                              | D3   |
| `module.relatedModuleIds`      | `[]`                                                                              | D4   |

### 4.5 `GET /api/modules/{module_id}`

在列表字段基础上增加：

```json
{
  "code": "class 原文（含方法体）",
  "parameters": [{"name": "name", "type": "String", "required": true, "description": "", "default": null}],
  "chunk_boundaries": [
    {"chunk_id": 5918, "label": "TestAction", "chunk_type": "interface",
     "start_line": 25, "end_line": 26, "token_count": 12, "is_self": true},
    {"chunk_id": 5919, "label": "foo", "chunk_type": "method", "...": "..."}
  ]
}
```

- `code`：`chunk.content` 原文，行号以 `start_line` 起算；
- `parameters`：类型级切片本身无参数，退而取该类/枚举下第一个 `constructor` 的 `signature` 解析（仍来自数据库，不编造）；`default` 恒 `null`（D5：Java 无默认参数语义）；
- `chunk_boundaries`：模块自身 + 全部后代 AST 切片，按 `start_line` 升序，这是模块详情"切片边界"页签的真实数据源；
- 非 `class/interface/enum` 或非 `ast` → 404。

---

## 5. 前端改动清单

### 5.1 新增：API 适配层

| 文件                              | 作用                                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api/client.ts`（新增）   | `API_BASE`（读 `NEXT_PUBLIC_API_BASE`，默认 `http://localhost:8000`）、`apiGet`、`ApiError`；连接失败/非 2xx 都转成可展示的错误文案                                                |
| `src/lib/api/adapters.ts`（新增） | 后端 DTO 定义 + 转换：`toRepo`、`toCodeModule`、`toCodeModuleDetail`、`toFileTree`、`toLanguage`、`formatDateTime`；D 档字段在此显式置空                                           |
| `src/lib/api/hooks.ts`（新增）    | `useRepos`（`useSyncExternalStore` 模块级缓存，全站只请求一次）、`useRepoById`、`useModules`、`useModuleDetail`、`useFileTree`、`useFileChunks`；全部返回 `{data, loading, error}` |

> 适配层存在的意义：页面组件原本依赖 camelCase 的 `Repo/CodeModule/FileTreeNode`，只要在边界做一次转换，组件内部几乎不用改，符合"页面结构不动"的要求。

### 5.2 类型与展示元数据

| 文件                                         | 改动                                                                                                                                                                       | 原因                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/rag/types.ts`                       | `Language` 增加 `java`、`unknown`；`ModuleType` 增加 `interface`、`enum`；`Repo.sliceStrategy` 改为 `string`；`FileTreeNode` 增加可选 `id`（承载 `file_id`，供拉取切片用） | 原枚举没有 java，`LANGUAGE_META['java']` 会取到 `undefined` 直接运行时崩；`sliceStrategy` 5 选 1 联合类型装不下后端的 `ast` |
| `src/components/rag/shared/meta.ts`          | `MODULE_TYPE_META` 补 `interface`/`enum`；`LANGUAGE_META` 补 `java`/`unknown`                                                                                              | 同上，保证标签有颜色与中文名                                                                                                |
| `src/components/rag/modules/code-viewer.tsx` | 新增 `JAVA_KEYWORDS`；`LANGUAGE_ICON` 补 java/unknown；新增 `startLine` 属性                                                                                               | Java 代码不再按 TypeScript 关键字高亮；模块代码片段起始行不是文件第 1 行，行号栏必须偏移，否则与"切片边界"高亮区间错位      |
| `src/lib/rag/store.ts`                       | `activeRepoId` 默认改为 `""`；新增 `setActiveRepoId` action                                                                                                                | 原来默认是 mock 仓库 `repo-fastgpt-sdk`；`useRepos` 拿到真实仓库后会把遗留的 mock id 校正为第一个真实仓库，且不改变当前视图 |

### 5.3 页面组件

| 文件                                              | 改动                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/rag/modules/module-browser.tsx`   | 移除 `MODULES/REPOS/getModulesByRepo`；模块列表改 `useModules(effectiveRepoId)`，仓库下拉改 `useRepos()`；仓库 id 失效时回落到第一个真实仓库；骨架屏条件改为 `loading \|\| modulesState.loading`；标题计数改用真实数据                                                                                                                           |
| `src/components/rag/modules/module-card.tsx`      | `getRepoById` 改 `useRepos()`；`LANGUAGE_BORDER` 补 java/unknown 并加兜底                                                                                                                                                                                                                                                                        |
| `src/components/rag/modules/module-detail.tsx`    | `getModuleById` 改 `useModuleDetail(activeModuleId)`；`getRepoById` 改 `useRepoById`；未加载时显示"正在加载模块…"而不是"未选择模块"；`CodeViewer` 传 `startLine`（取自模块自身边界）；D3/D4 的 mock 查找分支保留但不可达（数组恒空）                                                                                                             |
| `src/components/rag/knowledge/knowledge-base.tsx` | 统计数据改由 `useRepos` 汇总；仓库卡列表改 `repos`；`STRATEGY_LABELS` 改为 `Record<string,string>` 并补 `ast`/`fixed`；`description` 改为有条件渲染（D6）；文件树改 `useFileTree(repo.id)`，异步到数据后自动全部展开；切片预览改 `useFileChunks(file.id)`，删除伪"相似度"（D8），tokens 由 `char_count/4` 估算；删除 `synthesizeChunks` 伪造函数 |
| `src/components/rag/shared/app-sidebar.tsx`       | 仓库列表改 `useRepos()`                                                                                                                                                                                                                                                                                                                          |
| `src/components/rag/shared/app-header.tsx`        | 当前仓库与仓库切换菜单改 `useRepos()`                                                                                                                                                                                                                                                                                                            |
| `.env`                                            | 新增 `NEXT_PUBLIC_API_BASE=http://localhost:8000`                                                                                                                                                                                                                                                                                                |

---

## 6. 每个页面的数据来源变化

| 页面                  | 改造前                                     | 改造后                                                                 |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 模块浏览              | `MODULES`（17 条）+ `getModulesByRepo`     | `GET /api/modules?repo_id=3&size=1000` → 700 条                        |
| 模块详情              | `getModuleById`（mock 17 条之一）          | `GET /api/modules/{id}`（含 code/parameters/chunk_boundaries）         |
| 知识库统计卡          | `REPOS` 汇总（25 模块 / 335 切片）         | `GET /api/repos` 汇总（700 模块 / 5936 切片）                          |
| 知识库仓库卡          | `REPOS` 3 条                               | `GET /api/repos` 1 条（gson / main / 已同步 / 264 文件）               |
| 知识库文件树          | `getFileTreeByRepo`（手写树）              | `GET /api/repos/3/tree`（264 行扁平数据，前端按 `/` 建树）             |
| 知识库切片预览        | `synthesizeChunks`（伪造 tokens 与 score） | `GET /api/files/{id}/chunks`（真实 AST/fixed 切片，tokens 按字符估算） |
| 侧边栏 / 顶部仓库切换 | `REPOS` mock                               | `GET /api/repos`                                                       |

---

## 7. D 档字段的实际降级表现

| #   | 字段                     | 后端返回                              | 页面实际表现                                                           |
| --- | ------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| D1  | `highlights`             | `[]`                                  | 模块卡片不渲染"亮点"区块（原有 `length > 0` 条件）                     |
| D2  | `callChain`              | `[]`                                  | 详情页显示"无调用方 / 无被调用"空态                                    |
| D3  | `references`             | `[]`                                  | 详情页显示"无引用记录"                                                 |
| D4  | `relatedModuleIds`       | `[]`                                  | 详情页显示"无关联模块"                                                 |
| D5  | `parameters.default`     | `null`                                | 参数表默认值列显示"—"（原有 `?? "—"`）；类模块参数改由构造函数签名提供 |
| D6  | `repo.description`       | 不返回                                | 仓库卡不再渲染描述行（此前是空 div）                                   |
| D7  | `repo.progress` / 同步中 | `progress=0`、`status=synced/pending` | 进度条只在该仓库 `syncing` 时出现，当前永不出现                        |
| D8  | 切片 `score`             | 不返回                                | 知识库切片预览的"相似度 xx%"整行已删除，保留 tokens 与行号             |

**唯一可见的删减**：D8 的"相似度"行。这是一个语义错误字段（知识库浏览没有 query，原值是 mock 随机数），删除后卡片仍保留行号、tokens、类型徽标，布局不塌陷。

---

## 8. 实测结果与文档的差异修正

| 项                       | 文档原表述                                       | 实测/实现                                                         | 处理                                                                                                             |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `chunk.metadata` 全 NULL | "依据 `persist.save_chunk` 从未赋值推出"（推定） | `select count(*) filter (where metadata is null)` = **5936/5936** | 已实测确认，无需修正结论；分析文档 8.4 已更新                                                                    |
| 模块数 700               | 推算                                             | SQL 精确 = 700                                                    | 确认                                                                                                             |
| `signature` 有值分布     | 3993                                             | SQL = 3993                                                        | 确认                                                                                                             |
| 仓库状态                 | 文档设想 `pending/synced`                        | 实际只有 `indexed_at` 一个依据，没有"同步中"                      | 已按 `indexed_at` 派生两态，未新增列（符合 D7）                                                                  |
| `tags` 示例              | 文档举例 `["internal","bind","class"]`           | 实际路径末两段常含项目名/测试目录，如 `["gson","it","interface"]` | 规则未变（仍取末两段），只是真实语料的目录结构导致标签更"扁平"；若后续想去掉项目名噪声，可加一行过滤，属可选优化 |
| 模块参数                 | 文档只写"解析 signature"                         | 类型级切片（class/interface/enum）的 `signature` 本身不含参数     | 增补：类/枚举回落到其构造函数 `signature` 解析，仍为 C 档且不编造数据                                            |
| 切片 tokens              | 文档写"字符数估算"                               | `/api/files/{id}/chunks` 原返回体没有 content                     | 新增 `char_count` 字段（`len(content)`），前端按 4 字符≈1 token 展示；`chunk.token_count` 列仍全 NULL，未回填    |
| 模块列表分页             | 文档建议一次返回 700                             | 接口默认 `size=200`，前端显式传 `size=1000`                       | 接口保留分页能力，前端按当前规模一次取全                                                                         |

---

## 9. 本次未做 / 遗留问题

| #   | 项                                                                            | 原因                                                                                                                             | 建议                                                                                                   |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 拉取仓库仍然是 UI 假动作                                                      | 该功能依赖 job 表、worker 进程、clone 参数与 2G2核资源编排，属文档 P1；本次范围是"只读浏览接口对齐"，且需要新增表（第 5 节设计） | 按分析文档第 5 节实施：`POST /api/repos` + `repo_job` 表 + 独立 worker；**需要新增表，须先与用户确认** |
| 2   | 对话问答                                                                      | 后端 `/api/query` 固定 501，本次明确不做                                                                                         | 保持 `/api/chat`、`/api/retrieve` 现状，未改动、未报错                                                 |
| 3   | 顶部命令面板（Cmd+K）仍读 mock `MODULES/REPOS`                                | 不在本次目标页面范围，改动会牵动全局搜索交互                                                                                     | 后续可复用 `useModules`，或把命令面板纳入下一轮                                                        |
| 4   | `src/components/rag/chat/chat-page.tsx` 既有 TS 报错（`Timeout` vs `number`） | 与本次无关，属聊天页历史问题；`next.config.ts` 已 `ignoreBuildErrors`                                                            | 单独修复一次定时器类型                                                                                 |
| 5   | `chunk.sha256 / token_count / content_hash / code_file.sha256` 仍全 NULL      | 文档已判定为二期；本期用 `max(end_line)`、`char_count/4` 替代                                                                    | 二期在 `persist.py` 落库时补齐，可提升增量索引与精确 token 统计                                        |
| 6   | `summary` 仍是声明式（不含 Javadoc）                                          | 库内 `signature` 不含前置文档注释                                                                                                | 二期按文档 §4.9 从 `clone_dir` 提取 Javadoc 写入 `chunk.metadata.javadoc_summary`                      |
| 7   | `/api/modules` 每次请求现算 700 条派生字段                                    | 当前规模毫秒级，改动 SQL 会牺牲可读性                                                                                            | 仓库数量或模块量级上去后，再考虑物化视图/缓存                                                          |
| 8   | 前端 `.next` 旧缓存被重命名为 `.next.bak-20261107`                            | 启动时 Turbopack 报 `os error 5 / EPERM mkdir`（Windows 权限/锁），重命名后重建成功                                              | 新缓存已正常；确认无问题后可删除 `.next.bak-20261107`                                                  |

---

## 10. 验证记录

**后端接口（实连 PostgreSQL）**

| 接口                                | 结果                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/repos`                    | 1 条，`total_files=264 / total_chunks=5936 / total_modules=700 / branch=main / status=synced` |
| `GET /api/repos/3/languages`        | `java: files 264, modules 700, chunks 5936`                                                   |
| `GET /api/repos/3/tree`             | `total=264`，首条 `line_count`/`chunk_count` 正常                                             |
| `GET /api/modules?repo_id=3&size=3` | `total=700`，返回 3 条，`type/ast_path/tags/summary` 均非空                                   |
| `GET /api/modules/5918`             | `code` 非空，`chunk_boundaries=12`，`params` 正常                                             |

**前端页面（浏览器实测）**

| 检查项       | 结果                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| 模块浏览标题 | 「当前仓库共 700 个模块 · 1 种语言」                                      |
| 模块卡片     | 可见 ShrinkingIT / TestAction / UnusedClass，带 Java 标识                 |
| 仓库下拉     | 显示 `gson`                                                               |
| 模块详情     | 代码区显示真实 Java 代码，行号从真实起始行开始；参数区正常；无 JS 报错    |
| 知识库统计卡 | 「总模块数 700 总切片数 5936」                                            |
| 知识库仓库卡 | 「gson / main / 已同步」「共 264 文件 · 5936 切片」                       |
| 切片预览     | 点击 `RawCollectionsExample.java` 出现 7 条真实切片；全页无「相似度」字样 |

> 类型检查：`npx tsc --noEmit` 除 `chat-page.tsx` 的历史错误外无新增错误。
> 启动方式：后端 `.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`；前端 `npm run dev`（3000）。
