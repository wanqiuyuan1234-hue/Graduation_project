import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { CHAT_SESSIONS, SOURCE_CHUNKS } from "./mock-data";
import type { ChatMessage, ChatSession, SourceChunk, ViewId } from "./types";

const THEME_STORAGE_KEY = "coderag-theme";
const NAV_STORAGE_KEY = "coderag-nav";

// O(1) chunk-id → full SourceChunk lookup, built once at module load. Used by
// `fattenMessage` during store rehydration to restore the heavy `content`
// strings that `slimMessage` stripped before persisting. Keeping this as a
// module-level Map avoids a linear scan over SOURCE_CHUNKS for every message
// citation/result on every page load.
const SOURCE_CHUNK_BY_ID: ReadonlyMap<string, SourceChunk> = new Map(
  SOURCE_CHUNKS.map((c) => [c.id, c]),
);

/**
 * Strip the heavy `content` field (typically 300-600 tokens of code per chunk)
 * from each SourceChunk embedded in a message's citations / retrieval results
 * before the message is persisted to localStorage. The chunk `id` and the
 * small metadata fields (filePath, language, line range, scores) are kept so
 * the Source Panel can still render a fallback if a chunk can't be rehydrated.
 *
 * IMPORTANT: the in-memory store ALWAYS holds full chunks (with `content`).
 * Only the serialized localStorage representation is slimmed — `partialize`
 * runs the slim transform on the way out, `onRehydrateStorage` runs the
 * inverse fatten transform on the way in. Type safety is preserved because
 * `SourceChunk` stays a full object in memory; we just zero out `content`
 * (an empty string is still a valid `string`) for the persisted copy.
 *
 * A single Q&A roundtrip drops from ~22KB to ~2-4KB, keeping us well clear of
 * the 5MB localStorage cap even with many sessions / messages.
 */
function slimMessage(msg: ChatMessage): ChatMessage {
  const slimCitations = msg.citations?.map((c) => ({
    index: c.index,
    chunk: { ...c.chunk, content: "" },
  }));
  const slimRetrieval = msg.retrieval
    ? {
        ...msg.retrieval,
        results: msg.retrieval.results.map((r) => ({
          ...r,
          chunk: { ...r.chunk, content: "" },
        })),
      }
    : undefined;
  // Recursively slim prior retry versions so the localStorage payload stays
  // small even when a message has accumulated many history snapshots. Each
  // version is itself a full ChatMessage (with its own citations / retrieval),
  // so the same slim transform applies. An empty/undefined versions array is
  // preserved as-is to keep the field shape stable.
  const slimVersions = msg.versions?.map(slimMessage);
  return {
    ...msg,
    citations: slimCitations,
    retrieval: slimRetrieval,
    versions: slimVersions,
  };
}

/**
 * Inverse of `slimMessage`: re-inject the full `content` (and rest of the
 * SourceChunk) by looking up the chunk `id` in the in-memory SOURCE_CHUNKS
 * mock. Messages with no citations / retrieval pass through unchanged.
 *
 * If a chunk id is no longer present in SOURCE_CHUNKS (e.g. the source repo
 * was removed in a deploy), the slimmed stub is kept as-is — its `content`
 * will be "" and the Source Panel will render an empty code block, which is
 * an acceptable graceful degradation rather than crashing.
 */
function fattenMessage(msg: ChatMessage): ChatMessage {
  if (!msg.citations && !msg.retrieval && !msg.versions) return msg;
  const fattenCitations = msg.citations?.map((c) => {
    const full = SOURCE_CHUNK_BY_ID.get(c.chunk.id);
    return full ? { index: c.index, chunk: full } : c;
  });
  const fattenRetrieval = msg.retrieval
    ? {
        ...msg.retrieval,
        results: msg.retrieval.results.map((r) => {
          const full = SOURCE_CHUNK_BY_ID.get(r.chunk.id);
          return full ? { ...r, chunk: full } : r;
        }),
      }
    : undefined;
  // Recursively fatten prior retry versions so the in-memory store always
  // holds full chunk content (including for the version history shown in the
  // MessageHistory panel). Without this, expanding a historical version
  // after a refresh would render an empty code block.
  const fattenVersions = msg.versions?.map(fattenMessage);
  return {
    ...msg,
    citations: fattenCitations,
    retrieval: fattenRetrieval,
    versions: fattenVersions,
  };
}

// Initialize theme synchronously from localStorage on the client to avoid
// the [theme] effect clobbering the persisted value on mount. Guarded for SSR.
// NOTE: `theme` is intentionally NOT persisted via zustand persist (see
// `partialize` below) — it is managed separately by app-header's effect +
// the inline no-FOUC script in layout.tsx, so we exclude it here to avoid a
// double-source-of-truth on hydration.
function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch {
    // ignore storage errors
  }
  return "light";
}

// Format a Date as "YYYY-MM-DD HH:mm" in local time, matching the createdAt
// format used by CHAT_SESSIONS mock data.
function formatSessionTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

interface NavState {
  view: ViewId;
  activeModuleId: string | null;
  // optional line range to highlight in detail view (from chat source jump)
  detailHighlight: { startLine: number; endLine: number } | null;
  activeRepoId: string;
  // chat state
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeCitationIndex: number | null;
  sourcePanelOpen: boolean;
  // theme
  theme: "light" | "dark";
  // streaming token emission speed (1=slowest, 5=fastest). Persisted so the
  // user's preference survives refresh; chat-page's streamReply can read it
  // via `useNavStore.getState().streamSpeed` to scale its per-token delay.
  // NOTE: wiring streamSpeed into streamReply is deferred to a later round
  // (chat-page is currently off-limits); the setting is stored now so the
  // Settings UI is functional and the value is ready to consume.
  streamSpeed: number;
  // navigate
  go: (view: ViewId) => void;
  openModule: (moduleId: string, highlight?: { startLine: number; endLine: number } | null) => void;
  openRepo: (repoId: string, view?: ViewId) => void;
  /** 只切换当前仓库，不改变当前视图（供后端仓库列表校正旧的 mock id）。 */
  setActiveRepoId: (repoId: string) => void;
  openChatWithSession: (sessionId: string) => void;
  setCitation: (index: number | null) => void;
  setSourcePanelOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (t: "light" | "dark") => void;
  setStreamSpeed: (speed: number) => void;
  // session CRUD
  createSession: (repoId?: string) => string;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setActiveSession: (id: string) => void;
  // session message mutation — exposed so chat-page (or future callers) can
  // write new/existing messages back into the persisted store. Without these,
  // the chat-page's in-memory `messagesBySession` map survives a session
  // switch but NOT a refresh; once chat-page adopts these actions, full
  // per-message persistence across refresh is enabled "for free" via the
  // persist middleware below.
  appendMessage: (sessionId: string, message: ChatMessage) => void;
  setSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  // Replace a single message by id within a session's messages array.
  // Used by retry: the caller builds a new ChatMessage whose top-level fields
  // hold the regenerated content/citations/retrieval/tokens and whose
  // `versions` array contains the prior reply snapshots (oldest first),
  // then calls replaceMessage to atomically swap the old message out.
  // Also used by message edit: the caller passes an updated ChatMessage with
  // `edited: true` and a new `content`.
  replaceMessage: (sessionId: string, messageId: string, newMessage: ChatMessage) => void;
  // Shallow-merge a patch into a single message by id. Convenient for
  // toggling flags like `edited: true` or adjusting `tokens` after streaming
  // without rebuilding the whole message object. The patch is merged via
  // spread so nested fields (citations / retrieval / versions) are replaced,
  // not deep-merged — callers that need to mutate nested data should pass the
  // full new nested value.
  updateMessage: (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => void;
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      view: "modules",
      activeModuleId: null,
      detailHighlight: null,
      activeRepoId: "",
      // 初始为空；仓库列表由后端返回后，由 useRepos 校正为第一个真实仓库 id。
      // Initial seed from CHAT_SESSIONS mock. On first load (no persisted
      // state yet) this is what the user sees; once persisted state exists it
      // hydrates over these defaults, replacing the mock list with the user's
      // actual created/renamed/deleted sessions.
      sessions: CHAT_SESSIONS,
      activeSessionId: "sess-1",
      activeCitationIndex: null,
      sourcePanelOpen: false,
      theme: getInitialTheme(),
      streamSpeed: 3,
      go: (view) => set({ view }),
      openModule: (moduleId, highlight = null) =>
        set({
          view: "detail",
          activeModuleId: moduleId,
          detailHighlight: highlight,
          activeCitationIndex: null,
          sourcePanelOpen: false,
        }),
      openRepo: (repoId, view = "knowledge") => set({ activeRepoId: repoId, view }),
      setActiveRepoId: (repoId) => set({ activeRepoId: repoId }),
      openChatWithSession: (sessionId) => set({ view: "chat", activeSessionId: sessionId }),
      setCitation: (index) => set({ activeCitationIndex: index, sourcePanelOpen: index !== null }),
      setSourcePanelOpen: (open) => set({ sourcePanelOpen: open }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setTheme: (t) => set({ theme: t }),
      setStreamSpeed: (speed) => set({ streamSpeed: Math.min(5, Math.max(1, Math.round(speed))) }),
      createSession: (repoId) => {
        const id = `sess-${Date.now()}`;
        const nowRepoId = repoId ?? get().activeRepoId;
        const session: ChatSession = {
          id,
          title: "新对话",
          repoId: nowRepoId,
          messages: [],
          createdAt: formatSessionTimestamp(new Date()),
        };
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: id,
          activeRepoId: nowRepoId,
          activeCitationIndex: null,
          sourcePanelOpen: false,
        }));
        return id;
      },
      deleteSession: (id) =>
        set((s) => {
          const next = s.sessions.filter((sess) => sess.id !== id);
          const wasActive = s.activeSessionId === id;
          const nextActive = wasActive
            ? next.length > 0
              ? next[0].id
              : null
            : s.activeSessionId;
          return {
            sessions: next,
            activeSessionId: nextActive,
            activeCitationIndex: null,
            sourcePanelOpen: false,
          };
        }),
      renameSession: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, title: title.trim() || sess.title } : sess,
          ),
        })),
      setActiveSession: (id) =>
        set({ activeSessionId: id, activeCitationIndex: null, sourcePanelOpen: false }),
      appendMessage: (sessionId, message) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, messages: [...sess.messages, message] } : sess,
          ),
        })),
      setSessionMessages: (sessionId, messages) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, messages } : sess,
          ),
        })),
      replaceMessage: (sessionId, messageId, newMessage) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  messages: sess.messages.map((m) =>
                    m.id === messageId ? newMessage : m,
                  ),
                }
              : sess,
          ),
        })),
      updateMessage: (sessionId, messageId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  messages: sess.messages.map((m) =>
                    m.id === messageId ? { ...m, ...patch } : m,
                  ),
                }
              : sess,
          ),
        })),
    }),
    {
      name: NAV_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Persist ONLY session list + active ids — these are the durable
      // user-data pieces. Transient UI state (view, activeModuleId,
      // detailHighlight, sourcePanelOpen, activeCitationIndex) and `theme`
      // (managed separately via app-header effect + inline no-FOUC script)
      // are excluded so a refresh always lands the user back on the modules
      // browser with the persisted session list intact.
      //
      // slimMessage: zero out the heavy `content` field on each chunk ref
      // inside citations / retrieval.results before writing to localStorage.
      // The chunk `id` (and small metadata) is preserved so onRehydrateStorage
      // can restore the full content from the in-memory SOURCE_CHUNKS mock.
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.map(slimMessage),
        })),
        activeSessionId: state.activeSessionId,
        activeRepoId: state.activeRepoId,
        streamSpeed: state.streamSpeed,
      }),
      // After the slimmed persisted state is merged into the in-memory store,
      // walk every message and rehydrate its citations / retrieval results
      // with the full SourceChunk (content + all metadata) looked up by `id`
      // from SOURCE_CHUNKS. This runs synchronously after `set` so React
      // subscribers see the fattened state on their next render — no
      // intermediate "empty content" frame is ever visible. Chunks whose id
      // can't be found stay as the slimmed stub (content="") and the Source
      // Panel renders an empty code block as a graceful degradation.
      onRehydrateStorage: () => (state) => {
        if (!state?.sessions) return;
        for (const session of state.sessions) {
          session.messages = session.messages.map(fattenMessage);
        }
      },
      // No-op migrate placeholder — future schema changes (e.g. adding fields
      // to ChatSession) can bump `version` and transform old payloads here.
      // For now we return the persisted state unchanged so existing users
      // keep their session list across deploys. (The slim/fatten transform
      // is a serialization optimization, not a schema change — old payloads
      // with full chunks still fatten correctly via id lookup.)
      migrate: (persistedState) => persistedState,
      skipHydration: false,
    },
  ),
);
