# Code RAG 一期（索引构建管线）需求文档

> Spec：rag-one
> 生成时间：2026-11-02
> 状态：待审批

## 需求原文

以「同一代码仓库、同一版本」为对象，构建一期**索引构建管线**：克隆仓库 → 遍历 Java 源码 → tree-sitter AST 层级切分 → 向量化 → 落地 PostgreSQL（原文与元信息）与 ChromaDB（向量与检索元信息）。一期不实现检索与问答，仅预留接口契约。

本项目研究的是「同一仓库、同一版本下，不同切分策略（AST 层级切分 vs 固定切分）对检索效果的对比」，因此**不存 commit_hash、不做跨版本对比**。切分采用**层级切分**：类/接口/枚举各成一片，其下方法/构造器作为子切片，通过 `parent_chunk_id` 建立父子层级。

后端需要支持**本地与服务器上一键切换数据库连接**：本地通过 `docker start code-rag-pg` 启动 PostgreSQL，后端以 `localhost` 连接；服务器上后端与 PostgreSQL 各自独立成容器，后端通过服务名连接 PG。账号密码 `rag/rag123`。

## 需求概述

将单个代码仓库（Gson）转换为「可检索的结构化切片 + 向量」，一期只覆盖建库（离线索引）流程，为二期的检索链路、三期的问答生成提供数据基础与稳定的接口契约。

### 核心边界

- **单仓库单版本**：克隆后不再提交，模型不做版本维度（无 `commit_hash`、无 `snapshot` 表）。
- **对比维度**：切分策略 `ast`（层级切分）与 `fixed`（固定切分）基线；检索策略对比属二期，一期只预留契约。
- **接口预留**：切片浏览接口一期实现（只读）；问答接口 `POST /api/query` 仅定契约、返回 501。

## 用户故事

### R-001 克隆目标代码仓库
**角色**：建库流程<br>
**功能**：根据配置中的仓库地址克隆源码到本地目录，已存在时跳过<br>
**价值**：为后续遍历、切分提供稳定的源码快照，避免重复克隆

### R-002 遍历 Java 源码文件
**角色**：建库流程<br>
**功能**：递归查找 `.java` 文件，生成待切分文件清单<br>
**价值**：确定切分输入范围

### R-003 AST 层级切分
**角色**：切分模块<br>
**功能**：用 tree-sitter 解析每个 Java 文件，将类/接口/枚举切为类型级切片，其下方法/构造器切为成员级切片，通过 `parent_chunk_id` 关联；同步提取 name、signature、start/end_line、content、chunk_type、chunk_index<br>
**价值**：产出结构完整、边界正确的切片，是「语法感知切分」的核心产出与后续实验自变量

### R-004 固定切分基线
**角色**：切分模块<br>
**功能**：按固定字数/行数滑窗切分，标记 `strategy=fixed`、`chunk_type=fixed`，无 name/signature/parent<br>
**价值**：作为消融实验的对照组，与 AST 切分形成对比

### R-005 AST 解析失败兜底
**角色**：切分模块<br>
**功能**：解析失败的文件标记 `parse_ok=false`，改用 fixed 切分兜底入库<br>
**价值**：保证建库不中断，失败样本可供后续实验分析

### R-006 增强文本构造
**角色**：切分/向量化模块<br>
**功能**：入库与向量化前拼接语义前缀（`[class: Gson]` / `[method: Gson] signature`）到原文之上，作为 embedding 输入<br>
**价值**：把类名与方法签名等高价值标识词注入向量，提升二期语义检索命中率

### R-007 文本向量化
**角色**：向量化模块<br>
**功能**：用 sentence-transformers 加载 `BAAI/bge-small-zh-v1.5`，对每个切片增强文本计算 512 维向量<br>
**价值**：为 Chroma 提供检索所需的向量表示

### R-008 落库 PostgreSQL 与 ChromaDB
**角色**：持久化模块<br>
**功能**：PG 存 repo/code_file/chunk 原文与元信息，Chroma 存增强文本 + 向量 + 检索元信息，二者以 `chunk.id` 一一对应<br>
**价值**：原文与向量分离存储，改模型可重灌向量而不动 PG

### R-009 建库幂等重建
**角色**：持久化模块<br>
**功能**：重跑建库前清空该 repo 的 code_file/chunk 及 Chroma 对应文档，全量重建<br>
**价值**：避免重复累积脏数据，保证建库可重复执行

### R-010 数据库连接一键切换（本地/服务器）
**角色**：配置模块<br>
**功能**：通过环境变量区分部署环境，本地连 `localhost`、服务器连 PG 服务名，账号 `rag/rag123`、库 `code_rag`、端口 5432 两边一致<br>
**价值**：同一份代码在本地开发与服务器部署间无缝切换，无需改代码

### R-011 切片浏览接口（只读）
**角色**：前端<br>
**功能**：提供仓库列表、文件分页列表、某文件切片列表、单切片详情的 GET 接口，返回层级字段，前端自行组装树<br>
**价值**：一期即可通过接口验证切分结果的正确性与层级结构

### R-012 问答接口契约预留
**角色**：前端 / 后续开发<br>
**功能**：定好 `POST /api/query` 的入参与出参模型，一期返回 501 占位<br>
**价值**：三期不改契约直接填充实现，接口稳定

## 验收标准

### AC-001 建库脚本可运行
- **GIVEN** 依赖已安装、PG 与仓库配置正确
- **WHEN** 执行 `python scripts/build_index.py`
- **THEN** 脚本无报错跑通，最终打印汇总统计与若干抽样切片（内容 + 行号）

### AC-002 数据双写一致
- **GIVEN** 建库完成
- **WHEN** 分别查询 PG `chunk` 表与 Chroma 集合
- **THEN** PG 有切片数据，Chroma 有对应向量，且 `chunk.id` 与 Chroma 文档 id 一一对应

### AC-003 切片边界正确
- **GIVEN** 建库完成
- **WHEN** 人工查看打印出的切片内容与行号
- **THEN** 类/方法切片完整未被切断，父子层级（parent_chunk_id）指向正确

### AC-004 层级切分字段完整
- **GIVEN** 某 Java 文件含类及其方法
- **WHEN** 查询该文件的 `ast` 切片列表
- **THEN** 类切片 `chunk_type=class`、`parent_chunk_id=null`；方法切片 `chunk_type=method`、`parent_chunk_id` 指向类切片；name/signature/start_line/end_line/chunk_index 均非空

### AC-005 固定切分基线存在
- **GIVEN** 建库完成
- **WHEN** 查询 `strategy=fixed` 的切片
- **THEN** 存在 fixed 切片，且其 name/signature/parent_chunk_id 均为空、chunk_type=fixed

### AC-006 解析失败样本兜底
- **GIVEN** 存在无法被 tree-sitter 解析的 Java 文件
- **WHEN** 建库运行
- **THEN** 该文件 `parse_ok=false`，仍产出 fixed 兜底切片，建库不中断

### AC-007 数据库本地/服务器切换无缝
- **GIVEN** 一份代码
- **WHEN** 本地设置对应环境变量并 `docker start code-rag-pg`
- **THEN** 后端连接 `rag/rag123@localhost:5432/code_rag` 成功
- **WHEN** 服务器上后端容器与 PG 容器按同一配置部署
- **THEN** 后端仅改环境变量即可连接 PG 服务名，无需改代码

### AC-008 切片浏览接口可读
- **GIVEN** 建库完成、FastAPI 服务启动
- **WHEN** 调用文件列表与切片列表接口
- **THEN** 返回仓库、文件、切片层级元信息，按 chunk_index 稳定排序

### AC-009 问答接口返回契约占位
- **GIVEN** FastAPI 服务启动
- **WHEN** 调用 `POST /api/query`
- **THEN** 返回 501 Not Implemented，且出入参结构符合契约定义

## 范围外事项

- **二期检索链路**：向量检索、关键词/混合检索、重排，均不在一期实现。
- **三期生成链路**：问答生成、引用溯源，不在一期实现（仅预留接口）。
- **会话与上下文管理**：session/message 表与多轮对话，不在一期实现。
- **跨版本对比、增量索引**：一期为全量重建，`sha256`/`content_hash` 仅预留。
- **评估实验**：测试集构建、指标计算与绘图，不在一期实现。
- **字段/注解/文档注释切分**：一期默认只切类/接口/枚举/方法/构造器（作为待决事项，如需纳入二期待定）。

## 约束与假设

- **技术栈**：Python 3.10+ / FastAPI / SQLAlchemy / PostgreSQL / ChromaDB / tree-sitter(-java) / sentence-transformers。
- **数据库账号**：`rag/rag123`，库名 `code_rag`，端口 5432（本地与服务器一致）。
- **部署差异**：仅数据库主机地址不同（本地 `localhost`、服务器 PG 服务名），其余连接参数一致。
- **单模型假设**：embedding 用 `BAAI/bge-small-zh-v1.5`（512 维）；换模型需重灌 Chroma，PG 不受影响。
- **依赖**：`tree-sitter`、`tree-sitter-java` 未在 requirements.txt 中，需先评估安装。
- **仓库对象**：以 Gson 为默认目标仓库。