import type {
  ChatMessage,
  ChatSession,
  CodeModule,
  FileTreeNode,
  Repo,
  SliceStrategy,
  SourceChunk,
} from "./types";

export const REPOS: Repo[] = [
  {
    id: "repo-fastgpt-sdk",
    name: "fastgpt-sdk",
    url: "https://github.com/labring/FastGPT",
    branch: "main",
    description: "FastGPT 知识库与对话编排 SDK，TypeScript 实现",
    defaultLanguage: "typescript",
    status: "synced",
    lastSyncAt: "2025-03-14 10:24",
    totalModules: 12,
    totalChunks: 187,
    totalFiles: 34,
    embeddingModel: "bge-m3",
    sliceStrategy: "ast-semantic",
    progress: 100,
  },
  {
    id: "repo-next-chat",
    name: "next-chat",
    url: "https://github.com/ConnectAI-E/NextChat",
    branch: "dev",
    description: "多模型对话前端，React + Next.js 实现",
    defaultLanguage: "tsx",
    status: "syncing",
    lastSyncAt: "2025-03-14 11:02",
    totalModules: 8,
    totalChunks: 96,
    totalFiles: 21,
    embeddingModel: "text-embedding-3-small",
    sliceStrategy: "ast-function",
    progress: 64,
  },
  {
    id: "repo-vector-store",
    name: "vector-store",
    url: "https://github.com/labring/vector-store",
    branch: "main",
    description: "轻量向量存储与检索引擎",
    defaultLanguage: "go",
    status: "failed",
    lastSyncAt: "2025-03-13 18:40",
    totalModules: 5,
    totalChunks: 52,
    totalFiles: 12,
    embeddingModel: "bge-m3",
    sliceStrategy: "fixed-token",
    progress: 42,
  },
];

export const SLICE_STRATEGIES: SliceStrategy[] = [
  {
    id: "ast-semantic",
    name: "AST 语义切分",
    description: "基于语法树按函数 / 类 / 组件边界切分，保留完整语义单元，适合代码问答",
    recommended: true,
    options: [
      { label: "最大切片 token", key: "maxTokens", type: "number", value: 1200, min: 200, max: 4000 },
      { label: "重叠行数", key: "overlap", type: "number", value: 8, min: 0, max: 60 },
      { label: "保留 import", key: "keepImports", type: "select", value: "是", options: ["是", "否"] },
    ],
  },
  {
    id: "ast-function",
    name: "AST 函数级切分",
    description: "仅按函数 / 方法边界切分，粒度更细，适合精确定位调用",
    recommended: false,
    options: [
      { label: "最小切片 token", key: "minTokens", type: "number", value: 120, min: 50, max: 800 },
      { label: "嵌套拆分", key: "nested", type: "select", value: "开启", options: ["开启", "关闭"] },
    ],
  },
  {
    id: "fixed-token",
    name: "固定 token 切分",
    description: "按固定 token 窗口滑动切分，通用但可能切断语义",
    recommended: false,
    options: [
      { label: "窗口大小", key: "window", type: "number", value: 800, min: 200, max: 4000 },
      { label: "重叠比例", key: "overlapRatio", type: "number", value: 15, min: 0, max: 50 },
    ],
  },
  {
    id: "markdown-header",
    name: "Markdown 标题切分",
    description: "按标题层级切分，适合文档类知识库",
    recommended: false,
    options: [
      { label: "最大标题层级", key: "maxLevel", type: "number", value: 3, min: 1, max: 6 },
    ],
  },
  {
    id: "line-window",
    name: "行窗口切分",
    description: "按固定行数窗口切分，最简单的策略",
    recommended: false,
    options: [
      { label: "窗口行数", key: "lines", type: "number", value: 60, min: 10, max: 400 },
      { label: "重叠行数", key: "overlap", type: "number", value: 6, min: 0, max: 60 },
    ],
  },
];

const tsCode = `import { useCallback, useEffect, useRef, useState } from "react";

interface UseDebounceOptions<T> {
  delay: number;
  initialValue: T;
  leading?: boolean;
}

/**
 * 防抖 Hook：在指定延迟内只触发最后一次更新。
 * 支持 leading 首次立即执行与取消能力。
 */
export function useDebounce<T>(options: UseDebounceOptions<T>) {
  const { delay, initialValue, leading = false } = options;
  const [value, setValue] = useState<T>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRef = useRef(true);

  const debouncedSet = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      if (leading && firstRef.current) {
        setValue(next);
        firstRef.current = false;
        return;
      }

      timerRef.current = setTimeout(() => {
        setValue(next);
      }, delay);
    },
    [delay, leading],
  );

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  return { value, setValue: debouncedSet, cancel };
}`;

const chatCode = `import { useChat } from "@/hooks/use-chat";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { useRef } from "react";

interface ChatPanelProps {
  sessionId: string;
  repoId: string;
}

export function ChatPanel({ sessionId, repoId }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, send, isStreaming } = useChat(sessionId, repoId);

  return (
    <div className="flex h-full flex-col">
      <MessageList ref={scrollRef} messages={messages} />
      <ChatInput onSend={send} disabled={isStreaming} />
    </div>
  );
}`;

const storeCode = `import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatState {
  sessions: ChatSession[];
  activeId: string | null;
  createSession: (repoId: string) => string;
  appendMessage: (id: string, msg: ChatMessage) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: null,
      createSession: (repoId) => {
        const id = crypto.randomUUID();
        set((s) => ({
          sessions: [...s.sessions, { id, repoId, messages: [], title: "新对话" }],
          activeId: id,
        }));
        return id;
      },
      appendMessage: (id, msg) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, messages: [...sess.messages, msg] } : sess,
          ),
        })),
    }),
    { name: "chat-store" },
  ),
);`;

const rerankCode = `import type { SourceChunk } from "./types";

const RERANK_MODEL = "bge-reranker-v2-m3";

/**
 * 重排序：基于交叉编码器对候选 chunk 重新打分。
 * 输入 query 与 top-k 候选，输出按相关性重排后的结果。
 */
export async function rerank(
  query: string,
  candidates: SourceChunk[],
  topN: number,
): Promise<{ chunk: SourceChunk; rerankedScore: number }[]> {
  const scored = candidates.map((chunk) => ({
    chunk,
    rerankedScore: 0.72 + Math.random() * 0.27,
  }));
  return scored.sort((a, b) => b.rerankedScore - a.rerankedScore).slice(0, topN);
}`;

const tokenizeCode = `def tokenize(text: str, max_length: int = 512) -> list[str]:
    """将文本切分为 token 序列，支持中英文混合。"""
    import re
    pattern = re.compile(r"[\\u4e00-\\u9fa5]|[a-zA-Z0-9]+|\\S")
    tokens = pattern.findall(text)
    return tokens[:max_length]`;

export const MODULES: CodeModule[] = [
  {
    id: "mod-use-debounce",
    repoId: "repo-fastgpt-sdk",
    name: "useDebounce",
    type: "hook",
    filePath: "src/hooks/use-debounce.ts",
    language: "typescript",
    summary: "通用防抖 Hook，支持 leading 首次执行与手动取消",
    highlights: [
      "基于 useRef 管理 timer，避免闭包陷阱",
      "支持 leading 首次立即触发",
      "组件卸载自动清理定时器",
    ],
    chunkCount: 3,
    lineCount: 51,
    code: tsCode,
    parameters: [
      { name: "options.delay", type: "number", required: true, description: "防抖延迟毫秒数" },
      { name: "options.initialValue", type: "T", required: true, description: "初始值" },
      { name: "options.leading", type: "boolean", required: false, description: "是否首次立即执行", default: "false" },
    ],
    callChain: [
      { name: "useState", direction: "outgoing", filePath: "react", kind: "util" },
      { name: "useCallback", direction: "outgoing", filePath: "react", kind: "util" },
      { name: "SearchBar", direction: "incoming", filePath: "src/components/search-bar.tsx", kind: "component" },
      { name: "FilterPanel", direction: "incoming", filePath: "src/components/filter-panel.tsx", kind: "component" },
    ],
    astPath: "Program > ExportNamedDeclaration > FunctionDeclaration[useDebounce]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 6, label: "imports & types", tokenCount: 142 },
      { chunkId: "chk-2", startLine: 8, endLine: 44, label: "useDebounce 主体", tokenCount: 612 },
      { chunkId: "chk-3", startLine: 46, endLine: 51, label: "effect cleanup", tokenCount: 88 },
    ],
    relatedModuleIds: ["mod-search-bar", "mod-filter-panel"],
    references: [
      {
        id: "ref-1",
        moduleId: "mod-search-bar",
        moduleName: "SearchBar",
        filePath: "src/components/search-bar.tsx",
        line: 14,
        snippet: 'const { value, setValue } = useDebounce({ delay: 300, initialValue: query });',
        kind: "call",
      },
      {
        id: "ref-2",
        moduleId: "mod-filter-panel",
        moduleName: "FilterPanel",
        filePath: "src/components/filter-panel.tsx",
        line: 28,
        snippet: 'useDebounce({ delay: 400, initialValue: filters });',
        kind: "call",
      },
    ],
    tags: ["react", "hook", "防抖", "性能优化"],
    updatedAt: "2025-03-12 09:15",
    complexity: "medium",
  },
  {
    id: "mod-chat-panel",
    repoId: "repo-fastgpt-sdk",
    name: "ChatPanel",
    type: "component",
    filePath: "src/components/chat/chat-panel.tsx",
    language: "tsx",
    summary: "对话面板容器，编排消息列表与输入框，管理滚动锚点",
    highlights: [
      "通过 useChat 拉取会话消息与流式状态",
      "ref 转发实现自动滚动到底部",
      "isStreaming 时禁用输入框",
    ],
    chunkCount: 2,
    lineCount: 28,
    code: chatCode,
    parameters: [
      { name: "sessionId", type: "string", required: true, description: "当前会话 ID" },
      { name: "repoId", type: "string", required: true, description: "关联知识库 ID" },
    ],
    callChain: [
      { name: "useChat", direction: "outgoing", filePath: "src/hooks/use-chat.ts", kind: "hook" },
      { name: "MessageList", direction: "outgoing", filePath: "src/components/chat/message-list.tsx", kind: "component" },
      { name: "ChatInput", direction: "outgoing", filePath: "src/components/chat/chat-input.tsx", kind: "component" },
      { name: "ChatPage", direction: "incoming", filePath: "src/pages/chat.tsx", kind: "page" },
    ],
    astPath: "Program > ExportNamedFunction[ChatPanel]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 7, label: "imports & props", tokenCount: 198 },
      { chunkId: "chk-2", startLine: 9, endLine: 28, label: "ChatPanel 主体", tokenCount: 421 },
    ],
    relatedModuleIds: ["mod-message-list", "mod-chat-input"],
    references: [
      {
        id: "ref-3",
        moduleId: "mod-chat-page",
        moduleName: "ChatPage",
        filePath: "src/pages/chat.tsx",
        line: 33,
        snippet: '<ChatPanel sessionId={id} repoId={repoId} />',
        kind: "call",
      },
    ],
    tags: ["react", "ui", "对话", "流式"],
    updatedAt: "2025-03-13 16:40",
    complexity: "low",
  },
  {
    id: "mod-chat-store",
    repoId: "repo-fastgpt-sdk",
    name: "useChatStore",
    type: "hook",
    filePath: "src/store/chat-store.ts",
    language: "typescript",
    summary: "Zustand 持久化对话状态，管理会话列表与消息追加",
    highlights: [
      "persist 中间件落地 localStorage",
      "crypto.randomUUID 生成会话 ID",
      "不可变更新 sessions 数组",
    ],
    chunkCount: 2,
    lineCount: 34,
    code: storeCode,
    parameters: [
      { name: "repoId", type: "string", required: true, description: "新建会话关联知识库" },
    ],
    callChain: [
      { name: "create", direction: "outgoing", filePath: "zustand", kind: "util" },
      { name: "persist", direction: "outgoing", filePath: "zustand/middleware", kind: "util" },
      { name: "ChatPanel", direction: "incoming", filePath: "src/components/chat/chat-panel.tsx", kind: "component" },
    ],
    astPath: "Program > VariableDeclaration > CallExpression[create]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 9, label: "interface & imports", tokenCount: 176 },
      { chunkId: "chk-2", startLine: 11, endLine: 34, label: "store 定义", tokenCount: 538 },
    ],
    relatedModuleIds: ["mod-chat-panel"],
    references: [
      {
        id: "ref-4",
        moduleId: "mod-chat-panel",
        moduleName: "ChatPanel",
        filePath: "src/components/chat/chat-panel.tsx",
        line: 2,
        snippet: 'import { useChat } from "@/hooks/use-chat";',
        kind: "import",
      },
    ],
    tags: ["zustand", "store", "持久化", "对话"],
    updatedAt: "2025-03-11 14:20",
    complexity: "medium",
  },
  {
    id: "mod-rerank",
    repoId: "repo-fastgpt-sdk",
    name: "rerank",
    type: "function",
    filePath: "src/lib/rag/rerank.ts",
    language: "typescript",
    summary: "交叉编码器重排序，对召回候选重新打分取 top-N",
    highlights: [
      "bge-reranker-v2-m3 重排模型",
      "保留原始 chunk 引用便于追溯",
      "降序排序后截断",
    ],
    chunkCount: 2,
    lineCount: 24,
    code: rerankCode,
    parameters: [
      { name: "query", type: "string", required: true, description: "查询文本" },
      { name: "candidates", type: "SourceChunk[]", required: true, description: "召回候选切片" },
      { name: "topN", type: "number", required: true, description: "返回数量" },
    ],
    callChain: [
      { name: "SourceChunk", direction: "outgoing", filePath: "./types", kind: "util" },
      { name: "retrieve", direction: "incoming", filePath: "src/lib/rag/retrieve.ts", kind: "function" },
      { name: "ChatService", direction: "incoming", filePath: "src/services/chat-service.ts", kind: "service" },
    ],
    astPath: "Program > ExportNamedFunction[rerank]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 5, label: "imports & config", tokenCount: 154 },
      { chunkId: "chk-2", startLine: 7, endLine: 24, label: "rerank 主体", tokenCount: 388 },
    ],
    relatedModuleIds: ["mod-retrieve", "mod-chat-service"],
    references: [
      {
        id: "ref-5",
        moduleId: "mod-retrieve",
        moduleName: "retrieve",
        filePath: "src/lib/rag/retrieve.ts",
        line: 41,
        snippet: 'const reranked = await rerank(query, candidates, 5);',
        kind: "call",
      },
    ],
    tags: ["rag", "重排序", "检索"],
    updatedAt: "2025-03-14 09:50",
    complexity: "low",
  },
  {
    id: "mod-tokenize",
    repoId: "repo-vector-store",
    name: "tokenize",
    type: "function",
    filePath: "src/utils/tokenize.py",
    language: "python",
    summary: "中英文混合 token 切分工具，支持最大长度截断",
    highlights: [
      "正则匹配中文单字与英文单词",
      "max_length 控制序列长度",
      "保留标点符号 token",
    ],
    chunkCount: 1,
    lineCount: 6,
    code: tokenizeCode,
    parameters: [
      { name: "text", type: "str", required: true, description: "待切分文本" },
      { name: "max_length", type: "int", required: false, description: "最大 token 数", default: "512" },
    ],
    callChain: [
      { name: "re.findall", direction: "outgoing", filePath: "re", kind: "util" },
      { name: "build_index", direction: "incoming", filePath: "src/indexer.py", kind: "function" },
    ],
    astPath: "Module > FunctionDef[tokenize]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 6, label: "tokenize 主体", tokenCount: 142 },
    ],
    relatedModuleIds: [],
    references: [
      {
        id: "ref-6",
        moduleId: "mod-build-index",
        moduleName: "build_index",
        filePath: "src/indexer.py",
        line: 22,
        snippet: 'tokens = tokenize(doc.text, max_length=1024)',
        kind: "call",
      },
    ],
    tags: ["python", "tokenize", "工具"],
    updatedAt: "2025-03-10 11:05",
    complexity: "low",
  },
  {
    id: "mod-search-bar",
    repoId: "repo-fastgpt-sdk",
    name: "SearchBar",
    type: "component",
    filePath: "src/components/search-bar.tsx",
    language: "tsx",
    summary: "搜索输入栏，使用防抖 Hook 控制查询频率",
    highlights: [
      "接入 useDebounce 实现 300ms 防抖",
      "受控 + 非受控双模式",
      "回车立即触发搜索",
    ],
    chunkCount: 2,
    lineCount: 40,
    code: `import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  onSearch: (q: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder }: SearchBarProps) {
  const { value, setValue } = useDebounce({ delay: 300, initialValue: "" });

  return (
    <Input
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onSearch(e.target.value);
      }}
      placeholder={placeholder ?? "搜索..."}
    />
  );
}`,
    parameters: [
      { name: "onSearch", type: "(q: string) => void", required: true, description: "搜索回调" },
      { name: "placeholder", type: "string", required: false, description: "占位文本" },
    ],
    callChain: [
      { name: "useDebounce", direction: "outgoing", filePath: "src/hooks/use-debounce.ts", kind: "hook" },
      { name: "ModuleBrowser", direction: "incoming", filePath: "src/pages/modules.tsx", kind: "page" },
    ],
    astPath: "Program > ExportNamedFunction[SearchBar]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 7, label: "imports & props", tokenCount: 168 },
      { chunkId: "chk-2", startLine: 9, endLine: 24, label: "SearchBar 主体", tokenCount: 332 },
    ],
    relatedModuleIds: ["mod-use-debounce"],
    references: [
      {
        id: "ref-7",
        moduleId: "mod-use-debounce",
        moduleName: "useDebounce",
        filePath: "src/hooks/use-debounce.ts",
        line: 8,
        snippet: 'const { value, setValue } = useDebounce({ ... });',
        kind: "call",
      },
    ],
    tags: ["react", "ui", "搜索"],
    updatedAt: "2025-03-09 17:30",
    complexity: "low",
  },
  {
    id: "mod-message-list",
    repoId: "repo-fastgpt-sdk",
    name: "MessageList",
    type: "component",
    filePath: "src/components/chat/message-list.tsx",
    language: "tsx",
    summary: "消息列表渲染组件，支持 Markdown 与引用角标",
    highlights: [
      "react-markdown 渲染回答",
      "内联引用 [1][2] 角标",
      "forwardRef 暴露滚动容器",
    ],
    chunkCount: 2,
    lineCount: 52,
    code: `import React, { forwardRef } from "react";
import ReactMarkdown from "react-markdown";

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  ({ messages }, ref) => {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id}>{m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}</div>
        ))}
      </div>
    );
  },
);`,
    parameters: [
      { name: "messages", type: "ChatMessage[]", required: true, description: "消息列表" },
    ],
    callChain: [
      { name: "ReactMarkdown", direction: "outgoing", filePath: "react-markdown", kind: "util" },
      { name: "ChatPanel", direction: "incoming", filePath: "src/components/chat/chat-panel.tsx", kind: "component" },
    ],
    astPath: "Program > ExportNamedFunction[MessageList]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 6, label: "imports & props", tokenCount: 158 },
      { chunkId: "chk-2", startLine: 8, endLine: 22, label: "MessageList 主体", tokenCount: 372 },
    ],
    relatedModuleIds: ["mod-chat-panel"],
    references: [],
    tags: ["react", "ui", "对话", "markdown"],
    updatedAt: "2025-03-08 13:12",
    complexity: "low",
  },
  {
    id: "mod-chat-input",
    repoId: "repo-fastgpt-sdk",
    name: "ChatInput",
    type: "component",
    filePath: "src/components/chat/chat-input.tsx",
    language: "tsx",
    summary: "对话输入框，支持回车发送与流式禁用",
    highlights: [
      "Enter 发送 / Shift+Enter 换行",
      "disabled 态控制流式期间锁定",
      "自适应高度 textarea",
    ],
    chunkCount: 1,
    lineCount: 36,
    code: `import { useState, useRef } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !disabled) {
        onSend(text);
        setText("");
      }
    }
  };
  return <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />;
}`,
    parameters: [
      { name: "onSend", type: "(text: string) => void", required: true, description: "发送回调" },
      { name: "disabled", type: "boolean", required: false, description: "是否禁用" },
    ],
    callChain: [
      { name: "ChatPanel", direction: "incoming", filePath: "src/components/chat/chat-panel.tsx", kind: "component" },
    ],
    astPath: "Program > ExportNamedFunction[ChatInput]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 22, label: "ChatInput 主体", tokenCount: 298 },
    ],
    relatedModuleIds: ["mod-chat-panel"],
    references: [],
    tags: ["react", "ui", "输入", "对话"],
    updatedAt: "2025-03-07 10:00",
    complexity: "low",
  },
  {
    id: "mod-retrieve",
    repoId: "repo-fastgpt-sdk",
    name: "retrieve",
    type: "function",
    filePath: "src/lib/rag/retrieve.ts",
    language: "typescript",
    summary: "混合检索：向量召回 + 关键词匹配，再交由 rerank 重排",
    highlights: [
      "向量 + 关键词双路召回",
      "权重融合打分",
      "返回带分数的候选切片",
    ],
    chunkCount: 2,
    lineCount: 48,
    code: `import type { SourceChunk } from "./types";
import { rerank } from "./rerank";

export async function retrieve(
  query: string,
  topK: number,
  opts: { vectorWeight: number; rerank: boolean },
): Promise<SourceChunk[]> {
  const vec = await vectorSearch(query, topK * 2);
  const kw = await keywordSearch(query, topK * 2);
  const merged = mergeScores(vec, kw, opts.vectorWeight);
  return opts.rerank ? (await rerank(query, merged, topK)).map((r) => r.chunk) : merged.slice(0, topK);
}`,
    parameters: [
      { name: "query", type: "string", required: true, description: "查询文本" },
      { name: "topK", type: "number", required: true, description: "返回数量" },
      { name: "opts.vectorWeight", type: "number", required: true, description: "向量权重 0-1" },
      { name: "opts.rerank", type: "boolean", required: false, description: "是否重排" },
    ],
    callChain: [
      { name: "rerank", direction: "outgoing", filePath: "src/lib/rag/rerank.ts", kind: "function" },
      { name: "ChatService", direction: "incoming", filePath: "src/services/chat-service.ts", kind: "service" },
    ],
    astPath: "Program > ExportNamedFunction[retrieve]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 3, label: "imports", tokenCount: 96 },
      { chunkId: "chk-2", startLine: 5, endLine: 14, label: "retrieve 主体", tokenCount: 354 },
    ],
    relatedModuleIds: ["mod-rerank", "mod-chat-service"],
    references: [
      {
        id: "ref-8",
        moduleId: "mod-chat-service",
        moduleName: "ChatService",
        filePath: "src/services/chat-service.ts",
        line: 19,
        snippet: 'const chunks = await retrieve(query, 6, { vectorWeight: 0.7, rerank: true });',
        kind: "call",
      },
    ],
    tags: ["rag", "检索", "向量"],
    updatedAt: "2025-03-14 08:30",
    complexity: "high",
  },
  {
    id: "mod-chat-service",
    repoId: "repo-fastgpt-sdk",
    name: "ChatService",
    type: "service",
    filePath: "src/services/chat-service.ts",
    language: "typescript",
    summary: "对话编排服务，串联检索、重排与 LLM 生成",
    highlights: [
      "编排 retrieve → rerank → LLM",
      "流式返回生成结果",
      "收集引用与检索调试信息",
    ],
    chunkCount: 3,
    lineCount: 72,
    code: `import { retrieve } from "@/lib/rag/retrieve";
import type { ChatMessage, RetrievalDebug } from "@/lib/rag/types";

export class ChatService {
  constructor(private repoId: string) {}

  async ask(query: string): Promise<{ answer: string; debug: RetrievalDebug }> {
    const chunks = await retrieve(query, 6, { vectorWeight: 0.7, rerank: true });
    const answer = await this.streamLLM(query, chunks);
    return { answer, debug: { query, topK: 6, reranked: true } } as never;
  }

  private async streamLLM(q: string, chunks: SourceChunk[]) {
    return chunks.length ? "基于检索结果回答" : "无引用";
  }
}`,
    parameters: [
      { name: "repoId", type: "string", required: true, description: "知识库 ID" },
    ],
    callChain: [
      { name: "retrieve", direction: "outgoing", filePath: "src/lib/rag/retrieve.ts", kind: "function" },
      { name: "ChatPage", direction: "incoming", filePath: "src/pages/chat.tsx", kind: "page" },
    ],
    astPath: "Program > ClassDeclaration[ChatService]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 4, label: "imports", tokenCount: 132 },
      { chunkId: "chk-2", startLine: 6, endLine: 14, label: "ask 方法", tokenCount: 286 },
      { chunkId: "chk-3", startLine: 16, endLine: 19, label: "streamLLM 方法", tokenCount: 164 },
    ],
    relatedModuleIds: ["mod-retrieve", "mod-rerank"],
    references: [],
    tags: ["service", "rag", "编排", "LLM"],
    updatedAt: "2025-03-14 09:00",
    complexity: "high",
  },
  {
    id: "mod-build-index",
    repoId: "repo-vector-store",
    name: "build_index",
    type: "function",
    filePath: "src/indexer.py",
    language: "python",
    summary: "构建向量索引，遍历文件树并生成 embedding",
    highlights: [
      "递归遍历知识库文件",
      "调用 tokenize 与 embedding 模型",
      "写入向量存储并落库",
    ],
    chunkCount: 2,
    lineCount: 44,
    code: `def build_index(repo_path: str, model: str = "bge-m3") -> int:
    """遍历仓库文件，生成向量索引并写入存储。"""
    count = 0
    for file in walk(repo_path):
        text = read(file)
        tokens = tokenize(text, max_length=1024)
        vecs = embed(tokens, model)
        save(file, vecs)
        count += len(vecs)
    return count`,
    parameters: [
      { name: "repo_path", type: "str", required: true, description: "仓库根路径" },
      { name: "model", type: "str", required: false, description: "embedding 模型", default: "bge-m3" },
    ],
    callChain: [
      { name: "tokenize", direction: "outgoing", filePath: "src/utils/tokenize.py", kind: "function" },
      { name: "embed", direction: "outgoing", filePath: "src/embed.py", kind: "function" },
    ],
    astPath: "Module > FunctionDef[build_index]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 3, label: "签名 & docstring", tokenCount: 118 },
      { chunkId: "chk-2", startLine: 4, endLine: 11, label: "build_index 主体", tokenCount: 248 },
    ],
    relatedModuleIds: ["mod-tokenize"],
    references: [],
    tags: ["python", "索引", "embedding"],
    updatedAt: "2025-03-09 15:22",
    complexity: "medium",
  },
  {
    id: "mod-chat-page",
    repoId: "repo-fastgpt-sdk",
    name: "ChatPage",
    type: "page",
    filePath: "src/pages/chat.tsx",
    language: "tsx",
    summary: "对话页面入口，布局侧栏与会话主区",
    highlights: [
      "三栏布局：会话列表 / 对话 / 来源面板",
      "管理活跃会话 ID",
      "空态引导新建对话",
    ],
    chunkCount: 2,
    lineCount: 56,
    code: `import { ChatPanel } from "@/components/chat/chat-panel";
import { useChatStore } from "@/store/chat-store";

export default function ChatPage({ repoId }: { repoId: string }) {
  const { sessions, activeId, createSession } = useChatStore();
  const active = sessions.find((s) => s.id === activeId);
  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r">{/* sessions */}</aside>
      <main className="flex-1">
        {active ? <ChatPanel sessionId={active.id} repoId={repoId} /> : <EmptyState onCreate={() => createSession(repoId)} />}
      </main>
    </div>
  );
}`,
    parameters: [
      { name: "repoId", type: "string", required: true, description: "知识库 ID" },
    ],
    callChain: [
      { name: "ChatPanel", direction: "outgoing", filePath: "src/components/chat/chat-panel.tsx", kind: "component" },
      { name: "useChatStore", direction: "outgoing", filePath: "src/store/chat-store.ts", kind: "hook" },
    ],
    astPath: "Program > ExportDefaultFunctionDeclaration[ChatPage]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 3, label: "imports", tokenCount: 142 },
      { chunkId: "chk-2", startLine: 5, endLine: 18, label: "ChatPage 主体", tokenCount: 388 },
    ],
    relatedModuleIds: ["mod-chat-panel", "mod-chat-store"],
    references: [],
    tags: ["page", "对话", "布局"],
    updatedAt: "2025-03-06 12:00",
    complexity: "medium",
  },
  // ---- next-chat repo modules ----
  {
    id: "mod-chat-window",
    repoId: "repo-next-chat",
    name: "ChatWindow",
    type: "component",
    filePath: "app/chat/components/chat-window.tsx",
    language: "tsx",
    summary: "对话主窗口容器，编排消息流与输入，管理滚动锚点",
    highlights: [
      "接入 useChatStore 拉取当前会话",
      "streamCompletion 流式渲染增量 token",
      "自动滚动到底部 + 手动锁定",
    ],
    chunkCount: 3,
    lineCount: 64,
    code: `"use client";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { streamCompletion } from "@/lib/stream";

export function ChatWindow() {
  const sessionId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) =>
    s.sessions.find((x) => x.id === sessionId)?.messages ?? [],
  );
  const [streaming, setStreaming] = useState(false);

  async function send(text: string) {
    setStreaming(true);
    for await (const tok of streamCompletion(text)) {
      useChatStore.getState().appendToken(sessionId, tok);
    }
    setStreaming(false);
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} />
      <ChatInput onSend={send} disabled={streaming} />
    </div>
  );
}`,
    parameters: [
      { name: "(无)", type: "-", required: false, description: "从 store 读取会话" },
    ],
    callChain: [
      { name: "useChatStore", direction: "outgoing", filePath: "@/lib/store", kind: "hook" },
      { name: "MessageBubble", direction: "outgoing", filePath: "app/chat/components/message-bubble.tsx", kind: "component" },
      { name: "streamCompletion", direction: "outgoing", filePath: "@/lib/stream", kind: "function" },
      { name: "chat/page.tsx", direction: "incoming", filePath: "app/chat/page.tsx", kind: "page" },
    ],
    astPath: "Program > ExportFunction[ChatWindow]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 5, label: "imports", tokenCount: 168 },
      { chunkId: "chk-2", startLine: 7, endLine: 24, label: "ChatWindow 主体", tokenCount: 432 },
      { chunkId: "chk-3", startLine: 26, endLine: 34, label: "render", tokenCount: 188 },
    ],
    relatedModuleIds: ["mod-message-bubble", "mod-stream-completion"],
    references: [],
    tags: ["react", "ui", "对话", "流式"],
    updatedAt: "2025-03-13 11:20",
    complexity: "medium",
  },
  {
    id: "mod-message-bubble",
    repoId: "repo-next-chat",
    name: "MessageBubble",
    type: "component",
    filePath: "app/chat/components/message-bubble.tsx",
    language: "tsx",
    summary: "消息气泡，区分用户/助手，支持 Markdown 与代码块",
    highlights: [
      "react-markdown 渲染助手消息",
      "用户消息右对齐品牌色气泡",
      "代码块一键复制",
    ],
    chunkCount: 2,
    lineCount: 48,
    code: `"use client";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-brand px-4 py-2 text-brand-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-card p-4">
      <ReactMarkdown>{message.content}</ReactMarkdown>
    </div>
  );
}`,
    parameters: [
      { name: "message", type: "ChatMessage", required: true, description: "消息对象" },
    ],
    callChain: [
      { name: "ReactMarkdown", direction: "outgoing", filePath: "react-markdown", kind: "util" },
      { name: "ChatWindow", direction: "incoming", filePath: "app/chat/components/chat-window.tsx", kind: "component" },
    ],
    astPath: "Program > ExportFunction[MessageBubble]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 3, label: "imports", tokenCount: 142 },
      { chunkId: "chk-2", startLine: 5, endLine: 20, label: "MessageBubble 主体", tokenCount: 298 },
    ],
    relatedModuleIds: ["mod-chat-window"],
    references: [],
    tags: ["react", "ui", "markdown", "对话"],
    updatedAt: "2025-03-12 16:05",
    complexity: "low",
  },
  {
    id: "mod-model-selector",
    repoId: "repo-next-chat",
    name: "ModelSelector",
    type: "component",
    filePath: "components/model-selector.tsx",
    language: "tsx",
    summary: "模型选择下拉，展示可用 LM 并切换活跃模型",
    highlights: [
      "受控 Select 绑定 store.model",
      "按 provider 分组展示",
      "显示模型上下文窗口与计价",
    ],
    chunkCount: 2,
    lineCount: 52,
    code: `"use client";
import { Select } from "@/components/ui/select";
import { useChatStore } from "@/lib/store";
import { MODELS } from "@/lib/models";

export function ModelSelector() {
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  return (
    <Select value={model} onValueChange={setModel}>
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name} · {m.context}k
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}`,
    parameters: [
      { name: "(无)", type: "-", required: false, description: "从 store 读写" },
    ],
    callChain: [
      { name: "useChatStore", direction: "outgoing", filePath: "@/lib/store", kind: "hook" },
      { name: "MODELS", direction: "outgoing", filePath: "@/lib/models", kind: "config" },
      { name: "ChatWindow", direction: "incoming", filePath: "app/chat/components/chat-window.tsx", kind: "component" },
    ],
    astPath: "Program > ExportFunction[ModelSelector]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 4, label: "imports", tokenCount: 152 },
      { chunkId: "chk-2", startLine: 6, endLine: 22, label: "ModelSelector 主体", tokenCount: 286 },
    ],
    relatedModuleIds: [],
    references: [],
    tags: ["react", "ui", "模型", "选择器"],
    updatedAt: "2025-03-11 14:30",
    complexity: "low",
  },
  {
    id: "mod-nc-store",
    repoId: "repo-next-chat",
    name: "useChatStore",
    type: "hook",
    filePath: "lib/store.ts",
    language: "typescript",
    summary: "Zustand 持久化对话状态，管理会话/消息/模型切换",
    highlights: [
      "persist 落地 localStorage",
      "appendToken 流式追加增量",
      "模型与会话双维度状态",
    ],
    chunkCount: 2,
    lineCount: 46,
    code: `import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatSession, ChatMessage } from "./types";

interface ChatState {
  sessions: ChatSession[];
  activeId: string | null;
  model: string;
  setModel: (m: string) => void;
  appendToken: (sessionId: string, token: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: null,
      model: "gpt-4o",
      setModel: (m) => set({ model: m }),
      appendToken: (sid, token) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sid
              ? { ...sess, messages: appendToLast(sess.messages, token) }
              : sess,
          ),
        })),
    }),
    { name: "next-chat-store" },
  ),
);`,
    parameters: [
      { name: "(无)", type: "-", required: false, description: "store 初始化" },
    ],
    callChain: [
      { name: "create", direction: "outgoing", filePath: "zustand", kind: "util" },
      { name: "ChatWindow", direction: "incoming", filePath: "app/chat/components/chat-window.tsx", kind: "component" },
      { name: "ModelSelector", direction: "incoming", filePath: "components/model-selector.tsx", kind: "component" },
    ],
    astPath: "Program > VariableDeclaration > CallExpression[create]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 12, label: "interface & imports", tokenCount: 198 },
      { chunkId: "chk-2", startLine: 14, endLine: 38, label: "store 定义", tokenCount: 412 },
    ],
    relatedModuleIds: ["mod-chat-window", "mod-model-selector"],
    references: [],
    tags: ["zustand", "store", "持久化", "对话"],
    updatedAt: "2025-03-10 09:15",
    complexity: "medium",
  },
  {
    id: "mod-stream-completion",
    repoId: "repo-next-chat",
    name: "streamCompletion",
    type: "function",
    filePath: "lib/stream.ts",
    language: "typescript",
    summary: "流式调用 LLM 接口，异步生成 token 序列",
    highlights: [
      "AsyncGenerator 逐 token yield",
      "SSE 解析服务端事件流",
      "AbortSignal 支持中断",
    ],
    chunkCount: 2,
    lineCount: 38,
    code: `export async function* streamCompletion(
  prompt: string,
  opts?: { signal?: AbortSignal; model?: string },
): AsyncGenerator<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ prompt, model: opts?.model ?? "gpt-4o" }),
    signal: opts?.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data:")) yield JSON.parse(line.slice(5)).token;
    }
  }
}`,
    parameters: [
      { name: "prompt", type: "string", required: true, description: "用户输入" },
      { name: "opts.signal", type: "AbortSignal", required: false, description: "中断信号" },
      { name: "opts.model", type: "string", required: false, description: "模型 ID" },
    ],
    callChain: [
      { name: "fetch", direction: "outgoing", filePath: "browser API", kind: "util" },
      { name: "ChatWindow", direction: "incoming", filePath: "app/chat/components/chat-window.tsx", kind: "component" },
    ],
    astPath: "Program > ExportFunction[streamCompletion]",
    chunkBoundaries: [
      { chunkId: "chk-1", startLine: 1, endLine: 6, label: "签名", tokenCount: 124 },
      { chunkId: "chk-2", startLine: 7, endLine: 26, label: "stream 主体", tokenCount: 398 },
    ],
    relatedModuleIds: ["mod-chat-window"],
    references: [],
    tags: ["streaming", "LLM", "SSE", "异步"],
    updatedAt: "2025-03-09 18:40",
    complexity: "high",
  },
];

export const SOURCE_CHUNKS: SourceChunk[] = [
  {
    id: "chk-use-debounce-1",
    moduleId: "mod-use-debounce",
    repoId: "repo-fastgpt-sdk",
    filePath: "src/hooks/use-debounce.ts",
    language: "typescript",
    startLine: 8,
    endLine: 44,
    content: `export function useDebounce<T>(options: UseDebounceOptions<T>) {
  const { delay, initialValue, leading = false } = options;
  const [value, setValue] = useState<T>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRef = useRef(true);

  const debouncedSet = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (leading && firstRef.current) {
        setValue(next);
        firstRef.current = false;
        return;
      }
      timerRef.current = setTimeout(() => setValue(next), delay);
    },
    [delay, leading],
  );`,
    chunkType: "hook",
    tokenCount: 612,
    score: 0.892,
    rerankedScore: 0.941,
  },
  {
    id: "chk-retrieve-1",
    moduleId: "mod-retrieve",
    repoId: "repo-fastgpt-sdk",
    filePath: "src/lib/rag/retrieve.ts",
    language: "typescript",
    startLine: 5,
    endLine: 14,
    content: `export async function retrieve(query, topK, opts) {
  const vec = await vectorSearch(query, topK * 2);
  const kw = await keywordSearch(query, topK * 2);
  const merged = mergeScores(vec, kw, opts.vectorWeight);
  return opts.rerank
    ? (await rerank(query, merged, topK)).map((r) => r.chunk)
    : merged.slice(0, topK);
}`,
    chunkType: "function",
    tokenCount: 354,
    score: 0.847,
    rerankedScore: 0.913,
  },
  {
    id: "chk-rerank-1",
    moduleId: "mod-rerank",
    repoId: "repo-fastgpt-sdk",
    filePath: "src/lib/rag/rerank.ts",
    language: "typescript",
    startLine: 7,
    endLine: 24,
    content: `export async function rerank(query, candidates, topN) {
  const scored = candidates.map((chunk) => ({
    chunk,
    rerankedScore: 0.72 + Math.random() * 0.27,
  }));
  return scored.sort((a, b) => b.rerankedScore - a.rerankedScore).slice(0, topN);
}`,
    chunkType: "function",
    tokenCount: 388,
    score: 0.811,
    rerankedScore: 0.886,
  },
  {
    id: "chk-chat-service-1",
    moduleId: "mod-chat-service",
    repoId: "repo-fastgpt-sdk",
    filePath: "src/services/chat-service.ts",
    language: "typescript",
    startLine: 6,
    endLine: 14,
    content: `export class ChatService {
  constructor(private repoId: string) {}
  async ask(query) {
    const chunks = await retrieve(query, 6, { vectorWeight: 0.7, rerank: true });
    const answer = await this.streamLLM(query, chunks);
    return { answer, debug: { query, topK: 6, reranked: true } };
  }
}`,
    chunkType: "service",
    tokenCount: 286,
    score: 0.793,
    rerankedScore: 0.842,
  },
  {
    id: "chk-chat-store-1",
    moduleId: "mod-chat-store",
    repoId: "repo-fastgpt-sdk",
    filePath: "src/store/chat-store.ts",
    language: "typescript",
    startLine: 11,
    endLine: 34,
    content: `export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: null,
      createSession: (repoId) => {
        const id = crypto.randomUUID();
        set((s) => ({ sessions: [...s.sessions, { id, repoId, messages: [], title: "新对话" }] }));
        return id;
      },
    }),
    { name: "chat-store" },
  ),
);`,
    chunkType: "hook",
    tokenCount: 538,
    score: 0.762,
    rerankedScore: 0.801,
  },
];

export const CHAT_SESSIONS: ChatSession[] = [
  {
    id: "sess-1",
    title: "检索与重排流程",
    repoId: "repo-fastgpt-sdk",
    createdAt: "2025-03-14 10:30",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "FastGPT SDK 的 RAG 检索是怎么和重排串联起来的？",
        timestamp: "2025-03-14 10:30:12",
      },
      {
        id: "m2",
        role: "assistant",
        content: `FastGPT SDK 的 RAG 链路采用「**双路召回 → 重排 → LLM 生成**」三段式编排：

### 1. 混合召回
\`retrieve()\` 同时发起向量召回与关键词召回，各取 \`topK * 2\` 条候选，再按 \`vectorWeight\` 权重融合打分 [1]。

### 2. 交叉编码器重排
融合后的候选交给 \`rerank()\`，使用 \`bge-reranker-v2-m3\` 对 query-chunk 对做交叉编码打分，保留语义最相关的 \`topK\` 条 [2][3]。

### 3. 编排生成
\`ChatService\` 串联上述两步，把重排后的切片作为上下文喂给 LLM，并收集引用与检索调试信息 [4]。

> 默认配置：向量权重 0.7、topK=6、开启重排。状态管理使用 \`useChatStore\` 持久化会话 [5]。`,
        citations: [
          { index: 1, chunk: SOURCE_CHUNKS[1] },
          { index: 2, chunk: SOURCE_CHUNKS[2] },
          { index: 3, chunk: SOURCE_CHUNKS[2] },
          { index: 4, chunk: SOURCE_CHUNKS[3] },
          { index: 5, chunk: SOURCE_CHUNKS[4] },
        ],
        retrieval: {
          query: "FastGPT SDK 的 RAG 检索是怎么和重排串联起来的？",
          topK: 6,
          reranked: true,
          rerankModel: "bge-reranker-v2-m3",
          latencyMs: 318,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
          results: [
            { chunk: SOURCE_CHUNKS[0], score: 0.892, rerankedScore: 0.941 },
            { chunk: SOURCE_CHUNKS[1], score: 0.847, rerankedScore: 0.913 },
            { chunk: SOURCE_CHUNKS[2], score: 0.811, rerankedScore: 0.886 },
            { chunk: SOURCE_CHUNKS[3], score: 0.793, rerankedScore: 0.842 },
            { chunk: SOURCE_CHUNKS[4], score: 0.762, rerankedScore: 0.801 },
          ],
        },
        timestamp: "2025-03-14 10:30:15",
        tokens: 312,
      },
    ],
  },
  {
    id: "sess-2",
    title: "useDebounce 实现思路",
    repoId: "repo-fastgpt-sdk",
    createdAt: "2025-03-13 14:12",
    messages: [
      {
        id: "s2-m1",
        role: "user",
        content: "useDebounce 这个 Hook 的核心实现思路是什么？",
        timestamp: "2025-03-13 14:12:03",
      },
      {
        id: "s2-m2",
        role: "assistant",
        content: `\`useDebounce\` 的核心是用 **useRef 持有定时器 + useCallback 包装 setter**，避免闭包陷阱 [1]。

### 关键点
- 用 \`timerRef\` 保存 \`setTimeout\` 句柄，每次调用先 \`clearTimeout\` 上一次，保证只触发最后一次 [1]
- \`leading\` 选项控制首次是否立即执行：用 \`firstRef\` 标记首帧，命中则同步 \`setValue\` 并跳过延迟 [1]
- \`useEffect\` 返回 \`cancel\` 作为清理函数，组件卸载时清除定时器，防止内存泄漏 [1]

> 相比手写 \`useEffect + setTimeout\` 的写法，Hook 化后调用方只需 \`setValue\` 即可获得防抖值，更声明式。`,
        citations: [{ index: 1, chunk: SOURCE_CHUNKS[0] }],
        retrieval: {
          query: "useDebounce 这个 Hook 的核心实现思路是什么？",
          topK: 6,
          reranked: true,
          rerankModel: "bge-reranker-v2-m3",
          latencyMs: 264,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
          results: [
            { chunk: SOURCE_CHUNKS[0], score: 0.881, rerankedScore: 0.935 },
            { chunk: SOURCE_CHUNKS[4], score: 0.712, rerankedScore: 0.752 },
          ],
        },
        timestamp: "2025-03-13 14:12:06",
        tokens: 198,
      },
    ],
  },
  {
    id: "sess-3",
    title: "NextChat 流式渲染",
    repoId: "repo-next-chat",
    createdAt: "2025-03-12 16:40",
    messages: [
      {
        id: "s3-m1",
        role: "user",
        content: "NextChat 是怎么做流式渲染的？",
        timestamp: "2025-03-12 16:40:11",
      },
      {
        id: "s3-m2",
        role: "assistant",
        content: `NextChat 的流式渲染基于 **AsyncGenerator + SSE 解析** 两层：

\`streamCompletion()\` 是一个 \`AsyncGenerator<string>\`，向 \`/api/chat\` 发起 POST，拿到 \`ReadableStream\` 后用 \`TextDecoder\` 解码并按 \`\\n\` 切行 [1]。

每行若以 \`data:\` 开头，则 \`JSON.parse(line.slice(5)).token\` 取出增量 token 并 \`yield\`，\`ChatWindow\` 在 \`for await\` 循环里调用 \`useChatStore.appendToken\` 把增量追加到最后一条消息 [1]。

> 中断通过 \`AbortSignal\` 传入 fetch，用户停止时 abort 即可断流。`,
        citations: [{ index: 1, chunk: SOURCE_CHUNKS[1] }],
        retrieval: {
          query: "NextChat 是怎么做流式渲染的？",
          topK: 6,
          reranked: true,
          rerankModel: "bge-reranker-v2-m3",
          latencyMs: 289,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
          results: [
            { chunk: SOURCE_CHUNKS[1], score: 0.836, rerankedScore: 0.892 },
            { chunk: SOURCE_CHUNKS[3], score: 0.748, rerankedScore: 0.781 },
          ],
        },
        timestamp: "2025-03-12 16:40:15",
        tokens: 224,
      },
    ],
  },
  {
    id: "sess-4",
    title: "向量索引构建流程",
    repoId: "repo-vector-store",
    createdAt: "2025-03-11 11:08",
    messages: [
      {
        id: "s4-m1",
        role: "user",
        content: "vector-store 的索引是怎么构建的？",
        timestamp: "2025-03-11 11:08:22",
      },
      {
        id: "s4-m2",
        role: "assistant",
        content: `\`build_index()\` 是向量索引的入口，采用 **遍历 → 切分 → 嵌入 → 落库** 四步流程 [1]。

它递归 \`walk(repo_path)\` 所有文件，对每个文件 \`read\` 出文本后调用 \`tokenize\` 切 token [1]，再 \`embed(tokens, model)\` 生成向量，最后 \`save(file, vecs)\` 写入向量存储并累加计数返回 [1]。

> 默认 embedding 模型 \`bge-m3\`，可通过参数切换。索引失败时该仓库状态会标记为 \`failed\`。`,
        citations: [{ index: 1, chunk: SOURCE_CHUNKS[0] }],
        retrieval: {
          query: "vector-store 的索引是怎么构建的？",
          topK: 6,
          reranked: true,
          rerankModel: "bge-reranker-v2-m3",
          latencyMs: 301,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
          results: [
            { chunk: SOURCE_CHUNKS[0], score: 0.798, rerankedScore: 0.851 },
          ],
        },
        timestamp: "2025-03-11 11:08:26",
        tokens: 176,
      },
    ],
  },
];

export const FILE_TREE: FileTreeNode[] = [
  {
    name: "src",
    path: "src",
    type: "dir",
    chunkCount: 187,
    lineCount: 0,
    children: [
      {
        name: "hooks",
        path: "src/hooks",
        type: "dir",
        chunkCount: 6,
        lineCount: 0,
        children: [
          {
            name: "use-debounce.ts",
            path: "src/hooks/use-debounce.ts",
            type: "file",
            language: "typescript",
            chunkCount: 3,
            lineCount: 51,
          },
          {
            name: "use-chat.ts",
            path: "src/hooks/use-chat.ts",
            type: "file",
            language: "typescript",
            chunkCount: 2,
            lineCount: 38,
          },
        ],
      },
      {
        name: "components",
        path: "src/components",
        type: "dir",
        chunkCount: 42,
        lineCount: 0,
        children: [
          {
            name: "chat",
            path: "src/components/chat",
            type: "dir",
            chunkCount: 12,
            lineCount: 0,
            children: [
              {
                name: "chat-panel.tsx",
                path: "src/components/chat/chat-panel.tsx",
                type: "file",
                language: "tsx",
                chunkCount: 2,
                lineCount: 28,
              },
              {
                name: "message-list.tsx",
                path: "src/components/chat/message-list.tsx",
                type: "file",
                language: "tsx",
                chunkCount: 2,
                lineCount: 52,
              },
              {
                name: "chat-input.tsx",
                path: "src/components/chat/chat-input.tsx",
                type: "file",
                language: "tsx",
                chunkCount: 1,
                lineCount: 36,
              },
            ],
          },
          {
            name: "search-bar.tsx",
            path: "src/components/search-bar.tsx",
            type: "file",
            language: "tsx",
            chunkCount: 2,
            lineCount: 40,
          },
        ],
      },
      {
        name: "lib",
        path: "src/lib",
        type: "dir",
        chunkCount: 38,
        lineCount: 0,
        children: [
          {
            name: "rag",
            path: "src/lib/rag",
            type: "dir",
            chunkCount: 14,
            lineCount: 0,
            children: [
              {
                name: "retrieve.ts",
                path: "src/lib/rag/retrieve.ts",
                type: "file",
                language: "typescript",
                chunkCount: 2,
                lineCount: 48,
              },
              {
                name: "rerank.ts",
                path: "src/lib/rag/rerank.ts",
                type: "file",
                language: "typescript",
                chunkCount: 2,
                lineCount: 24,
              },
              {
                name: "types.ts",
                path: "src/lib/rag/types.ts",
                type: "file",
                language: "typescript",
                chunkCount: 1,
                lineCount: 32,
              },
            ],
          },
        ],
      },
      {
        name: "store",
        path: "src/store",
        type: "dir",
        chunkCount: 6,
        lineCount: 0,
        children: [
          {
            name: "chat-store.ts",
            path: "src/store/chat-store.ts",
            type: "file",
            language: "typescript",
            chunkCount: 2,
            lineCount: 34,
          },
        ],
      },
      {
        name: "services",
        path: "src/services",
        type: "dir",
        chunkCount: 8,
        lineCount: 0,
        children: [
          {
            name: "chat-service.ts",
            path: "src/services/chat-service.ts",
            type: "file",
            language: "typescript",
            chunkCount: 3,
            lineCount: 72,
          },
        ],
      },
      {
        name: "pages",
        path: "src/pages",
        type: "dir",
        chunkCount: 10,
        lineCount: 0,
        children: [
          {
            name: "chat.tsx",
            path: "src/pages/chat.tsx",
            type: "file",
            language: "tsx",
            chunkCount: 2,
            lineCount: 56,
          },
        ],
      },
    ],
  },
];

// File trees keyed by repo id. Each repo gets its own realistic file tree.
export const FILE_TREES_BY_REPO: Record<string, FileTreeNode[]> = {
  "repo-fastgpt-sdk": FILE_TREE,
  "repo-next-chat": [
    {
      name: "app",
      path: "app",
      type: "dir",
      chunkCount: 28,
      lineCount: 0,
      children: [
        {
          name: "page.tsx",
          path: "app/page.tsx",
          type: "file",
          language: "tsx",
          chunkCount: 2,
          lineCount: 48,
        },
        {
          name: "layout.tsx",
          path: "app/layout.tsx",
          type: "file",
          language: "tsx",
          chunkCount: 1,
          lineCount: 24,
        },
        {
          name: "chat",
          path: "app/chat",
          type: "dir",
          chunkCount: 14,
          lineCount: 0,
          children: [
            {
              name: "page.tsx",
              path: "app/chat/page.tsx",
              type: "file",
              language: "tsx",
              chunkCount: 3,
              lineCount: 62,
            },
            {
              name: "components",
              path: "app/chat/components",
              type: "dir",
              chunkCount: 9,
              lineCount: 0,
              children: [
                {
                  name: "chat-window.tsx",
                  path: "app/chat/components/chat-window.tsx",
                  type: "file",
                  language: "tsx",
                  chunkCount: 2,
                  lineCount: 54,
                },
                {
                  name: "message-bubble.tsx",
                  path: "app/chat/components/message-bubble.tsx",
                  type: "file",
                  language: "tsx",
                  chunkCount: 2,
                  lineCount: 38,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "components",
      path: "components",
      type: "dir",
      chunkCount: 18,
      lineCount: 0,
      children: [
        {
          name: "model-selector.tsx",
          path: "components/model-selector.tsx",
          type: "file",
          language: "tsx",
          chunkCount: 2,
          lineCount: 44,
        },
        {
          name: "prompt-list.tsx",
          path: "components/prompt-list.tsx",
          type: "file",
          language: "tsx",
          chunkCount: 1,
          lineCount: 30,
        },
      ],
    },
    {
      name: "lib",
      path: "lib",
      type: "dir",
      chunkCount: 22,
      lineCount: 0,
      children: [
        {
          name: "models.ts",
          path: "lib/models.ts",
          type: "file",
          language: "typescript",
          chunkCount: 2,
          lineCount: 58,
        },
        {
          name: "store.ts",
          path: "lib/store.ts",
          type: "file",
          language: "typescript",
          chunkCount: 2,
          lineCount: 40,
        },
      ],
    },
  ],
  "repo-vector-store": [
    {
      name: "src",
      path: "src",
      type: "dir",
      chunkCount: 52,
      lineCount: 0,
      children: [
        {
          name: "indexer.py",
          path: "src/indexer.py",
          type: "file",
          language: "python",
          chunkCount: 2,
          lineCount: 44,
        },
        {
          name: "embed.py",
          path: "src/embed.py",
          type: "file",
          language: "python",
          chunkCount: 1,
          lineCount: 28,
        },
        {
          name: "search.py",
          path: "src/search.py",
          type: "file",
          language: "python",
          chunkCount: 2,
          lineCount: 52,
        },
        {
          name: "utils",
          path: "src/utils",
          type: "dir",
          chunkCount: 6,
          lineCount: 0,
          children: [
            {
              name: "tokenize.py",
              path: "src/utils/tokenize.py",
              type: "file",
              language: "python",
              chunkCount: 1,
              lineCount: 6,
            },
            {
              name: "io.py",
              path: "src/utils/io.py",
              type: "file",
              language: "python",
              chunkCount: 1,
              lineCount: 22,
            },
          ],
        },
        {
          name: "store",
          path: "src/store",
          type: "dir",
          chunkCount: 8,
          lineCount: 0,
          children: [
            {
              name: "vector_db.py",
              path: "src/store/vector_db.py",
              type: "file",
              language: "python",
              chunkCount: 2,
              lineCount: 64,
            },
          ],
        },
      ],
    },
    {
      name: "tests",
      path: "tests",
      type: "dir",
      chunkCount: 4,
      lineCount: 0,
      children: [
        {
          name: "test_indexer.py",
          path: "tests/test_indexer.py",
          type: "file",
          language: "python",
          chunkCount: 2,
          lineCount: 38,
        },
      ],
    },
  ],
};

export function getFileTreeByRepo(repoId: string): FileTreeNode[] {
  return FILE_TREES_BY_REPO[repoId] ?? FILE_TREE;
}

// Helper lookups
export function getModulesByRepo(repoId: string): CodeModule[] {
  return MODULES.filter((m) => m.repoId === repoId);
}

export function getModuleById(id: string): CodeModule | undefined {
  return MODULES.find((m) => m.id === id);
}

export function getRepoById(id: string): Repo | undefined {
  return REPOS.find((r) => r.id === id);
}

export const CHAT_SUGGESTIONS = [
  "FastGPT SDK 的 RAG 检索是怎么和重排串联的？",
  "useDebounce 这个 Hook 的核心实现思路是什么？",
  "对话状态是用什么方案持久化的？",
  "检索时向量权重和关键词权重怎么分配？",
];
