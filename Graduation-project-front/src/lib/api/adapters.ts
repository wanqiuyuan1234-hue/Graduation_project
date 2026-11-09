/**
 * 后端 DTO 与前端领域模型的适配层。
 *
 * 后端字段为 snake_case，前端为 camelCase；D 档字段（highlights / callChain /
 * references / relatedModuleIds / 切片相似度）在后端返回空值，这里显式映射为
 * 空数组，交给页面现有的空态渲染，不做任何 mock 填充。
 */

import type {
  ChunkBoundary,
  CodeModule,
  FileTreeNode,
  Language,
  ModuleParameter,
  ModuleType,
  Repo,
  RepoStatus,
} from "@/lib/rag/types";

export interface ApiLanguageStat {
  language: string;
  file_count: number;
  module_count: number;
  chunk_count: number;
}

export interface ApiRepo {
  id: number;
  name: string;
  url: string | null;
  clone_dir: string | null;
  created_at: string;
  indexed_at: string | null;
  status: string;
  branch: string | null;
  total_files: number;
  total_chunks: number;
  total_modules: number;
  strategies: string[];
  languages: ApiLanguageStat[];
  embedding_model: string | null;
}

export interface ApiModule {
  module_id: number;
  repo_id: number;
  name: string | null;
  chunk_type: string;
  type: string;
  file_id: number;
  file_path: string;
  language: string | null;
  start_line: number;
  end_line: number;
  line_count: number;
  chunk_count: number;
  parent_chunk_id: number | null;
  summary: string;
  tags: string[];
  complexity: "low" | "medium" | "high";
  ast_path: string;
  indexed_at: string;
}

export interface ApiModuleParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default: string | null;
}

export interface ApiChunkBoundary {
  chunk_id: number;
  label: string;
  chunk_type: string;
  start_line: number;
  end_line: number;
  token_count: number;
  is_self: boolean;
}

export interface ApiModuleDetail extends ApiModule {
  code: string;
  parameters: ApiModuleParameter[];
  chunk_boundaries: ApiChunkBoundary[];
}

export interface ApiModulePage {
  total: number;
  page: number;
  size: number;
  items: ApiModule[];
}

export interface ApiFileTreeItem {
  file_id: number;
  path: string;
  language: string | null;
  line_count: number;
  chunk_count: number;
}

export interface ApiFileTree {
  repo_id: number;
  total: number;
  items: ApiFileTreeItem[];
}

export interface ApiChunk {
  chunk_id: number;
  chunk_type: string;
  name: string | null;
  signature: string | null;
  start_line: number;
  end_line: number;
  strategy: string;
  parent_chunk_id: number | null;
  chunk_index: number | null;
  char_count: number;
}

const KNOWN_LANGUAGES: Language[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "rust",
  "java",
];

const MODULE_TYPES: ModuleType[] = [
  "function",
  "class",
  "interface",
  "enum",
  "component",
  "hook",
  "util",
  "service",
  "config",
  "page",
];

/** 未知语言统一归到 "unknown"，避免 LANGUAGE_META 索引为 undefined。 */
export function toLanguage(raw: string | null | undefined): Language {
  const value = (raw ?? "unknown").toLowerCase();
  return (KNOWN_LANGUAGES as string[]).includes(value) ? (value as Language) : "unknown";
}

function toModuleType(raw: string): ModuleType {
  return (MODULE_TYPES as string[]).includes(raw) ? (raw as ModuleType) : "function";
}

/** ISO 时间 → "YYYY-MM-DD HH:mm"（本地时区），与前端既有排序/展示格式一致。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function toRepo(api: ApiRepo): Repo {
  const primaryLanguage = api.languages[0]?.language ?? "unknown";
  // 后端 strategies 是 ["ast", "fixed"]；前端只展示一个主策略标签
  const strategy = api.strategies.includes("ast")
    ? "ast"
    : (api.strategies[0] ?? "unknown");

  return {
    id: String(api.id),
    name: api.name,
    url: api.url ?? "",
    branch: api.branch ?? "—",
    // D6：后端无仓库描述，返回空串，卡片按条件隐藏
    description: "",
    defaultLanguage: toLanguage(primaryLanguage),
    status: (api.status === "synced" ? "synced" : "pending") as RepoStatus,
    lastSyncAt: formatDateTime(api.indexed_at),
    totalModules: api.total_modules,
    totalChunks: api.total_chunks,
    totalFiles: api.total_files,
    embeddingModel: api.embedding_model ?? "—",
    sliceStrategy: strategy,
    // D7：无任务表，只有已完成/待处理两态
    progress: api.status === "synced" ? 100 : 0,
  };
}

export function toCodeModule(api: ApiModule): CodeModule {
  return {
    id: String(api.module_id),
    repoId: String(api.repo_id),
    name: api.name ?? api.chunk_type,
    type: toModuleType(api.type),
    filePath: api.file_path,
    language: toLanguage(api.language),
    summary: api.summary,
    highlights: [], // D1
    chunkCount: api.chunk_count,
    lineCount: api.line_count,
    code: "",
    parameters: [],
    callChain: [], // D2
    astPath: api.ast_path,
    chunkBoundaries: [],
    relatedModuleIds: [], // D4
    references: [], // D3
    tags: api.tags,
    updatedAt: formatDateTime(api.indexed_at),
    complexity: api.complexity,
  };
}

export function toCodeModuleDetail(api: ApiModuleDetail): CodeModule {
  const parameters: ModuleParameter[] = api.parameters.map((p) => ({
    name: p.name,
    type: p.type,
    required: p.required,
    description: p.description,
    // D5：Java 无默认值语义，后端返回 null
    default: p.default ?? undefined,
  }));

  const chunkBoundaries: ChunkBoundary[] = api.chunk_boundaries.map((b) => ({
    chunkId: String(b.chunk_id),
    startLine: b.start_line,
    endLine: b.end_line,
    label: b.label,
    tokenCount: b.token_count,
  }));

  return {
    ...toCodeModule(api),
    code: api.code,
    parameters,
    chunkBoundaries,
  };
}

/** 扁平文件列表 → 目录树（目录节点按路径聚合行数/切片数）。 */
export function toFileTree(items: ApiFileTreeItem[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  const ensureDir = (segments: string[]): FileTreeNode[] => {
    let level = roots;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let dir = dirMap.get(path);
      if (!dir) {
        dir = {
          name: segment,
          path,
          type: "dir",
          chunkCount: 0,
          lineCount: 0,
          children: [],
        };
        dirMap.set(path, dir);
        level.push(dir);
      }
      level = dir.children as FileTreeNode[];
    }
    return level;
  };

  for (const item of items) {
    const segments = item.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const fileName = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);
    const siblings = ensureDir(parentSegments);

    siblings.push({
      name: fileName,
      path: item.path.replace(/\\/g, "/"),
      type: "file",
      id: String(item.file_id),
      language: toLanguage(item.language),
      chunkCount: item.chunk_count,
      lineCount: item.line_count,
    });

    // 累加到所有祖先目录，便于树头部显示"共 N 文件 / M 切片"
    let accPath = "";
    for (const segment of parentSegments) {
      accPath = accPath ? `${accPath}/${segment}` : segment;
      const dir = dirMap.get(accPath);
      if (dir) {
        dir.chunkCount += item.chunk_count;
        dir.lineCount += item.line_count;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(roots);
}
