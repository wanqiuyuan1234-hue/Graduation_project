"use client";

import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import {
  Bug,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Github,
  MessageSquareText,
  Pencil,
  Play,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_SUGGESTIONS,
  SOURCE_CHUNKS,
  getModuleById,
  getRepoById,
} from "@/lib/rag/mock-data";
import type {
  ChatMessage,
  Citation,
  RetrievalDebug,
  RetrievalResult,
  SourceChunk,
} from "@/lib/rag/types";
import { useNavStore } from "@/lib/rag/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MessageSkeleton } from "@/components/rag/shared/skeletons";
import { SourcePanel } from "./source-panel";
import { RetrievalDebugPanel } from "./retrieval-debug";
import { SessionSidebar } from "./session-sidebar";
import { MessageHistory } from "./message-history";
import { MessageEditor } from "./message-editor";

type ContentPart =
  | { type: "text"; value: string }
  | { type: "cite"; index: number };

function parseCitations(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "cite", index: parseInt(match[1], 10) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }
  return parts;
}

/**
 * Format a chat message timestamp ("YYYY-MM-DD HH:mm:ss") into a short label
 * for display in the message header. Returns "HH:mm" when the message was
 * sent today, otherwise "MM-DD HH:mm" so cross-day messages stay oriented.
 * Pure / deterministic — safe to call at render time.
 */
function formatTimestamp(ts: string): string {
  if (!ts || ts.length < 16) return ts ?? "";
  const msgDate = ts.slice(0, 10); // YYYY-MM-DD
  const time = ts.slice(11, 16); // HH:mm
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (msgDate === today) return time;
  // Different day → prefix with MM-DD so the user can tell at a glance.
  return `${ts.slice(5, 7)}-${ts.slice(8, 10)} ${time}`;
}

/**
 * Build mock citations + RetrievalDebug for a user message. Shared by the mock
 * fallback (`generateReply`) and the real-LLM success path (`fetchReply`) so
 * both replies show the same citation / retrieval UX — only the assistant
 * `content` differs (real LLM text vs. mock text). Returns the picked chunks
 * too so `generateReply` can reference their filePath in its mock content.
 *
 * Pure / deterministic except for the random `latencyMs` — safe to call at
 * render-time-adjacent points.
 */
function buildMockRetrievalContext(userText: string): {
  picks: SourceChunk[];
  citations: Citation[];
  retrieval: RetrievalDebug;
} {
  const picks = [SOURCE_CHUNKS[0], SOURCE_CHUNKS[1], SOURCE_CHUNKS[2]];
  const citations: Citation[] = picks.map((chunk, i) => ({
    index: i + 1,
    chunk,
  }));
  const retrieval: RetrievalDebug = {
    query: userText,
    topK: 6,
    reranked: true,
    rerankModel: "bge-reranker-v2-m3",
    latencyMs: 240 + Math.floor(Math.random() * 220),
    vectorWeight: 0.7,
    keywordWeight: 0.3,
    results: picks.map((chunk) => ({
      chunk,
      score: chunk.score,
      rerankedScore: chunk.rerankedScore ?? chunk.score,
    })),
  };
  return { picks, citations, retrieval };
}

/**
 * Rough token estimate for an LLM reply string. The real SDK doesn't return a
 * usage field we currently surface, so we approximate at ~3 chars/token (a
 * common rule of thumb for mixed CJK + latin text). Clamped to a 40-token
 * floor so very short replies don't render as "12 tokens" which looks broken.
 */
function estimateTokens(content: string): number {
  return Math.max(40, Math.round(content.length / 3));
}

function MessageContent({
  message,
  onCite,
}: {
  message: ChatMessage;
  onCite: (i: number) => void;
}) {
  const parts = useMemo(
    () => parseCitations(message.content),
    [message.content],
  );
  return (
    <div className="prose-chat">
      {parts.map((p, i) =>
        p.type === "text" ? (
          <ReactMarkdown key={i}>{p.value}</ReactMarkdown>
        ) : (
          <button
            key={i}
            type="button"
            className="citation-badge"
            onClick={() => onCite(p.index)}
            aria-label={`查看引用 ${p.index}`}
          >
            {p.index}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Stream-speed presets. `streamSpeed` (1-5, persisted in the nav store) maps
 * to a per-tick interval range (ms) + a per-tick token batch range. Faster
 * speeds use shorter intervals AND larger batches so the typewriter effect
 * stays smooth (a 8ms tick emitting 1 token would re-render 125×/s and peg
 * the main thread on ReactMarkdown re-parses; emitting 2-4 tokens per 8-16ms
 * tick halves the parse cost while still feeling "instant").
 *
 * Batches use inclusive ranges; a tick draws `batchMin + rand(batchMax-batchMin+1)`
 * tokens. The interval is also randomized once at stream start so two parallel
 * streams don't visually sync.
 *
 * Mid-stream speed changes do NOT re-pace an in-flight stream — the interval
 * is captured once at start. The next streamReply invocation picks up the new
 * speed because `streamSpeed` is in streamReply's useCallback deps.
 */
const SPEED_CONFIG: Record<
  number,
  { intervalMin: number; intervalMax: number; batchMin: number; batchMax: number }
> = {
  1: { intervalMin: 90, intervalMax: 130, batchMin: 1, batchMax: 1 }, // 极慢
  2: { intervalMin: 60, intervalMax: 90, batchMin: 1, batchMax: 1 }, // 慢
  3: { intervalMin: 28, intervalMax: 52, batchMin: 1, batchMax: 3 }, // 标准 (default)
  4: { intervalMin: 16, intervalMax: 30, batchMin: 2, batchMax: 3 }, // 快
  5: { intervalMin: 8, intervalMax: 16, batchMin: 2, batchMax: 4 }, // 极快
};

/**
 * Find the token boundary idx such that `tokens.slice(0, idx).join("")`
 * corresponds to the already-streamed `partial` content. Used by handleResume
 * to compute the remaining token slice to re-stream after a stop.
 *
 * `partial` is always the result of `tokens.slice(0, idx).join("")` for some
 * idx (set by streamReply's throttled flush), so this returns that exact idx.
 * If `partial` ends mid-token (defensive — shouldn't happen with the current
 * flush logic), we return the boundary <= partial.length so the remaining
 * stream re-emits the partial-token fragment; the terminal completion write
 * always overwrites with the exact full content, so no duplication persists.
 */
function findResumeTokenIdx(tokens: string[], partial: string): number {
  let acc = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (acc + tokens[i].length > partial.length) return i;
    acc += tokens[i].length;
  }
  return tokens.length;
}

export function ChatPage() {
  const sessions = useNavStore((s) => s.sessions);
  const activeSessionId = useNavStore((s) => s.activeSessionId);
  const sourcePanelOpen = useNavStore((s) => s.sourcePanelOpen);
  const activeCitationIndex = useNavStore((s) => s.activeCitationIndex);
  const streamSpeed = useNavStore((s) => s.streamSpeed);
  const setCitation = useNavStore((s) => s.setCitation);
  const setSourcePanelOpen = useNavStore((s) => s.setSourcePanelOpen);
  const createSession = useNavStore((s) => s.createSession);
  const setSessionMessages = useNavStore((s) => s.setSessionMessages);
  const replaceMessage = useNavStore((s) => s.replaceMessage);
  const updateMessage = useNavStore((s) => s.updateMessage);

  const baseSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  );
  const repo = baseSession ? getRepoById(baseSession.repoId) : undefined;

  // Per-session message map: when a session is first viewed, seed from
  // baseSession.messages (which themselves are persisted in the store, so
  // refresh-safe). Switching sessions recomputes currentMessages at render
  // time (no effect). Writes go through setMessages which ALSO syncs to the
  // store via setSessionMessages, so new messages persist across refresh.
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >({});
  const currentMessages =
    (baseSession && messagesBySession[baseSession.id]) ??
    baseSession?.messages ??
    [];

  const setMessages = useCallback(
    (next: ChatMessage[] | ((p: ChatMessage[]) => ChatMessage[])) => {
      if (!baseSession) return;
      setMessagesBySession((prev) => {
        const base = prev[baseSession.id] ?? baseSession.messages;
        const val =
          typeof next === "function"
            ? (next as (p: ChatMessage[]) => ChatMessage[])(base)
            : next;
        // Persist the new message array into the store session so it survives
        // refresh (zustand persist handles localStorage). Fire-and-forget;
        // the local map remains the source of truth for the current render.
        setSessionMessages(baseSession.id, val);
        return { ...prev, [baseSession.id]: val };
      });
    },
    [baseSession, setSessionMessages],
  );

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );
  const [stoppedMessages, setStoppedMessages] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // AbortController for the in-flight /api/chat fetch (if any). Set when
  // handleSend / handleRetry / handleEditSave kicks off fetchReply, cleared
  // when the fetch resolves or when handleStop aborts it. The unmount effect
  // also aborts any pending fetch so a delayed LLM response doesn't land
  // after the user navigates away.
  const abortRef = useRef<AbortController | null>(null);
  // Map of draft message id → the FULL pre-computed ChatMessage (content +
  // citations + retrieval + tokens) that streamReply is streaming toward.
  // Populated on streamReply start, deleted on streamReply completion. NOT
  // deleted on handleStop — so handleResume can read the full reply and
  // re-stream the remaining tokens from where the partial content left off.
  // Storing the full ChatMessage (not just content) lets resume completion
  // restore the citations / retrieval / tokens that the original stream
  // never got to flush (since the draft carries empty citations/retrieval
  // until the terminal completion write).
  const fullReplyByDraftId = useRef<Map<string, ChatMessage>>(new Map());

  const messages = currentMessages;

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );
  const activeCitations = lastAssistant?.citations ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  // Update a message's content IN THE LOCAL MAP ONLY (no store/persist write).
  // Used for high-frequency token streaming to avoid localStorage thrash.
  // The final complete message is persisted via setMessages on stream completion.
  const updateMessageLocal = useCallback(
    (messageId: string, patch: Partial<ChatMessage>) => {
      if (!baseSession) return;
      setMessagesBySession((prev) => {
        const base = prev[baseSession.id] ?? baseSession.messages;
        const next = base.map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        );
        return { ...prev, [baseSession.id]: next };
      });
    },
    [baseSession],
  );

  // Clear any pending stream interval AND in-flight LLM fetch on unmount so a
  // delayed reply doesn't land after the user navigates away. Cleanup-only
  // effect — no setState in body, so react-hooks/set-state-in-effect is not
  // triggered.
  useEffect(() => {
    return () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Brief skeleton (MessageSkeleton x2) when switching active session — 250ms.
  // Flip loading → true via render-time comparison (sync setState in effect
  // body would trip react-hooks/set-state-in-effect); the flip → false is
  // scheduled inside a setTimeout callback (async, allowed).
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [lastLoadedSession, setLastLoadedSession] = useState<string | null>(
    activeSessionId,
  );
  if (activeSessionId !== lastLoadedSession) {
    setLastLoadedSession(activeSessionId);
    setMessagesLoading(true);
  }
  useEffect(() => {
    if (!messagesLoading) return;
    const timer = window.setTimeout(() => setMessagesLoading(false), 250);
    return () => window.clearTimeout(timer);
  }, [messagesLoading, activeSessionId]);

  // Build a fresh mock assistant reply for the given user text. Used as the
  // FALLBACK when /api/chat fails (SDK not configured, network error, etc.)
 // so the app stays functional even without a working LLM backend. Pure
  // function, no side effects.
  const generateReply = useCallback((userText: string): ChatMessage => {
    const { picks, citations, retrieval } = buildMockRetrievalContext(userText);
    return {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: `根据代码库检索，在 \`${picks[0]?.filePath}\` 等模块中找到 **${picks.length}** 处参考 [1]。\n\n### 关键链路\n- 向量召回 + 关键词融合，topK=${retrieval.topK} 候选 [1][2]\n- \`bge-reranker-v2-m3\` 交叉编码器重排保留最相关切片 [2][3]\n- 最终交由 LLM 编排生成回答 [3]\n\n> 模拟回答：实际链路需对接后端 retrieve / rerank / LLM 服务。`,
      citations,
      retrieval,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      tokens: 180 + Math.floor(Math.random() * 80),
    };
  }, []);

  /**
   * Call /api/chat (the real z-ai-web-dev-sdk LLM backend) and return a fully
   * assembled ChatMessage whose `content` is the real LLM reply. Citations +
   * retrieval are still mock (we don't have a real vector DB wired to the LLM
   * yet) — they reuse buildMockRetrievalContext so the citation / debug UX is
   * unchanged.
   *
   * `history` should be the conversation BEFORE the new user message — this
   * function appends `{ role: "user", content: userText }` to it before
   * sending, matching the request shape /api/chat expects.
   *
   * Returns null when the fetch was aborted (user clicked stop). On any other
   * error (network / 500 / empty content), falls back to `generateReply` so
   * the user always gets a reply bubble. A toast surfaces the fallback so the
   * user knows the real LLM didn't respond.
   */
  const fetchReply = useCallback(
    async (
      userText: string,
      history: ChatMessage[],
      repoId: string | undefined,
      signal: AbortSignal,
    ): Promise<ChatMessage | null> => {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: now,
      };
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...history, userMsg],
            repoId,
          }),
          signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(
            `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
          );
        }
        const data = (await res.json()) as { content?: string };
        const content = (data?.content ?? "").trim();
        if (!content) throw new Error("Empty content from /api/chat");
        const { citations, retrieval } = buildMockRetrievalContext(userText);
        return {
          id: `a-${Date.now()}`,
          role: "assistant",
          content,
          citations,
          retrieval,
          timestamp: now,
          tokens: estimateTokens(content),
        };
      } catch (err) {
        // User aborted (clicked stop) — return null so the caller short-
        // circuits without streaming. We don't toast here because handleStop
        // already toasts "已停止生成".
        if (signal.aborted) return null;
        console.warn("[CodeRAG] /api/chat failed, falling back to mock reply:", err);
        toast.error("生成失败，使用模拟回复");
        return generateReply(userText);
      }
    },
    [generateReply],
  );

  // Split content into streaming "tokens" preserving whitespace, so the
  // typewriter effect reveals word-by-word (including newlines for markdown).
  function splitTokens(text: string): string[] {
    return text.split(/(\s+)/);
  }

  // Stream a pre-built reply's content into the messages array token-by-token.
  // Uses a local update (no store write) for each token; persists the final
  // complete message via setMessages on completion. Returns the interval handle.
  //
  // opts.startIdx + opts.prefix support resume-after-stop: streamReply slices
  // `tokens` from startIdx and prepends `prefix` (the already-streamed partial
  // content) to every throttled partial flush, so the resumed stream visually
  // appends to the existing partial instead of replacing it. The terminal
  // completion write always sets `fullReply.content` exactly, so even if the
  // prefix/startIdx arithmetic drifts by a fragment, the final rendered text
  // is the full content with no duplication.
  //
  // SPEED: interval + batchSize are derived from `streamSpeed` (1-5) via
  // SPEED_CONFIG. Faster speeds → shorter interval + larger batch. The
  // interval is randomized once at stream start so concurrent streams don't
  // visually sync. `streamSpeed` is in useCallback deps so a settings change
  // takes effect on the next streamReply invocation (mid-stream re-pace would
  // require clearing+resetting the interval, which we don't do — acceptable).
  //
  // THROTTLE: tokens accumulate in `emitted` across ticks, but updateMessageLocal
  // only fires when ≥60ms have passed since the last flush (≈2 ticks at the
  // 28-52ms pacing), or on completion. The first tick always flushes
  // (lastFlushTime=0) so the first token appears immediately; subsequent
  // ticks coalesce 2-3 tokens per flush, ~halving re-render frequency and
  // the ReactMarkdown re-parse cost without a perceptible typing delay
  // (60ms < human perception threshold for typing). The final completion
  // flush is unconditional, so the user always sees the full content +
  // citations even if the last partial flush was within the window.
  const streamReply = useCallback(
    (
      draftId: string,
      fullReply: ChatMessage,
      opts?: { startIdx?: number; prefix?: string },
    ) => {
      const startIdx = opts?.startIdx ?? 0;
      const prefix = opts?.prefix ?? "";
      const allTokens = splitTokens(fullReply.content);
      const tokens = allTokens.slice(startIdx);
      let emitted = 0;
      // Brief "thinking" delay before the first token lands.
      let firstTokenFired = false;
      // Throttle tracker: 0 → first tick always flushes (Date.now() - 0 ≫
      // THROTTLE_MS), so the very first token lands immediately for perceived
      // responsiveness. Subsequent partial flushes wait ≥60ms.
      let lastFlushTime = 0;
      const THROTTLE_MS = 60;
      // Retain the full reply so handleResume can re-stream remaining tokens
      // after a stop. Cleared on completion. On stop the entry stays — see
      // handleStop / handleResume.
      fullReplyByDraftId.current.set(draftId, fullReply);
      const speed = SPEED_CONFIG[streamSpeed] ?? SPEED_CONFIG[3];
      const intervalMs =
        speed.intervalMin +
        Math.floor(Math.random() * (speed.intervalMax - speed.intervalMin + 1));
      const batchSpan = speed.batchMax - speed.batchMin + 1;
      const interval = window.setInterval(
        () => {
          if (!firstTokenFired) {
            firstTokenFired = true;
          }
          // Emit batchMin..batchMax tokens per tick. Faster speeds emit more
          // tokens per tick (markdown splits give small whitespace tokens, so
          // batching keeps pacing readable and amortizes ReactMarkdown cost).
          const batchSize = speed.batchMin + Math.floor(Math.random() * batchSpan);
          for (let b = 0; b < batchSize && emitted < tokens.length; b++) {
            emitted++;
          }
          if (emitted >= tokens.length) {
            // Streaming complete: ALWAYS flush the final full message (with
            // citations + retrieval + tokens) to the local map AND persist to
            // the store, even if the last partial flush was within the throttle
            // window. This is the single guaranteed terminal write.
            updateMessageLocal(draftId, {
              content: fullReply.content,
              citations: fullReply.citations,
              retrieval: fullReply.retrieval,
              tokens: fullReply.tokens,
            });
            setMessages((prev) => {
              // setMessages persists to store via setSessionMessages — this is
              // the single store write for the whole stream.
              const next = prev.map((m) =>
                m.id === draftId ? { ...m, ...fullReply, content: fullReply.content } : m,
              );
              return next;
            });
            fullReplyByDraftId.current.delete(draftId);
            setStreaming(false);
            setStreamingMessageId(null);
            if (streamTimerRef.current) {
              clearInterval(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            return;
          }
          // THROTTLE: tokens accumulate in `emitted` across ticks, but we only
          // re-render when ≥60ms have passed since the last flush (≈2 ticks at
          // the 28-52ms pacing). Date.now() - 0 is always ≥60 on the first
          // tick so the very first token lands immediately (perceived
          // responsiveness); subsequent ticks coalesce 2-3 tokens per flush,
          // ~halving ReactMarkdown re-parse cost. The accumulated content
          // lives in `prefix + tokens.slice(0, emitted).join("")` (emitted
          // keeps advancing), so a delayed flush still shows every token
          // received so far — no content is lost between flushes. Prefix is
          // "" for fresh streams and the partial content for resumed streams.
          const now = Date.now();
          if (now - lastFlushTime >= THROTTLE_MS) {
            const partialContent = prefix + tokens.slice(0, emitted).join("");
            updateMessageLocal(draftId, { content: partialContent });
            lastFlushTime = now;
          }
        },
        intervalMs,
      );
      streamTimerRef.current = interval;
    },
    [updateMessageLocal, setMessages, streamSpeed],
  );

  /**
   * Run fetchReply → streamReply for a draft that was already inserted into
   * the messages array. Shared by handleSend / handleRetry / handleEditSave
   * so all three paths share the same thinking-phase + abort + fallback
   * behavior. `historyForFetch` is the conversation BEFORE the user message
   * we're asking about (fetchReply appends the user message itself).
   *
   * Side effects: sets abortRef.current to a fresh AbortController for the
   * duration of the fetch, then clears it (or it's cleared by handleStop on
   * abort). On resolve, hands the reply to streamReply which begins the
   * token-by-token typewriter. On abort, no-ops.
   */
  const runFetchThenStream = useCallback(
    (
      draftId: string,
      userText: string,
      historyForFetch: ChatMessage[],
      repoId: string | undefined,
      extraReplyFields?: Partial<ChatMessage>,
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      void (async () => {
        const reply = await fetchReply(
          userText,
          historyForFetch,
          repoId,
          controller.signal,
        );
        // User aborted (handleStop set abortRef.current = null) OR a new
        // fetch was started (abortRef.current points to a different
        // controller). Either way, don't start streaming.
        if (!reply) return;
        if (abortRef.current !== controller) return;
        abortRef.current = null;
        const finalReply: ChatMessage = {
          ...reply,
          id: draftId,
          ...extraReplyFields,
        };
        streamReply(draftId, finalReply);
      })();
    },
    [fetchReply, streamReply],
  );

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming || !baseSession) return;
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: now,
      };
      const draftId = `a-${Date.now()}`;
      const draft: ChatMessage = {
        id: draftId,
        role: "assistant",
        content: "",
        timestamp: now,
      };
      // Capture history BEFORE the user message is added — fetchReply will
      // append the user message itself when building the /api/chat request.
      const historyForFetch = messages;
      // Append user + empty draft, then start streaming. Use setMessages so
      // both persist to the store (the draft's empty state is fine to persist).
      setMessages((prev) => [...prev, userMsg, draft]);
      setInput("");
      setStreaming(true);
      setStreamingMessageId(draftId);
      // Thinking phase: while fetchReply is pending, the empty draft bubble
      // renders TypingDots (see MessageItem). The old 200ms thinkTimer is
      // replaced by the actual fetch duration — when the LLM responds,
      // streamReply takes over and the typewriter begins on real content.
      runFetchThenStream(draftId, trimmed, historyForFetch, baseSession.repoId);
    },
    [baseSession, streaming, messages, setMessages, runFetchThenStream],
  );

  // Stop an in-flight stream OR a pending thinking-phase fetch: abort the
  // /api/chat request (if still pending), clear the stream interval (if
  // streaming has started), keep whatever partial content has landed, mark
  // the message as stopped, and inform the user.
  const handleStop = useCallback(() => {
    // Abort any in-flight /api/chat fetch so a delayed LLM response doesn't
    // land after the user already stopped (which would start streaming onto
    // an already-stopped draft). runFetchThenStream's IIFE checks
    // abortRef.current === controller and bails if it's been cleared.
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    if (streamingMessageId) {
      // Persist the partial content to the store so it survives refresh.
      const stoppedId = streamingMessageId;
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === stoppedId ? { ...m } : m,
        );
        return next;
      });
      setStoppedMessages((prev) => new Set(prev).add(stoppedId));
      // NOTE: fullReplyByDraftId entry is intentionally NOT deleted — it
      // holds the full pre-computed reply (content + citations + retrieval)
      // so handleResume can re-stream the remaining tokens after stop.
      // (Only populated once streamReply has started; if stop fired during
      // the thinking phase before streamReply ran, there's no entry —
      // handleResume will toast "无法继续，未找到完整内容".)
    }
    setStreaming(false);
    setStreamingMessageId(null);
    toast.info("已停止生成");
  }, [streamingMessageId, setMessages]);

  // Resume a stopped assistant message: re-stream the REMAINING tokens from
  // where the partial content left off, then on completion restore the full
  // content + citations + retrieval + tokens from the retained fullReply.
  //
  // The partial content always corresponds to a token boundary (set by
  // streamReply's throttled flush as `tokens.slice(0, idx).join("")`), so
  // findResumeTokenIdx returns that exact idx; the remaining slice is what
  // we re-stream with `prefix = partial` so partial flushes read
  // `partial + tokens.slice(0, emitted).join("")` — visually appending.
  //
  // Edge: if the partial already covers the full content (e.g. stop fired
  // between the last token and the terminal completion write), there's
  // nothing to stream — we still need to restore citations/retrieval/tokens
  // (the draft never got the terminal flush), so we do the completion write
  // inline and toast "已无更多内容".
  const handleResume = useCallback(
    (messageId: string) => {
      if (streaming || !baseSession) return;
      const fullReply = fullReplyByDraftId.current.get(messageId);
      if (!fullReply) {
        toast.info("无法继续，未找到完整内容");
        return;
      }
      const existing = messages.find((m) => m.id === messageId);
      if (!existing) {
        toast.error("未找到消息");
        return;
      }
      const partial = existing.content;
      const allTokens = splitTokens(fullReply.content);
      const startIdx = findResumeTokenIdx(allTokens, partial);
      // Clear the stopped badge first so the streaming cursor takes its place.
      setStoppedMessages((prev) => {
        const n = new Set(prev);
        n.delete(messageId);
        return n;
      });
      if (startIdx >= allTokens.length) {
        // Partial already covers the full content but the terminal write
        // (citations/retrieval/tokens) never happened — do it inline.
        updateMessageLocal(messageId, {
          content: fullReply.content,
          citations: fullReply.citations,
          retrieval: fullReply.retrieval,
          tokens: fullReply.tokens,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, ...fullReply, content: fullReply.content }
              : m,
          ),
        );
        fullReplyByDraftId.current.delete(messageId);
        toast.info("已无更多内容");
        return;
      }
      setStreaming(true);
      setStreamingMessageId(messageId);
      streamReply(messageId, fullReply, { startIdx, prefix: partial });
    },
    [streaming, baseSession, messages, streamReply, updateMessageLocal, setMessages],
  );

  // Retry the last assistant reply: locate the last assistant message and the
  // user message that preceded it, push the old reply into its `versions`
  // history, then replace it with a fresh empty draft and stream a new reply.
  const handleRetry = useCallback(() => {
    if (streaming || !baseSession) return;
    let lastAssistantIdx = -1;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (lastAssistantIdx === -1 && messages[i].role === "assistant") {
        lastAssistantIdx = i;
      } else if (lastAssistantIdx !== -1 && messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1 || lastUserIdx === -1) {
      toast.error("未找到可重新生成的回复");
      return;
    }
    const userText = messages[lastUserIdx].content;
    const oldAssistant = messages[lastAssistantIdx];
    const draftId = `a-${Date.now()}`;
    // Build the draft carrying the accumulated version history (old reply
    // pushed into versions[] so MessageHistory can show prior versions).
    const priorVersions = [
      ...(oldAssistant.versions ?? []),
      { ...oldAssistant, versions: undefined },
    ];
    const draft: ChatMessage = {
      id: draftId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      versions: priorVersions,
    };
    // History for fetchReply = messages BEFORE the user message we're
    // regenerating (so the LLM sees the same context as the original reply,
    // not the prior assistant reply we're about to replace).
    const historyForFetch = messages.slice(0, lastUserIdx);
    // Replace the old assistant with the draft in the local map AND sync to
    // store via setMessages (so version history persists across refresh).
    setMessages((prev) => {
      const next = [...prev];
      next[lastAssistantIdx] = draft;
      return next;
    });
    setStoppedMessages((prev) => {
      const n = new Set(prev);
      n.delete(oldAssistant.id);
      return n;
    });
    setStreaming(true);
    setStreamingMessageId(draftId);
    // Carry priorVersions into the final streamed reply so streamReply's
    // terminal setMessages ({ ...m, ...fullReply }) preserves them on the
    // completed message — without this, the version history would be lost
    // when streaming finishes.
    runFetchThenStream(draftId, userText, historyForFetch, baseSession.repoId, {
      versions: priorVersions,
    });
  }, [streaming, baseSession, messages, setMessages, runFetchThenStream]);

  // Edit a user message: update its content (mark edited), drop all messages
  // after it, then trigger a fresh streamed reply for the new content.
  const handleEditSave = useCallback(
    (messageId: string, newContent: string) => {
      if (!baseSession || streaming) return;
      const trimmed = newContent.trim();
      if (!trimmed) {
        toast.error("内容不能为空");
        return;
      }
      // Find the edited message index in the current messages.
      const editIdx = messages.findIndex((m) => m.id === messageId);
      if (editIdx === -1) return;
      // Build the truncated array with the edited user message updated in place.
      // setMessages writes to the local map AND syncs to the store via
      // setSessionMessages, so the edit persists across refresh.
      const kept = messages.slice(0, editIdx + 1).map((m, i) =>
        i === editIdx ? { ...m, content: trimmed, edited: true } : m,
      );
      setMessages(kept);
      setEditingId(null);
      setStoppedMessages(new Set());
      // Kick off a fresh streamed reply for the edited content.
      const draftId = `a-${Date.now()}`;
      const draft: ChatMessage = {
        id: draftId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      };
      // History for fetchReply = messages BEFORE the edited user message
      // (kept[editIdx] is the edited user message itself; fetchReply appends
      // a fresh user message with the new content).
      const historyForFetch = kept.slice(0, editIdx);
      setMessages((prev) => [...prev, draft]);
      setStreaming(true);
      setStreamingMessageId(draftId);
      runFetchThenStream(draftId, trimmed, historyForFetch, baseSession.repoId);
    },
    [baseSession, streaming, messages, setMessages, runFetchThenStream],
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    setSourcePanelOpen(false);
    setCitation(null);
  }, [setMessages, setSourcePanelOpen, setCitation]);

  const handleJumpToCode = useCallback((chunk: SourceChunk) => {
    const targetModule = chunk.moduleId ? getModuleById(chunk.moduleId) : undefined;
    if (!targetModule) {
      toast.error("该切片未关联可跳转的模块");
      return;
    }
    useNavStore.getState().openModule(targetModule.id, {
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    });
    toast.success(`跳转 ${targetModule.name} · L${chunk.startLine}-L${chunk.endLine}`);
  }, []);

  /**
   * Build a new mock RetrievalDebug from the given params and update the last
   * assistant message's retrieval + citations in place.
   */
  const handleReRetrieve = useCallback(
    (params: { topK: number; rerank: boolean; vectorWeight: number }) => {
      const lastAssistantMsg = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (!lastAssistantMsg) {
        toast.error("暂无可重新检索的助手回复");
        return;
      }

      // Pick topK chunks from SOURCE_CHUNKS, cycling if topK > available.
      const picks: SourceChunk[] = [];
      for (let i = 0; i < params.topK; i++) {
        picks.push(SOURCE_CHUNKS[i % SOURCE_CHUNKS.length]);
      }

      // Compute new scores with slight randomness, descending by raw score.
      const results: RetrievalResult[] = picks.map((chunk, i) => {
        const base = 0.86 - i * 0.035;
        const jitter = (Math.random() - 0.5) * 0.06;
        const score = Math.max(0.35, Math.min(0.95, base + jitter));
        const rerankedScore = params.rerank
          ? Math.max(0.4, Math.min(0.97, score + 0.04 + (Math.random() - 0.5) * 0.08))
          : score;
        return { chunk, score, rerankedScore };
      });

      const latencyMs = 200 + Math.floor(Math.random() * 251); // 200-450
      const nextDebug: RetrievalDebug = {
        query: lastAssistantMsg.retrieval?.query ?? "",
        topK: params.topK,
        reranked: params.rerank,
        rerankModel: "bge-reranker-v2-m3",
        latencyMs,
        vectorWeight: params.vectorWeight,
        keywordWeight: 1 - params.vectorWeight,
        results,
      };

      // Derive citations capped at 3-5 from the top results.
      const citeCount = Math.min(5, Math.max(3, Math.min(params.topK, 5)));
      const nextCitations: Citation[] = results
        .slice(0, citeCount)
        .map((r, i) => ({ index: i + 1, chunk: r.chunk }));

      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = {
              ...next[i],
              retrieval: nextDebug,
              citations: nextCitations,
            };
            break;
          }
        }
        return next;
      });

      toast.success(`已重新检索 · ${latencyMs}ms`);
    },
    [messages, setMessages],
  );

  // Empty state: all sessions deleted.
  if (!baseSession) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Sparkles className="size-8 text-brand/60" />
          <p className="text-sm">暂无会话，点击新建开始对话</p>
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={() => {
              createSession();
              toast.success("已创建新对话");
            }}
          >
            <MessageSquareText className="size-4" />
            新建会话
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* sidebar (desktop) */}
      <SessionSidebar />

      {/* chat column */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-border bg-card/60 px-4 py-3 backdrop-blur-md md:px-6">
          {/* mobile session list trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="会话列表"
                title="会话列表"
              >
                <MessageSquareText className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 gap-0 p-0 [&>button:last-child]:hidden"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>会话列表</SheetTitle>
              </SheetHeader>
              <SessionSidebar
                className="flex w-full !border-r-0"
                onSessionChange={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareText className="size-4 shrink-0 text-brand" />
            <h1 className="truncate text-[15px] font-semibold">{baseSession.title}</h1>
          </div>
          {repo && (
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] sm:inline-flex">
              <Github className="size-3 text-muted-foreground" />
              <span className="font-medium">{repo.name}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{repo.totalChunks} 切片</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">清空</span>
            </Button>
            <Button
              variant={showDebug ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowDebug((v) => !v)}
            >
              <Bug className="size-4" />
              <span className="hidden sm:inline">检索调试</span>
            </Button>
          </div>
        </div>

        {/* inline debug for the last assistant message (editable) */}
        {showDebug && lastAssistant?.retrieval && (
          <div className="border-b border-border bg-muted/30 px-4 py-3 md:px-6">
            <div className="mx-auto max-w-3xl">
              <RetrievalDebugPanel
                debug={lastAssistant.retrieval}
                editable
                onReRetrieve={handleReRetrieve}
                onSelectResult={handleJumpToCode}
              />
            </div>
          </div>
        )}

        {/* messages */}
        <div
          className="scrollbar-thin flex-1 overflow-y-auto px-4 py-6 md:px-8"
          role="log"
          aria-live="polite"
          aria-label="对话消息"
        >
          <div className="mx-auto max-w-3xl space-y-5">
            {messagesLoading ? (
              <>
                <MessageSkeleton />
                <MessageSkeleton />
              </>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Sparkles className="size-8 text-brand/60" />
                    <p className="text-sm">开始向 CodeRAG 提问吧</p>
                  </div>
                )}
                {messages.map((m, idx) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <MessageItem
                      message={m}
                      isLast={idx === messages.length - 1}
                      isStreaming={streamingMessageId === m.id}
                      isStopped={stoppedMessages.has(m.id)}
                      isEditing={editingId === m.id}
                      canEdit={!streaming && (m.role === "user")}
                      canRetry={!streaming && m.role === "assistant"}
                      canResume={!streaming && m.role === "assistant"}
                      onCite={(i) => setCitation(i)}
                      onOpenSources={() => setSourcePanelOpen(true)}
                      onRetry={m.role === "assistant" ? handleRetry : undefined}
                      retryDisabled={streaming}
                      onResume={
                        m.role === "assistant"
                          ? () => handleResume(m.id)
                          : undefined
                      }
                      onStartEdit={() => setEditingId(m.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(newContent) => handleEditSave(m.id, newContent)}
                    />
                  </motion.div>
                ))}
                {streaming && !streamingMessageId && <TypingIndicator />}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* suggestions + input */}
        <div className="border-t border-border bg-card/60 px-4 py-3 backdrop-blur-md md:px-8">
          <div className="mx-auto max-w-3xl space-y-2.5">
            {!streaming && lastAssistant && (
              <div className="flex flex-wrap gap-1.5">
                {CHAT_SUGGESTIONS.slice(0, 3).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:border-brand/40 hover:bg-brand-soft/30 hover:text-brand-soft-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-card">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                placeholder="向 CodeRAG 提问，Enter 发送 / Shift+Enter 换行"
                aria-label="提问输入框"
                className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
                rows={1}
              />
              {streaming ? (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleStop}
                  className="size-9 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="停止生成"
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => handleSend(input)}
                  disabled={!input.trim()}
                  className="size-9 rounded-lg bg-brand text-brand-foreground hover:bg-brand/90"
                  aria-label="发送"
                >
                  <SendHorizontal className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <SourcePanel
          open={sourcePanelOpen}
          onClose={() => setSourcePanelOpen(false)}
          citations={activeCitations}
          activeIndex={activeCitationIndex}
          onSelect={(i) => setCitation(i)}
          onJumpToCode={handleJumpToCode}
        />
      </div>
    </div>
  );
}

function MessageItem({
  message,
  isLast,
  isStreaming,
  isStopped,
  isEditing,
  canEdit,
  canRetry,
  canResume,
  onCite,
  onOpenSources,
  onRetry,
  retryDisabled,
  onResume,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  message: ChatMessage;
  isLast?: boolean;
  isStreaming?: boolean;
  isStopped?: boolean;
  isEditing?: boolean;
  canEdit?: boolean;
  canRetry?: boolean;
  canResume?: boolean;
  onCite: (i: number) => void;
  onOpenSources: () => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
  onResume?: () => void;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (newContent: string) => void;
}) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("已复制到剪贴板");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  }, [message.content]);

  if (message.role === "user") {
    // Editing mode: render the inline MessageEditor instead of the bubble.
    if (isEditing && onSaveEdit && onCancelEdit) {
      return (
        <div className="flex justify-end">
          <div className="w-[80%] max-w-[80%]">
            <MessageEditor
              message={message}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <div className="user-bubble group relative max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-brand-foreground shadow-card">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-brand-foreground opacity-60 transition-opacity group-hover:opacity-100">
            {message.edited && <span className="italic">已编辑</span>}
            <span>{message.timestamp.slice(11, 16)}</span>
          </div>
          <div className="absolute -right-2 -top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-full border border-border bg-card text-muted-foreground shadow-card hover:text-foreground"
              onClick={handleCopy}
              aria-label="复制消息"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
            {canEdit && onStartEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 rounded-full border border-border bg-card text-muted-foreground shadow-card hover:text-brand"
                onClick={onStartEdit}
                aria-label="编辑消息"
              >
                <Pencil className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="assistant-card rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <Sparkles className="size-4" />
        </div>
        <span className="text-[13px] font-semibold">CodeRAG</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatTimestamp(message.timestamp)}
          </span>
          {message.tokens && !isStreaming && (
            <span className="border-l border-border pl-2">{message.tokens} tokens</span>
          )}
          {isStreaming && (
            <span className="border-l border-border pl-2 text-muted-foreground">生成中…</span>
          )}
        </div>
      </div>

      <div className={cn(isStreaming && "min-h-[2rem]")}>
        {isStreaming && !message.content ? (
          // Thinking phase: fetchReply is pending and no content has landed
          // yet. Show three pulsing brand-blue dots (same visual language as
          // the standalone TypingIndicator) so the user sees the model is
          // preparing a response. Once the first token arrives, this branch
          // is replaced by MessageContent + the streaming cursor below.
          <div
            className="flex items-center gap-1.5 px-1 py-2"
            role="status"
            aria-label="正在生成回复"
          >
            <span className="size-2 animate-pulse rounded-full bg-brand/60 [animation-delay:-0.3s]" />
            <span className="size-2 animate-pulse rounded-full bg-brand/60 [animation-delay:-0.15s]" />
            <span className="size-2 animate-pulse rounded-full bg-brand/60" />
          </div>
        ) : (
          <>
            <MessageContent message={message} onCite={onCite} />
            {isStreaming && (
              <span
                className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse self-center align-middle bg-brand"
                aria-hidden
              />
            )}
          </>
        )}
      </div>

      {isStopped && (
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
            <Square className="size-2.5 fill-current" />
            已停止生成
          </span>
          {canResume && onResume && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-brand hover:bg-brand-soft hover:text-brand-soft-foreground"
              onClick={onResume}
              aria-label="继续生成"
            >
              <Play className="size-3" />
              继续生成
            </Button>
          )}
        </div>
      )}

      {!isStreaming && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12px] text-muted-foreground">
          {message.citations && message.citations.length > 0 && (
            <>
              <span>
                来源 <span className="font-semibold text-foreground tabular-nums">{message.citations.length}</span> 条
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[12px] text-brand hover:bg-brand-soft hover:text-brand-soft-foreground"
                onClick={onOpenSources}
              >
                查看来源
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
              aria-label="复制消息"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              <span>{copied ? "已复制" : "复制"}</span>
            </Button>
            {isLast && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[12px] text-brand hover:bg-brand-soft hover:text-brand-soft-foreground"
                onClick={onRetry}
                disabled={retryDisabled}
                aria-label="重新生成"
              >
                <RefreshCw className="size-3.5" />
                <span>重新生成</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {message.retrieval && !isStreaming && (
        <Collapsible open={debugOpen} onOpenChange={setDebugOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent"
            >
              <Bug className="size-3.5" />
              检索调试 · {message.retrieval.latencyMs}ms
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  debugOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <RetrievalDebugPanel debug={message.retrieval} />
          </CollapsibleContent>
        </Collapsible>
      )}

      {message.versions && message.versions.length > 0 && !isStreaming && (
        <div className="mt-2">
          <MessageHistory message={message} />
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 shadow-card"
      role="status"
      aria-label="正在生成回复"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <Sparkles className="size-4" />
        </div>
        <span className="text-[13px] font-semibold">CodeRAG</span>
      </div>
      <div className="flex items-center gap-1.5 px-1 py-2">
        <span className="size-2 animate-pulse rounded-full bg-brand/60 [animation-delay:-0.3s]" />
        <span className="size-2 animate-pulse rounded-full bg-brand/60 [animation-delay:-0.15s]" />
        <span className="size-2 animate-pulse rounded-full bg-brand/60" />
      </div>
    </div>
  );
}
