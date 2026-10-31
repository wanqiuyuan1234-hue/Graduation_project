"use client";

import { useEffect, useRef } from "react";
import { useNavStore } from "@/lib/rag/store";

/** Window (ms) in which the second key of a `g` + key sequence must arrive. */
const G_SEQUENCE_TIMEOUT = 600;

/** Custom event dispatched by the `?` shortcut to toggle the help dialog. */
export const SHORTCUTS_TOGGLE_EVENT = "coderag:toggle-shortcuts";

/**
 * Returns true if the event target is an editable form control or a
 * `contenteditable` region. Keyboard shortcuts that would interfere with
 * typing (e.g. `g`, `/`, `t`, `?`) are suppressed when this returns true.
 * `Escape` is intentionally NOT suppressed — it must close overlays even when
 * focus is inside an input.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Focus the first visible search/filter input on the page. Each view renders
 * a different search input (module-browser / session-sidebar / KB file-tree),
 * so we match by `aria-label` or `placeholder` containing 搜索/过滤. Returns
 * true if a target was found and focused.
 *
 * `HTMLInputElement.select()` is called after focus so the user can immediately
 * type to replace any previous query — standard search-bar behavior.
 */
function focusSearchInput(): boolean {
  const selectors = [
    'input[aria-label*="搜索"]',
    'input[aria-label*="过滤"]',
    'input[placeholder*="搜索"]',
    'input[placeholder*="过滤"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el && el.offsetParent !== null) {
      el.focus();
      try {
        el.select();
      } catch {
        // select() can throw on some input types (e.g. email); ignore.
      }
      return true;
    }
  }
  return false;
}

/**
 * Register global keyboard shortcuts for the CodeRAG app shell. Call exactly
 * once at the page root (see `src/app/page.tsx`).
 *
 * Shortcuts (suppressed while typing in inputs/textareas/selects/contenteditable):
 *  - `/`        focus the page's search/filter input
 *  - `g` `m`    navigate to 模块浏览
 *  - `g` `c`    navigate to 对话问答
 *  - `g` `k`    navigate to 知识库
 *  - `t`        toggle light/dark theme
 *  - `?`        toggle the keyboard-shortcuts help dialog
 *  - `Escape`   close the source panel if open (otherwise let Radix handle
 *               Dialog/Sheet dismissal)
 *
 * The `g` + key sequence uses a 600ms window. If the second key is not
 * `m`/`c`/`k`, the sequence is cancelled and the second key is processed as a
 * normal single-key shortcut (Vim convention) — so `g t` cancels then toggles
 * theme, `g /` cancels then focuses search.
 *
 * State is read via `useNavStore.getState()` inside the handler so the listener
 * can be attached once (empty deps) without going stale, and without causing
 * re-renders on every store change.
 */
export function useKeyboardShortcuts() {
  const gPressedAtRef = useRef<number>(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape must work even inside inputs (to close the source panel that
      // contains the focused close button / citation cards).
      if (e.key === "Escape") {
        const st = useNavStore.getState();
        if (st.sourcePanelOpen) {
          e.preventDefault();
          st.setSourcePanelOpen(false);
        }
        // If the source panel isn't open, let Radix Dialog/Sheet handle Esc.
        return;
      }

      // Suppress single-key shortcuts while typing, and when the user is
      // chord-ing with browser modifiers (Cmd+T = new tab, etc.).
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Normalize single characters to lowercase so CapsLock / Shift don't
      // break the `g` sequence. Multi-char keys (Escape, Tab, ArrowUp…) keep
      // their canonical form. Symbols (`/`, `?`) are unaffected by toLowerCase.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const now = Date.now();
      const st = useNavStore.getState();

      // `g` starts (or restarts) a sequence window.
      if (k === "g") {
        gPressedAtRef.current = now;
        return;
      }

      // If we're inside a `g` + key window, try to complete the sequence.
      if (gPressedAtRef.current && now - gPressedAtRef.current < G_SEQUENCE_TIMEOUT) {
        if (k === "m") {
          e.preventDefault();
          st.go("modules");
          gPressedAtRef.current = 0;
          return;
        }
        if (k === "c") {
          e.preventDefault();
          st.go("chat");
          gPressedAtRef.current = 0;
          return;
        }
        if (k === "k") {
          e.preventDefault();
          st.go("knowledge");
          gPressedAtRef.current = 0;
          return;
        }
        // Second key didn't match — cancel the sequence and fall through so
        // the key is processed as a normal single-key shortcut (Vim style).
        gPressedAtRef.current = 0;
      }

      // Single-key shortcuts.
      if (k === "/") {
        e.preventDefault();
        focusSearchInput();
        return;
      }
      if (k === "t") {
        e.preventDefault();
        st.toggleTheme();
        return;
      }
      if (k === "?") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUTS_TOGGLE_EVENT));
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
