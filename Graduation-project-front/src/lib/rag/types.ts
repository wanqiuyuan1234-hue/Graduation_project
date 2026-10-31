// Core domain types for the Code Repository RAG Q&A system

export type RepoStatus = "synced" | "syncing" | "failed" | "pending";

export type ModuleType =
  | "function"
  | "class"
  | "component"
  | "hook"
  | "util"
  | "service"
  | "config"
  | "page";

export type Language = "typescript" | "tsx" | "javascript" | "jsx" | "python" | "go" | "rust";

export interface Repo {
  id: string;
  name: string;
  url: string;
  branch: string;
  description: string;
  defaultLanguage: Language;
  status: RepoStatus;
  lastSyncAt: string;
  totalModules: number;
  totalChunks: number;
  totalFiles: number;
  embeddingModel: string;
  sliceStrategy: SliceStrategy["id"];
  progress: number; // 0-100 sync progress
}

export type SliceStrategyId =
  | "ast-semantic"
  | "ast-function"
  | "fixed-token"
  | "markdown-header"
  | "line-window";

export interface SliceStrategy {
  id: SliceStrategyId;
  name: string;
  description: string;
  recommended: boolean;
  options?: {
    label: string;
    key: string;
    type: "number" | "select";
    value: number | string;
    options?: string[];
    min?: number;
    max?: number;
  }[];
}

export interface ModuleParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface CallEdge {
  name: string;
  direction: "incoming" | "outgoing";
  filePath: string;
  kind: ModuleType;
}

export interface ChunkBoundary {
  chunkId: string;
  startLine: number;
  endLine: number;
  label: string;
  tokenCount: number;
}

export interface ReferenceRecord {
  id: string;
  moduleId: string;
  moduleName: string;
  filePath: string;
  line: number;
  snippet: string;
  kind: "import" | "call" | "extend" | "type-ref";
}

export interface CodeModule {
  id: string;
  repoId: string;
  name: string;
  type: ModuleType;
  filePath: string;
  language: Language;
  summary: string; // 一句话特征
  highlights: string[]; // 2-3 个重点
  chunkCount: number;
  lineCount: number;
  code: string;
  parameters: ModuleParameter[];
  callChain: CallEdge[];
  astPath: string;
  chunkBoundaries: ChunkBoundary[];
  relatedModuleIds: string[];
  references: ReferenceRecord[];
  tags: string[];
  updatedAt: string;
  complexity: "low" | "medium" | "high";
}

export interface SourceChunk {
  id: string;
  moduleId: string;
  repoId: string;
  filePath: string;
  language: Language;
  startLine: number;
  endLine: number;
  content: string;
  chunkType: ModuleType | "block" | "import";
  tokenCount: number;
  score: number; // 0-1 retrieval score
  rerankedScore?: number; // 0-1 after reranking
}

export interface Citation {
  index: number;
  chunk: SourceChunk;
}

export interface RetrievalResult {
  chunk: SourceChunk;
  score: number;
  rerankedScore: number;
}

export interface RetrievalDebug {
  query: string;
  topK: number;
  reranked: boolean;
  rerankModel: string;
  latencyMs: number;
  results: RetrievalResult[];
  vectorWeight: number;
  keywordWeight: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  retrieval?: RetrievalDebug;
  timestamp: string;
  tokens?: number;
  /**
   * Prior versions of an assistant reply, oldest first. Populated when the
   * user retries an answer — the previous reply (with its citations /
   * retrieval / tokens) is pushed here before the new reply replaces the
   * top-level fields. The current top-level `content` / `citations` /
   * `retrieval` / `tokens` always represent the LATEST version.
   *
   * For user messages this is currently unused (user edits overwrite content
   * and set `edited: true`); the field is kept on the shared type for
   * symmetry so the slim/fatten transforms in store.ts can treat versions
   * uniformly without role checks.
   */
  versions?: ChatMessage[];
  /**
   * True when a user message's content was edited in place after first send.
   * The UI can render an "已编辑" badge. Assistant messages never set this.
   */
  edited?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  repoId: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  language?: Language;
  chunkCount: number;
  lineCount: number;
  children?: FileTreeNode[];
}

export type ViewId = "modules" | "detail" | "chat" | "knowledge";
