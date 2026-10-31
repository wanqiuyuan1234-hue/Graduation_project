"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { ChatMessage } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface MessageEditorProps {
  /** The user message being edited. Only `content` is read; the parent decides
   * how to persist the edit (typically via store `updateMessage` /
   * `replaceMessage` + a re-send of the downstream assistant reply). */
  message: ChatMessage;
  /** Called with the trimmed new content when the user saves (Enter or Save
   * button). The parent is responsible for diffing against the original
   * content if it wants to skip no-op edits — this component will only call
   * `onSave` when the trimmed value differs from the original. */
  onSave: (newContent: string) => void;
  /** Called when the user cancels (Escape key or Cancel button). */
  onCancel: () => void;
}

/**
 * MessageEditor — inline editor for a user chat message.
 *
 * Renders a Textarea pre-filled with `message.content`, plus Save / Cancel
 * buttons. Enter (without Shift/Meta/Ctrl/Alt) saves; Escape cancels. Both
 * shortcuts are bound via a single document-level capture-phase keydown
 * listener so they work even when focus has drifted to one of the action
 * buttons (the listener checks `containerRef.contains(activeElement)` before
 * intercepting Enter; Escape always cancels regardless of focus).
 *
 * Styling: rounded-2xl brand-tinted border + card surface + soft shadow so it
 * reads as an elevated inline surface on top of the user bubble. Textarea is
 * border-0 / shadow-none so it blends into the card padding.
 *
 * Intended to be rendered in place of the user bubble content when the user
 * clicks an "编辑" affordance (wiring deferred to a later round — see worklog
 * N2). Self-contained: only the message + two callbacks.
 */
export function MessageEditor({
  message,
  onSave,
  onCancel,
}: MessageEditorProps) {
  const [value, setValue] = useState(message.content);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea on mount and place the caret at the end so the
  // user can immediately continue typing. focus() + setSelectionRange are DOM
  // mutations, not setState, so this is safe under the
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    try {
      ta.setSelectionRange(len, len);
    } catch {
      // Some input types throw on setSelectionRange — safe to ignore.
    }
  }, []);

  // Document-level capture-phase keydown handler. Capture so we intercept
  // before the textarea's default Enter→newline behavior, and so Escape works
  // even when focus has moved to a sibling button. The effect re-subscribes
  // when any of the inputs change (cheap; happens on every keystroke for
  // `value`, but that's fine for a single editor instance — avoids the
  // "update ref during render" lint violation that the latest-value-ref
  // pattern would trigger).
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const container = containerRef.current;
      if (!container) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Enter") return;
      // Allow Shift+Enter / Meta+Enter / Ctrl+Enter / Alt+Enter to insert a
      // newline (or whatever the platform default is) — only a bare Enter
      // triggers save.
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (!container.contains(active)) return;
      e.preventDefault();
      e.stopPropagation();
      const trimmed = value.trim();
      const original = message.content.trim();
      // Only fire onSave when the content actually changed — avoids a no-op
      // edit triggering a wasteful re-send of the assistant reply.
      if (trimmed && trimmed !== original) {
        onSave(trimmed);
      }
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onCancel, onSave, value, message.content]);

  const trimmedValue = value.trim();
  const canSave =
    trimmedValue.length > 0 && trimmedValue !== message.content.trim();

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-brand/30 bg-card p-2 shadow-card"
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn(
          "min-h-[4rem] resize-none border-0 bg-transparent p-1 text-sm shadow-none",
          "focus-visible:ring-0 focus-visible:border-0",
        )}
        placeholder="编辑消息内容…"
        aria-label="编辑消息内容"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          Enter 保存 · Shift+Enter 换行 · Esc 取消
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onCancel}
            aria-label="取消编辑"
          >
            <X className="size-3.5" />
            取消
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              const trimmed = value.trim();
              if (canSave) onSave(trimmed);
            }}
            disabled={!canSave}
            aria-label="保存修改"
          >
            <Check className="size-3.5" />
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
