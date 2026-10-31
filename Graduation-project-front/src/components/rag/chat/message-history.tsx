"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Clock, FileCode2, History } from "lucide-react";
import type { ChatMessage } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MessageHistoryProps {
  message: ChatMessage;
}

const SNIPPET_LEN = 80;

/** Maximum text length (per side) for which we run the word-level LCS diff.
 * Above this we fall back to plain `<pre>` rendering — the LCS DP table is
 * O(n·m) in both time and memory, and tokens come from `split(/(\s+)/)` so a
 * 2000-char text → ~300 words → 90k-cell table (~360KB Uint32Array). Doubling
 * that for both sides is fine, but cap to keep the Dialog snappy on huge
 * retry replies. */
const MAX_DIFF_CHARS = 2000;

/** Compress whitespace and trim to a short preview (~80 chars) for the
 * collapsed version card. Avoids multi-line code blocks blowing up the row
 * height while still giving the user enough context to pick a version. */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= SNIPPET_LEN) return clean;
  return clean.slice(0, SNIPPET_LEN) + "…";
}

/** Extract "HH:mm" from a "YYYY-MM-DD HH:mm:ss" timestamp string. Slicing
 * directly avoids `new Date()` re-parsing an already-local timestamp into a
 * potentially different timezone, matching the chat-page convention. */
function formatVersionTime(ts: string): string {
  if (!ts || ts.length < 16) return "";
  return ts.slice(11, 16);
}

type DiffSegment = { type: "same" | "add" | "del"; value: string };

/** Split `text` into word tokens, preserving whitespace as its own tokens so
 * the diff can highlight leading/trailing/inline whitespace changes (e.g.
 * paragraph breaks that were added/removed). Empty strings (from leading
 * matches of the split regex) are dropped. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Word-level LCS diff between two plain-text strings.
 *
 * Tokenises both inputs via `split(/(\s+)/)` (whitespace preserved as tokens),
 * builds an (m+1)×(n+1) Uint32Array LCS DP table, then backtracks to produce
 * ordered segments:
 *   - `same` — token present in both (unchanged)
 *   - `add`  — token only in `newText` (added in the new version)
 *   - `del`  — token only in `oldText` (removed from the new version)
 *
 * Consecutive same-type segments are merged to minimise DOM nodes. Whitespace
 * tokens are diffed like any other token — a paragraph break that exists only
 * in one version shows up as a colored gap, which is the desired visual.
 *
 * Caller must gate on length: if either text exceeds MAX_DIFF_CHARS, fall back
 * to plain rendering — this function does NOT cap its own input.
 */
function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  // LCS DP table. dp[i][j] = LCS length of a[0..i) and b[0..j).
  // Uint32Array rows keep memory tight (4 bytes/cell vs ~8 for number[]).
  const dp: Uint32Array[] = new Array(m + 1);
  for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prev = dp[i - 1];
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      row[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
  }

  // Backtrack from (m, n) to (0, 0), emitting segments in reverse, then flip.
  const rev: DiffSegment[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rev.push({ type: "same", value: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rev.push({ type: "add", value: b[j - 1] });
      j--;
    } else {
      rev.push({ type: "del", value: a[i - 1] });
      i--;
    }
  }
  rev.reverse();

  // Merge consecutive same-type segments to keep the rendered span count low.
  const merged: DiffSegment[] = [];
  for (const seg of rev) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.value += seg.value;
    else merged.push({ type: seg.type, value: seg.value });
  }
  return merged;
}

interface VersionRow {
  /** Short label shown in the per-version badge. Prior versions are "v1",
   * "v2", … (oldest first); the current top-level reply is "当前". */
  label: string;
  isCurrent: boolean;
  msg: ChatMessage;
}

/**
 * MessageHistory — collapsible version-history panel for an assistant reply.
 *
 * Renders nothing more than a muted "无历史版本" hint when `message.versions`
 * is empty/undefined. Otherwise shows a "历史版本 (N)" trigger (N = total
 * versions including the current reply) that expands into a scrollable list of
 * version cards. Each card shows a v1/v2/当前 badge, timestamp, token count,
 * retrieval latency, a 2-line content snippet, and a "查看完整" button that
 * opens a Dialog with a word-level diff against either the current reply or
 * the previous version (user-toggleable), plus the citation list + retrieval
 * metadata.
 *
 * The current (latest) version is rendered last and is brand-tinted to
 * distinguish it from prior retry snapshots.
 *
 * Self-contained: the only input is the `ChatMessage` it inspects.
 */
export function MessageHistory({ message }: MessageHistoryProps) {
  const [open, setOpen] = useState(false);
  const [dialogVersion, setDialogVersion] = useState<number | null>(null);
  // Diff target: "current" diffs the selected version against the latest reply;
  // "previous" diffs it against the prior version. Default "current" per spec.
  // Reset to "current" whenever the user opens a new version's Dialog so a
  // previous toggle choice doesn't leak across views.
  const [diffTarget, setDiffTarget] = useState<"current" | "previous">(
    "current",
  );

  const prior = message.versions ?? [];
  // Build the full version list: prior versions (oldest first) then the
  // current top-level reply. Index 0..prior.length-1 = prior retries;
  // index prior.length = current.
  const rows: VersionRow[] = [
    ...prior.map((m, i) => ({
      label: `v${i + 1}`,
      isCurrent: false,
      msg: m,
    })),
    { label: "当前", isCurrent: true, msg: message },
  ];

  if (prior.length === 0) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <History className="size-3" />
        <span>无历史版本</span>
      </div>
    );
  }

  const totalCount = rows.length;
  const dialogRow =
    dialogVersion === null ? null : (rows[dialogVersion] ?? null);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <History className="size-3" />
          <span>历史版本 ({totalCount})</span>
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 data-[state=open]:animate-fade-in">
        <ScrollArea className="max-h-96 pr-2 scrollbar-thin">
          <div className="space-y-2">
            {rows.map((row, idx) => {
              const latency = row.msg.retrieval?.latencyMs;
              const tokens = row.msg.tokens;
              const time = formatVersionTime(row.msg.timestamp);
              return (
                <div
                  key={`${row.msg.id ?? "ver"}-${idx}`}
                  className={cn(
                    "rounded-xl border p-2.5 text-xs shadow-card transition-colors",
                    row.isCurrent
                      ? "border-brand/30 bg-brand-soft/40"
                      : "border-border bg-muted/30",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-4 items-center rounded px-1.5 text-[10px] font-semibold",
                        row.isCurrent
                          ? "bg-brand text-brand-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.label}
                    </span>
                    {time && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                        <Clock className="size-2.5" />
                        {time}
                      </span>
                    )}
                    {typeof tokens === "number" && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {tokens} tok
                      </span>
                    )}
                    {typeof latency === "number" && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {latency} ms
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-foreground/80">
                    {snippet(row.msg.content) || "(空)"}
                  </p>
                  <div className="mt-1.5 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[10px] text-brand hover:text-brand"
                      onClick={() => {
                        // Reset diff target to the spec default whenever the
                        // user opens a fresh version's Dialog, so a stale
                        // toggle choice from a previous view doesn't leak.
                        setDiffTarget("current");
                        setDialogVersion(idx);
                      }}
                    >
                      <FileCode2 className="size-3" />
                      查看完整
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CollapsibleContent>

      <Dialog
        open={dialogVersion !== null}
        onOpenChange={(o) => !o && setDialogVersion(null)}
      >
        <DialogContent className="max-h-[80vh] gap-3 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="size-4 text-brand" />
              <DiffTitle
                dialogRow={dialogRow}
                rows={rows}
                diffTarget={diffTarget}
              />
            </DialogTitle>
            <DialogDescription className="text-xs">
              新增与删除内容高亮显示，可切换对比基准
            </DialogDescription>
          </DialogHeader>
          {dialogRow && (
            <DiffBody
              dialogRow={dialogRow}
              dialogVersion={dialogVersion ?? 0}
              rows={rows}
              message={message}
              diffTarget={diffTarget}
              setDiffTarget={setDiffTarget}
            />
          )}
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

/**
 * Compute the dynamic Dialog title based on which version is being viewed and
 * what it's diffed against:
 *   - viewing the current reply → must diff against previous (auto)
 *   - viewing v{N} vs current   → "版本对比 v{N} → 当前"
 *   - viewing v{N} vs previous   → "版本对比 v{N-1} → v{N}"
 *
 * The arrow always goes from older → newer so the diff direction matches the
 * visual (green = added in newer, red = removed from older).
 */
function DiffTitle({
  dialogRow,
  rows,
  diffTarget,
}: {
  dialogRow: VersionRow | null;
  rows: VersionRow[];
  diffTarget: "current" | "previous";
}) {
  if (!dialogRow) {
    return <span>版本对比</span>;
  }

  // When viewing the current reply, there's nothing to diff against itself —
  // we always show it against the most recent prior version.
  const effectiveTarget: "current" | "previous" = dialogRow.isCurrent
    ? "previous"
    : diffTarget;

  let oldLabel: string;
  let newLabel: string;

  if (dialogRow.isCurrent) {
    // Current vs the last prior version (most recent retry).
    const prevRow = rows[rows.length - 2];
    oldLabel = prevRow?.label ?? "v?";
    newLabel = dialogRow.label; // "当前"
  } else if (effectiveTarget === "current") {
    // Selected (prior) version vs current reply.
    oldLabel = dialogRow.label; // "v{N}"
    newLabel = "当前";
  } else {
    // Selected version vs the version immediately before it.
    // (Caller guarantees a previous exists; defensive fallback otherwise.)
    const idx = rows.findIndex((r) => r === dialogRow);
    const prevRow = idx > 0 ? rows[idx - 1] : null;
    oldLabel = prevRow?.label ?? "v?";
    newLabel = dialogRow.label; // "v{N}"
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>版本对比</span>
      <span className="inline-flex h-4 items-center rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
        {oldLabel}
      </span>
      <span className="text-[11px] text-muted-foreground">→</span>
      <span
        className={cn(
          "inline-flex h-4 items-center rounded px-1.5 text-[10px] font-semibold",
          newLabel === "当前"
            ? "bg-brand text-brand-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {newLabel}
      </span>
    </span>
  );
}

/**
 * Dialog body: legend + diff-target toggle + the diff itself (or plain content
 * for very long messages) + citations + retrieval metadata.
 *
 * Pure / derived-from-props: the diff segments are memoised on
 * (dialogRow, rows, diffTarget) so toggling the legend doesn't re-run LCS.
 */
function DiffBody({
  dialogRow,
  dialogVersion,
  rows,
  message,
  diffTarget,
  setDiffTarget,
}: {
  dialogRow: VersionRow;
  dialogVersion: number;
  rows: VersionRow[];
  message: ChatMessage;
  diffTarget: "current" | "previous";
  setDiffTarget: (t: "current" | "previous") => void;
}) {
  // Effective target — viewing current forces "previous" (no self-diff).
  const effectiveTarget: "current" | "previous" = dialogRow.isCurrent
    ? "previous"
    : diffTarget;

  // "对比上一版本" is only available when there's a version before the selected
  // one (i.e., the selected is v2+ or it's the current reply with prior > 0).
  const hasPrevious =
    (dialogRow.isCurrent && rows.length >= 2) ||
    (!dialogRow.isCurrent && dialogVersion > 0);

  // "对比当前版本" is only meaningful when the selected is NOT already current.
  const hasCurrent = !dialogRow.isCurrent;

  // Resolve oldText/newText/labels for the diff (older → newer).
  const { oldText, newText } = useMemo(() => {
    if (dialogRow.isCurrent) {
      const prevRow = rows[rows.length - 2];
      return {
        oldText: prevRow?.msg.content ?? "",
        newText: dialogRow.msg.content,
      };
    }
    if (effectiveTarget === "current") {
      return {
        oldText: dialogRow.msg.content,
        newText: message.content,
      };
    }
    const prevRow = dialogVersion > 0 ? rows[dialogVersion - 1] : null;
    return {
      oldText: prevRow?.msg.content ?? dialogRow.msg.content,
      newText: dialogRow.msg.content,
    };
  }, [dialogRow, rows, message, effectiveTarget, dialogVersion]);

  // Run the LCS diff unless either side is too long — then we fall back to
  // showing the selected version's full content as plain text.
  const tooLong =
    oldText.length > MAX_DIFF_CHARS || newText.length > MAX_DIFF_CHARS;
  const segments = useMemo(() => {
    if (tooLong) return null;
    return computeDiff(oldText, newText);
  }, [oldText, newText, tooLong]);

  return (
    <ScrollArea className="max-h-[60vh] pr-2 scrollbar-thin">
      <div className="space-y-3">
        {/* legend + diff-target toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-400 dark:bg-emerald-500/70" />
              新增
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-rose-400 dark:bg-rose-500/70" />
              删除
            </span>
          </div>
          <div
            role="group"
            aria-label="对比基准"
            className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
          >
            <Button
              type="button"
              variant={effectiveTarget === "current" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setDiffTarget("current")}
              disabled={!hasCurrent}
              aria-pressed={effectiveTarget === "current"}
              title={
                hasCurrent
                  ? "对比当前版本"
                  : "当前查看的就是最新版本，无法对比自身"
              }
            >
              对比当前
            </Button>
            <Button
              type="button"
              variant={effectiveTarget === "previous" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setDiffTarget("previous")}
              disabled={!hasPrevious}
              aria-pressed={effectiveTarget === "previous"}
              title={
                hasPrevious
                  ? "对比上一版本"
                  : "已是最早版本，无更早的历史可对比"
              }
            >
              对比上一版
            </Button>
          </div>
        </div>

        {/* diff content (or plain pre for too-long / non-diffable text) */}
        {segments ? (
          <div
            className={cn(
              "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md p-2",
              "bg-muted/40 text-[11px] leading-relaxed text-foreground/90",
              "scrollbar-thin",
            )}
          >
            {segments.length === 0 ? (
              <span className="text-muted-foreground">(空)</span>
            ) : (
              segments.map((seg, i) => {
                if (seg.type === "same") {
                  return <span key={i}>{seg.value}</span>;
                }
                if (seg.type === "add") {
                  return (
                    <span
                      key={i}
                      className="rounded-[2px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      {seg.value}
                    </span>
                  );
                }
                return (
                  <span
                    key={i}
                    className="rounded-[2px] bg-rose-100 text-rose-800 line-through dark:bg-rose-950/40 dark:text-rose-300"
                  >
                    {seg.value}
                  </span>
                );
              })
            )}
          </div>
        ) : (
          <pre
            className={cn(
              "max-h-64 overflow-auto whitespace-pre-wrap rounded-md p-2",
              "bg-muted/40 text-[11px] leading-relaxed text-foreground/90",
              "scrollbar-thin",
            )}
          >
            {dialogRow.msg.content || "(空)"}
          </pre>
        )}
        {tooLong && (
          <p className="text-[10px] text-muted-foreground">
            内容较长（&gt;{MAX_DIFF_CHARS} 字符），已切换为完整内容视图。
          </p>
        )}

        {dialogRow.msg.citations &&
          dialogRow.msg.citations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                引用来源 ({dialogRow.msg.citations.length})
              </div>
              <ul className="space-y-1">
                {dialogRow.msg.citations.map((c) => (
                  <li
                    key={c.chunk.id}
                    className="flex items-start gap-1.5 text-[11px] text-foreground/80"
                  >
                    <span className="mt-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded bg-brand-soft px-1 text-[10px] font-semibold text-brand-soft-foreground">
                      {c.index}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.chunk.filePath}:{c.chunk.startLine}-
                      {c.chunk.endLine}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        {dialogRow.msg.retrieval && (
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground tabular-nums">
            <span>tokens: {dialogRow.msg.tokens ?? "-"}</span>
            <span>
              latency: {dialogRow.msg.retrieval.latencyMs}ms
            </span>
            <span>topK: {dialogRow.msg.retrieval.topK}</span>
            <span>
              rerank: {dialogRow.msg.retrieval.reranked ? "on" : "off"}
            </span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
