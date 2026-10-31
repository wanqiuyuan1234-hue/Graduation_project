"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Github,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getRepoById } from "@/lib/rag/mock-data";
import { useNavStore } from "@/lib/rag/store";
import type { ChatSession } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface SessionSidebarProps {
  className?: string;
  /** Optional callback fired after the active session changes (e.g. to close a mobile sheet). */
  onSessionChange?: () => void;
}

function formatLastPreview(content: string): string {
  if (!content) return "";
  const text = content.replace(/[#*`>\-_~\n\r]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 18);
}

// Build a ~30-char window around the first case-insensitive match of `q`
// inside `content` (after stripping markdown noise). Returns null when `q`
// is not found. The returned snippet is guaranteed to contain `q` so the
// HighlightText helper can re-locate and wrap it.
function buildSnippet(content: string, q: string): string | null {
  const cleaned = content
    .replace(/[#*`>\-_~\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const idx = cleaned.toLowerCase().indexOf(q);
  if (idx < 0) return null;
  const window = 30;
  const half = Math.floor(window / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(cleaned.length, idx + q.length + half);
  // Expand to use the full window when only one side is clipped.
  if (end - start < Math.min(window, cleaned.length)) {
    if (start === 0) {
      end = Math.min(cleaned.length, start + window);
    } else if (end === cleaned.length) {
      start = Math.max(0, end - window);
    }
  }
  const prefix = start > 0 ? "\u2026" : "";
  const suffix = end < cleaned.length ? "\u2026" : "";
  return prefix + cleaned.slice(start, end) + suffix;
}

// Case-insensitive highlight of the first occurrence of `q` inside `text`.
// Preserves the original text's case in the rendered <mark>.
function HighlightText({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-brand-soft px-0.5 text-brand-soft-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function SessionSidebar({
  className,
  onSessionChange,
}: SessionSidebarProps) {
  const sessions = useNavStore((s) => s.sessions);
  const activeSessionId = useNavStore((s) => s.activeSessionId);
  const createSession = useNavStore((s) => s.createSession);
  const deleteSession = useNavStore((s) => s.deleteSession);
  const renameSession = useNavStore((s) => s.renameSession);
  const setActiveSession = useNavStore((s) => s.setActiveSession);

  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const q = query.trim().toLowerCase();

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [sessions],
  );

  const filtered = useMemo<
    Array<{ session: ChatSession; snippet: string | null }>
  >(() => {
    if (!q) {
      return sortedSessions.map((session) => ({ session, snippet: null }));
    }
    const out: Array<{ session: ChatSession; snippet: string | null }> = [];
    for (const session of sortedSessions) {
      const titleHit = session.title.toLowerCase().includes(q);
      // Only build a message snippet when the title itself does NOT match —
      // per spec, the snippet row replaces the default preview only for
      // message-content matches (not title matches).
      let snippet: string | null = null;
      if (!titleHit) {
        for (const m of session.messages) {
          const s = buildSnippet(m.content, q);
          if (s) {
            snippet = s;
            break;
          }
        }
      }
      if (titleHit || snippet !== null) {
        out.push({ session, snippet });
      }
    }
    return out;
  }, [sortedSessions, q]);

  function handleCreate() {
    createSession();
    toast.success("已创建新对话");
    onSessionChange?.();
  }

  function handleDelete(id: string) {
    deleteSession(id);
    toast.success("已删除会话");
  }

  function handleSelect(id: string) {
    setActiveSession(id);
    onSessionChange?.();
  }

  function startRename(id: string, currentTitle: string) {
    setEditingId(id);
    setDraftTitle(currentTitle);
  }

  function commitRename(id: string) {
    const next = draftTitle.trim();
    if (next) {
      renameSession(id, next);
    }
    setEditingId(null);
    setDraftTitle("");
  }

  function cancelRename() {
    setEditingId(null);
    setDraftTitle("");
  }

  return (
    <div
      className={cn(
        "hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex",
        className,
      )}
    >
      {/* header */}
      <div className="flex h-16 items-center gap-2 border-b border-border px-4">
        <MessageSquareText className="size-4 shrink-0 text-brand" />
        <h2 className="text-[14px] font-semibold">会话</h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground transition-transform duration-200 hover:scale-105 hover:bg-accent hover:text-foreground"
          onClick={handleCreate}
          aria-label="新建会话"
          title="新建会话"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* search */}
      <div className="px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话标题或内容"
            className="h-8 rounded-md border-border bg-card pl-7 text-[12px] shadow-none focus-visible:ring-1 focus-visible:ring-brand/40"
            aria-label="搜索会话标题或内容"
          />
        </div>
      </div>

      {/* list */}
      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Search className="size-5 opacity-40" />
            <p className="text-[12px]">未匹配到会话</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map(({ session, snippet }) => {
              const isActive = session.id === activeSessionId;
              const repo = getRepoById(session.repoId);
              const lastMsg = session.messages[session.messages.length - 1];
              const preview = lastMsg ? formatLastPreview(lastMsg.content) : "";
              const isEditing = editingId === session.id;

              return (
                <motion.div
                  key={session.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "group relative w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-all duration-200 ease-out",
                    isActive
                      ? "bg-brand-soft text-brand-soft-foreground ring-1 ring-brand/20"
                      : "hover:bg-accent hover:translate-x-0.5",
                  )}
                >
                  {/* active left accent bar — animates in (scaleY 0→1) when
                      the row becomes active; origin-top keeps the bar anchored
                      at the top of the row for a natural downward reveal. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-2 bottom-2 w-0.5 origin-top rounded-full bg-brand transition-transform duration-200 ease-out",
                      isActive ? "scale-y-100" : "scale-y-0",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => !isEditing && handleSelect(session.id)}
                    className="block w-full text-left"
                    aria-current={isActive ? "true" : undefined}
                  >
                    {isEditing ? (
                      <Input
                        value={draftTitle}
                        autoFocus
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(session.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        onBlur={() => commitRename(session.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 rounded-md border-border bg-card text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-brand/40"
                      />
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">
                          <HighlightText text={session.title} q={q} />
                        </p>
                        {snippet !== null ? (
                          <>
                            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                              <HighlightText text={snippet} q={q} />
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                              {repo && (
                                <span className="inline-flex min-w-0 items-center gap-0.5">
                                  <Github className="size-3 shrink-0" />
                                  <span className="truncate">{repo.name}</span>
                                </span>
                              )}
                              <span aria-hidden>·</span>
                              <span className="shrink-0 tabular-nums">
                                {session.messages.length} 条
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {repo && (
                              <span className="inline-flex min-w-0 items-center gap-0.5">
                                <Github className="size-3 shrink-0" />
                                <span className="truncate">{repo.name}</span>
                              </span>
                            )}
                            <span aria-hidden>·</span>
                            <span className="shrink-0 tabular-nums">
                              {session.messages.length} 条
                            </span>
                            {preview && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="truncate">{preview}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>

                  {!isEditing && (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:bg-card hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(session.id, session.title);
                        }}
                        aria-label="重命名会话"
                        title="重命名"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:bg-card hover:text-rose-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(session.id);
                        }}
                        aria-label="删除会话"
                        title="删除"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        共 <span className="tabular-nums font-medium text-foreground">{sessions.length}</span> 个会话
      </div>
    </div>
  );
}
