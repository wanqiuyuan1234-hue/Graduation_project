# 仓库入库改造与命令面板接入（P1 落地）

> 范围：后端 `Graduation-project-back`、前端 `Graduation-project-front`
> 依据：`frontend-backend-analysis.md`（v2）中列为 P1 的「拉取仓库」与「命令面板真实搜索」
> 结论：按 URL 判重 + 全量重建 + 多仓库隔离 + 进程内任务队列 + 真实进度，均已实现并跑通

---

## 1. 本次改动的意义

改造前有三个硬伤：

1. **重复入库不可靠**：`build_index.py` 按 `repo.name` 判重，克隆目录存在就跳过，导致"重新入库"拿到的是旧代码；清理向量时整库清空（`collection.get()["ids"]`），多仓库会互相破坏。
2. **拉取仓库是假的**：前端 `handleSubmit` 只关闭弹窗加 toast，没有后端接口，也没有任务实体，仓库卡片上的进度条永远停在 0 或 100。
3. **命令面板读 mock**：`command-palette.tsx` 直接渲染 `MODULES`/`REPOS`，搜索的是前端假数据。

本次把三件事一次性打通：

- 入库语义改为「按 URL 唯一 + 全量重建」：重新克隆最新代码 → 重新解析 → 单事务替换 PG 数据 → 按 `repo_id` 清写向量；
- 新增 `repo_job` 任务表与三个阶段接口，前端用轮询展示「正在克隆 / 正在解析 / 正在写库 / 正在向量化 / 已完成 / 失败」；
- 命令面板改为按当前仓库实时请求 `/api/modules?keyword=`，仓库列表也来自后端。

---

## 2. 文件清单

### 2.1 后端新增

| 文件 | 作用 |
|---|---|
| `app/services/ingest.py` | 入库流水线与任务管理器。`run_ingest_job()` 负责克隆→解析→写库→向量化；`IngestManager` 是进程内单并发 worker（1 个线程 + 最多 2 个等待任务）；`recover_interrupted_jobs()` 在启动时收尾上次进程的残留任务 |
| `app/routers/repos.py` | `POST /api/repos`、`GET /api/jobs/{id}`、`POST /api/jobs/{id}/cancel`；负责 URL 校验、重复任务拦截、队列满拒绝 |
| `app/schemas/job.py` | `RepoCreateIn` / `RepoCreateOut` / `JobOut` |
| `scripts/migrate_ingest.py` | 一次性迁移：检查重复 URL → 建 `repo_job` 表与 `uq_repo_url` 唯一索引 → 给历史向量补写 `repo_id`/`file_id` |

### 2.2 后端修改

| 文件 | 改动 |
|---|---|
| `app/config.py` | 新增入库资源参数：`job_queue_limit`、`max_repo_size_mb`、`max_repo_files`、`max_repo_chunks`、`clone_timeout_seconds`、`job_timeout_seconds`、`embed_batch_size` |
| `app/models.py` | `Repo.url` 改为 `nullable=False, unique=True`；新增 `RepoJob` 模型（状态/阶段/进度/计数/错误/取消标记/时间戳） |
| `app/schemas/chunk.py` | `RepoOut` 增加 `job_id`、`phase`、`progress`、`error`、`processed_files`、`processed_chunks` |
| `app/routers/chunks.py` | `/api/repos` 汇总每个仓库最近一次任务，`status` 支持 `syncing` / `failed`，并带出阶段与进度 |
| `app/main.py` | 注册 `repos.router`；增加 lifespan：启动入库 worker、把上次残留的 queued/running 任务标记失败 |
| `app/services/indexing/persist.py` | `get_or_create_repo` 改为按 `url` 命中并复用原 repo 行；`clear_repo` 改为按 `metadata.repo_id` 删除向量，不再整库清空 |
| `app/services/indexing/embedder.py` | `encode()` 支持 `batch_size`；`build_metadata()` 支持写入 `repo_id` / `file_id` |
| `scripts/build_index.py` | 替换为「创建任务 + 调用同一条流水线」的离线入口，删除原先自己实现的 clone/切片/写库/清库逻辑（旧实现可回退：该脚本在 git 历史中完好） |

> `app/services/indexing/cloner.py` 已不再被调用，为保留回退余地没有删除。

### 2.3 前端修改（无新增文件）

| 文件 | 改动 |
|---|---|
| `src/lib/api/client.ts` | 新增 `apiPost`，与 `apiGet` 共用统一的错误解析（非 2xx 抛 `ApiError`，优先取 `detail`） |
| `src/lib/api/adapters.ts` | `ApiRepo` 增加任务字段；新增 `ApiJob`、`ApiRepoCreateResult`；`toRepo` 映射 `syncing`/`failed` 状态与进度、阶段、错误、任务 id、处理计数 |
| `src/lib/api/hooks.ts` | 新增 `submitRepo()`、`cancelJob()`、`useReposPolling()`、`useModuleSearch()`（200ms 防抖，限定当前仓库） |
| `src/lib/rag/types.ts` | `Repo` 增加 `syncPhase`、`syncError`、`jobId`、`processedFiles`、`processedChunks`、`totalFilesInJob`、`totalChunksInJob` |
| `src/components/rag/knowledge/knowledge-base.tsx` | 拉取仓库弹窗接 `POST /api/repos`；仓库卡片显示真实阶段/百分比/文件与切片计数；同步中可取消；失败显示错误并可重试；「重新同步」走真实接口；有任务时每 3 秒轮询 |
| `src/components/rag/shared/command-palette.tsx` | 删除 `MODULES`/`REPOS` 依赖，模块改 `useModuleSearch(activeRepoId, keyword)`，仓库列表改 `useRepos()` |

---

## 3. 接口契约

### 3.1 `POST /api/repos`

提交入库任务。

请求：

```json
{ "url": "https://github.com/google/gson.git" }
```

响应 `202`：

```json
{
  "job_id": 2,
  "repo_id": 3,
  "status": "queued",
  "phase": "queued",
  "message": "任务已排队，将全量重建该仓库"
}
```

`repo_id` 对首次入库的仓库为 `null`（仓库行由 worker 在克隆阶段创建），前端通过任务进度或列表刷新拿到。

错误码：

| 状态码 | 场景 | detail 示例 |
|---|---|---|
| 422 | 不是 http/https 完整 URL | `仓库地址必须是 http(s):// 开头的完整 git URL` |
| 409 | 同一 URL 已有 queued/running 任务 | `该仓库已有进行中的任务（job 2，状态 running）` |
| 429 | 等待队列已满（已有 1 个运行 + 2 个排队） | `入库队列已满（正在处理 1 个，排队 2 个），请稍后再试` |

### 3.2 `GET /api/jobs/{id}`

```json
{
  "id": 2,
  "repo_id": 3,
  "repo_url": "https://github.com/google/gson.git",
  "status": "running",
  "phase": "embedding",
  "progress": 87,
  "total_files": 266,
  "processed_files": 266,
  "total_chunks": 5990,
  "processed_chunks": 3584,
  "message": "正在向量化 3584/5990 个切片",
  "error": null,
  "created_at": "2026-11-09T08:27:00Z",
  "started_at": "2026-11-09T08:27:01Z",
  "finished_at": null
}
```

`status`：`queued` / `running` / `succeeded` / `failed` / `canceled`
`phase`：`queued` / `cloning` / `parsing` / `persisting` / `embedding` / `done` / `canceled`

`404`：任务不存在。

### 3.3 `POST /api/jobs/{id}/cancel`

- 排队中的任务：立即从等待队列摘除，状态置 `canceled`；
- 运行中的任务：写入 `cancel_requested`，在下一个检查点（克隆轮询、每 10 个文件、每个向量批次）生效；
- 已结束的任务：`409`。

### 3.4 `GET /api/repos`（扩展）

原字段不变，新增：

```json
{
  "status": "syncing",
  "job_id": 2,
  "phase": "embedding",
  "progress": 87,
  "error": null,
  "processed_files": 266,
  "processed_chunks": 3584
}
```

`status` 判定：最近任务为 queued/running → `syncing`；最近任务 failed → `failed`；否则按 `indexed_at` 给出 `synced` / `pending`。

### 3.5 命令面板搜索

复用已有 `GET /api/modules`：

```
GET /api/modules?repo_id=3&keyword=JsonAdapter&size=8
```

`keyword` 已支持模块名 / 文件路径 / 签名匹配（`app/routers/modules.py`），本次不需要新增后端接口。

---

## 4. 入库流水线与状态机

```
POST /api/repos
   └─ 创建 repo_job(status=queued) → 入队（等待队列上限 2）
        └─ worker 取出
             phase=cloning     克隆到 data/repos/.staging-<name>-<job_id>，校验体积/文件数
             phase=parsing     逐文件 AST + 固定窗口切片（内存中），校验切片总数；替换旧克隆目录
             phase=persisting  单事务：删除该 repo 的旧 chunk/code_file → 插入新数据 → commit
             phase=embedding   按 repo_id 删旧向量 → 分批编码（batch 16）→ 分批写入 Chroma（每批 256）
             phase=done        repo.indexed_at=now，status=succeeded，progress=100
```

失败与取消：

- **写入前失败**（克隆/上限/解析）：不触碰旧索引，任务 `failed`，错误信息带「原有索引未受影响」；
- **写入后失败**（写库/向量化）：删除该仓库的 PG 文件与切片、删除该 `repo_id` 的向量、`indexed_at` 置空，任务 `failed`，保证不留半成品；
- **取消**：同上按是否已写入决定是否清理；任务 `canceled`。

进度换算：克隆 1%，解析 10%–60%，写库 62%–70%，向量化 70%–99%，完成 100%。

---

## 5. 并发与资源控制（2G2核）

| 参数 | 值 | 位置 |
|---|---|---|
| 同时运行任务数 | 1 | `IngestManager` 单 worker 线程 |
| 等待队列 | 2 | `settings.job_queue_limit` |
| 超出队列 | 直接 429 | `app/routers/repos.py` |
| 仓库体积上限 | 150 MB（不含 `.git`） | `max_repo_size_mb` |
| 文件数上限 | 3000 | `max_repo_files` |
| 切片数上限 | 20000 | `max_repo_chunks` |
| 克隆超时 | 300s | `clone_timeout_seconds` |
| 单任务总超时 | 1800s（30min） | `job_timeout_seconds` |
| embedding batch | 16 | `embed_batch_size` |
| Chroma 单次写入 | 256 条 | `ingest.py: CHROMA_ADD_BATCH` |

未引入 Redis / Celery / 消息队列：队列与 worker 都在 FastAPI 进程内，重启即丢失（见遗留问题）。

超出资源上限时：体积/文件数在克隆后立即失败；切片数在解析过程中累加，一旦超过上限立刻终止，此时尚未写库，旧索引保持不动。

---

## 6. 多仓库隔离

1. **判重键**：`repo.url` 唯一索引 `uq_repo_url`；`repo.name` 不唯一。
2. **克隆目录**：默认 `data/repos/<name>`；若同名目录已被另一个 URL 占用，追加 URL 尾部哈希（`<name>-<hash>`），避免互相覆盖。
3. **PG 数据**：`code_file.repo_id` 与 `chunk.file_id` 本来就有 CASCADE；重建时只删当前 `repo_id` 的行，单事务提交。
4. **向量隔离**：每条向量元数据写入 `repo_id`（另加 `file_id`），清理用 `collection.delete(where={"repo_id": repo_id})`；向量 id 直接使用 `chunk.id` 的字符串，天然唯一且便于精确删除。
5. **前端**：知识库仓库列表、模块浏览仓库下拉、命令面板仓库组都来自 `GET /api/repos`，可选择「全部仓库」（模块页）或任一仓库（命令面板限定当前仓库）。

迁移脚本已给历史 5936 条向量补写 `repo_id`/`file_id`，因此旧数据也能被按仓库精确清理，无需为了元数据重新向量化。

---

## 7. 前端接入点

- **拉取仓库**：`knowledge-base.tsx` 的 `PullRepoDialog.handleSubmit` → `submitRepo(url)` → `POST /api/repos`；成功后关闭弹窗、刷新仓库列表，失败保留弹窗并在弹窗内与 toast 同时显示错误。
- **进度展示**：仓库卡片在 `repo.status === "syncing"` 时显示阶段文案（`PHASE_LABELS`）、百分比进度条、`解析 x/y 文件`，向量化阶段追加 `向量化 x/y 切片`，并提供「取消」；`failed` 时显示错误与「重试」。
- **轮询**：`useReposPolling(repos.some(r => r.status === "syncing"))`，3 秒一次调用 `GET /api/repos`，没有任务时不轮询。
- **重新同步**：卡片菜单的「重新同步」调用同一个 `submitRepo(repo.url)`，语义即全量重建。
- **命令面板**：`useModuleSearch(activeRepoId, keyword, 8)`；空关键词展示当前仓库前 8 个模块，输入后 200ms 防抖请求后端；仓库组来自 `useRepos()`，没有仓库时给出空态提示。

未新增页面：进度完全由现有弹窗 + 仓库卡片承载，符合"优先不新增页面"的约定。

---

## 8. 验证情况（实际执行）

### 8.1 迁移

`scripts/migrate_ingest.py` 执行结果：

- 现有库只有 1 条 repo 且 URL 无重复 → 唯一索引创建成功（`uq_repo_url`）；
- `repo_job` 表创建成功；
- 历史向量元数据补写完成（迁移时集合共 5936 条）。

### 8.2 完整入库（job 2，gson 全量重建）

通过 `POST /api/repos` 提交，轮询 `GET /api/jobs/2`：

| 时间点 | 阶段 | 进度 | 计数 |
|---|---|---|---|
| 0s | cloning | 1% | — |
| 3s | persisting | 63% | 40/266 文件 |
| 12s | embedding | 70% | 266/266 文件，0/5990 切片 |
| 132s | embedding | 71% | 256/5990 切片 |
| 513s | done | 100% | 5990/5990 切片，`succeeded` |

结果（`GET /api/repos`）：`gson` / `synced` / `main` / 266 文件 / 5990 切片 / 706 模块；`repo.indexed_at` 已更新；Chroma 总数 5990，全部带 `repo_id=3`、`file_id`，id 即 chunk id。

### 8.3 失败路径（job 3，不存在的仓库）

提交 `https://github.com/google/gson-does-not-exist-xyz.git`：

- 克隆阶段失败，任务 `failed`，错误为 `Repository not found`；
- 已有 `gson` 仓库的 266 文件 / 5990 切片与向量**未受影响**（写入前失败不清理旧索引）；
- 失败仓库在列表中显示 `failed`、0 文件；
- 测试产生的 repo/job 行已删除，未留在库中。

### 8.4 前端（浏览器实测）

- 知识库页：统计「仓库 1 / 总模块 706 / 总切片 5990」，`gson` 卡片「已同步」、266 文件、分支 `main`，无错误提示；
- 命令面板：`Ctrl+K` 输入 `JsonAdapter`，请求 `GET /api/modules?repo_id=3&keyword=JsonAdapter&size=8` 返回 200，列表出现 `JsonAdapterAnnotationTypeAdapterFactory` 及其文件路径；点击后进入模块详情，显示真实 Java 代码与行号；
- `npx tsc --noEmit`：仅剩历史遗留的 `chat-page.tsx(579,7)` 类型错误（与本次无关，`next.config.ts` 已忽略构建错误）。

### 8.5 验证中发现并修复的问题

1. **Windows 只读文件导致替换克隆目录失败**：`shutil.rmtree` 无法删除 `.git` 下的只读文件，随后 `rename` 抛 `WinError 183`。已增加 `onerror` 回调 `chmod +w` 后重试删除，并在删除失败时给出明确错误。
2. **写入前失败误清旧索引**：一开始无论哪个阶段失败都会执行清理，导致"克隆目录替换失败"时把已有 5936 条数据清空。已引入 `wrote` 标记，只有进入写库阶段后才清理。

---

## 9. 遗留问题

1. **任务队列不持久化**：队列在进程内存中，服务重启（包括 `uvicorn --reload` 触发的自动重载）会把 queued/running 任务标记为 `failed`。开发时改后端代码请留意正在跑的任务。
2. **不要同时跑两个后端进程**：两个进程各自有 worker 且都会在启动时回收未完成任务，连同一个库会互相干扰。本地只保留一个 8000 端口实例即可。
3. **取消不是瞬时**：克隆阶段每 0.5s 检查一次、解析每 10 个文件、向量化每 256 条检查一次；正在进行的单次 `model.encode` 无法打断。
4. **写入后失败会清空该仓库**：这是为保证"不留半成品"的取舍——失败后仓库变为空索引（卡片显示失败），不再保留旧版本。若希望保留旧数据，需要引入影子表/双写切换，成本更高，本次未做。
5. **前端弹窗中的分支/切片策略/embedding 选项未生效**：后端固定克隆默认分支、切 `ast + fixed`、使用 `settings.embedding_model`。UI 保留但仅 `url` 会提交，后续要做多策略再扩展契约。
6. **同名不同 URL 的仓库**：克隆目录已加哈希后缀，但 `name` 不唯一，前端展示会出现两个同名卡片；如需区分可在列表显示 URL 尾段。
7. **模块浏览「全部仓库」最多 1000 条**：`useModules` 的既有 `size=1000` 上限，仓库变多后需要分页或后端提供跨仓库分页。
8. **查询链路未接**：`/api/query` 仍是 501，本轮的向量元数据与按仓库清理尚无法通过问答页面体现，仅影响后续检索功能。
9. **仓库删除/清理接口未提供**：失败仓库目前只能手工删除数据库记录；如需要可在后续加 `DELETE /api/repos/{id}`（同时按 `repo_id` 清向量）。

---

## 10. 问题修复（实测反馈）

### 10.1 点击「重新同步」看不到任务进度

**原因**：重新同步与首次「拉取仓库」走的是同一个 `POST /api/repos` → `submitRepo()`，但任务行创建时 `repo_id` 为 `NULL`，要等 worker 真正开始执行时才回填。而 `GET /api/repos` 是用 `RepoJob.repo_id.in_(repo_ids)` 找每个仓库的最近任务：

- 提交成功的瞬间，`/api/repos` 查不到这条任务；
- 仓库行已有 `indexed_at`，于是 `status` 仍返回 `synced`，不是 `syncing`；
- 前端 `useReposPolling` 的开关是 `repos.some(r => r.status === "syncing")`，不成立 → 不启动轮询；卡片也只在 `status === "syncing"` 时渲染阶段/百分比 → 什么进度都看不到。

次因：`loadRepos(true)` 遇到在途请求（例如上一次 3s 轮询还没返回）会直接复用旧 promise，导致"提交后立即强刷"可能拿到提交前的旧列表。

**改动文件**：

| 文件 | 改动 |
|---|---|
| `app/routers/repos.py` | 创建任务前先按 `url` 查/建 `Repo`，`flush()` 拿到自增 id 后写入 `job.repo_id`；队列满（429）时回滚刚建的仓库行；`IntegrityError`（并发建同一 URL）返回 409 |
| `app/services/ingest.py` | `_sanitize_name` / `_resolve_clone_dir` 改为公开的 `derive_repo_name` / `resolve_clone_dir`，供路由复用；worker 内部同步更新调用 |
| `src/lib/api/hooks.ts`（前端） | `loadRepos(force)` 遇到在途 promise 时改为 `promise.then(() => loadRepos(true))`，提交后的强刷不再被旧请求吞掉 |

弹窗提交成功后立即关闭不是问题：进度本来就由仓库卡片承载，只要 `status` 能变成 `syncing` 就能看到；未新增整页。

**验证（job 5，gson 重新同步）**：

- `POST /api/repos` 响应：`{"job_id":5,"repo_id":3,"status":"queued","phase":"queued"}`——`repo_id` 提交时即有值；
- 1 秒后 `GET /api/repos`：`status=syncing / job_id=5 / phase=parsing / progress=60`；
- 轮询期间阶段与百分比持续变化：`persisting 67% → embedding 70%（正在加载向量模型）→ embedding 71%…98% → done 100%`，嵌入阶段每 5 秒都能看到 `processed_chunks` 增长（256 → 512 → … → 5990）。

### 10.2 HuggingFace 连接重置导致 embedding 反复重试

**本地缓存确认完整**：`C:\Users\w\.cache\huggingface\hub\models--BAAI--bge-small-zh-v1.5\snapshots\7999e1d3…` 下 `config.json`、`config_sentence_transformers.json`、`modules.json`、`sentence_bert_config.json`、`tokenizer.json`(439,125B)、`vocab.txt`(109,540B)、`1_Pooling/config.json` 均在；`blobs` 中权重 `model.safetensors` 为 95,827,648B。

**方案选择**：缓存完整，因此采用「优先本地加载、完全不联网」方案，**未新增 HF_ENDPOINT 配置项**（国内镜像只作为缓存缺失时的备选，代码中的错误提示会说明如何启用）。没有改动已经跑通的在线下载路径。

**改动文件**：

| 文件 | 改动 |
|---|---|
| `app/config.py` | 新增 `embedding_local_only: bool = True`、`embedding_load_timeout_seconds: int = 120` |
| `app/services/indexing/embedder.py` | 新增 `hf_hub_dir()` / `local_model_available()`（只读文件系统判断缓存是否完整）；命中缓存时设置 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 并传 `local_files_only=True`，彻底跳过 ETag/HEAD 校验与 5 次退避重试；未命中且允许联网时收紧 `HF_HUB_ETAG_TIMEOUT=5`/`HF_HUB_DOWNLOAD_TIMEOUT=60`；模型加载放入独立线程并受 `embedding_load_timeout_seconds` 约束，超时立即抛错；新增 `get_embedder()` 进程内单例；顺带修复 `encode()` 在 `batch_size=None` 时直接传给 sentence-transformers 6.2.0 会抛 `TypeError` 的问题 |
| `app/services/ingest.py` | 改为 `get_embedder(settings.embedding_model)`；加载失败/超时包装成 `IngestError`（`向量模型不可用：…`），直接写入 job 的 `error`，不再让任务长时间无反馈 |

**是否每次任务都重新加载**：改造前是，每次入库都会新建 `Embedder`（同时触发一次联网校验）；现在 `get_embedder()` 在进程内复用同一实例，只有第一次任务加载。内存代价为 bge-small 权重约 96MB + 运行时开销（约 100–150MB 量级），在 2G 约束下可接受；换来的是后续任务省掉约 12s 的 torch/权重初始化，也不再重复联网。

**验证数据**：

- 冷进程离线加载：`load_seconds=11.7`（含 torch 导入）、`HF_HUB_OFFLINE=1`、向量维度 512，全程无网络请求；
- job 5 全量重建耗时 **200s**（`started_at 11:29:14` → `finished_at 11:32:34`，266 文件 / 5990 切片），上一轮 job 2 为 **513s**，减少约 313s；
- 嵌入阶段不再出现"卡住几分钟"：`phase=embedding` 后约 15s（模型加载）即开始输出切片计数，之后稳定增长。

**关于"513 秒里约 8 分钟空白来自网络重试"的判断**：基本成立，但要修正量级。被打断的 job 4 在 360s 内只完成到 512/5990 切片即停在 `embedding`；修复后同样走到 512 切片只需约 30s，说明原流程确实有数分钟消耗在无进度的网络校验/重试上。但由于 job 4 是被重启打断、没有自然结束，无法精确证实恰好 8 分钟；可确认的是重试阻塞真实存在，且修复后已消失。

**前端复测说明**：本机 `Graduation-project-front\.next` 目录被占用（`next dev` 报 lockfile `拒绝访问`，且目录无法重命名），本次无法启动 dev server 做浏览器复测；已按接口返回字段与卡片渲染条件逐条核对（`status=syncing`、`phase`、`progress`、`processed_files/chunks` 均可取到），`npx tsc --noEmit` 仍只剩历史遗留的 `chat-page.tsx(579,7)`。
