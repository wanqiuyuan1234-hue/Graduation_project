"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SHORTCUTS_TOGGLE_EVENT } from "@/hooks/use-keyboard-shortcuts";

interface ShortcutRow {
  /** One or more keys; multi-key sequences render as `g` then `m`. */
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  group: string;
  rows: ShortcutRow[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    group: "导航",
    rows: [
      { keys: ["g", "m"], description: "模块浏览" },
      { keys: ["g", "c"], description: "对话问答" },
      { keys: ["g", "k"], description: "知识库" },
    ],
  },
  {
    group: "操作",
    rows: [
      { keys: ["/"], description: "聚焦搜索框" },
      { keys: ["t"], description: "切换明暗主题" },
      { keys: ["Esc"], description: "关闭来源面板 / 弹窗" },
      { keys: ["?"], description: "显示本快捷键帮助" },
    ],
  },
];

/**
 * Small inline keyboard-key badge. Uses muted bg + border so it reads as a
 * physical key cap without competing with brand accents.
 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

/**
 * Keyboard-shortcuts help dialog. Renders its own trigger (a ghost Keyboard
 * icon button) so it can be dropped into the footer without the parent
 * needing to manage open state.
 *
 * The dialog ALSO opens in response to the `?` global shortcut, which
 * dispatches the `coderag:toggle-shortcuts` custom event (see
 * `useKeyboardShortcuts`). This decouples the shortcut handler from the
 * dialog component — no shared store or context needed.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onToggle() {
      setOpen((v) => !v);
    }
    window.addEventListener(SHORTCUTS_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(SHORTCUTS_TOGGLE_EVENT, onToggle);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground hover:bg-brand-soft hover:text-brand-soft-foreground"
          aria-label="键盘快捷键"
        >
          <Keyboard className="size-3.5" />
          <span className="hidden sm:inline">快捷键</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4 text-brand" />
            键盘快捷键
          </DialogTitle>
          <DialogDescription>
            在非输入框状态下按下对应按键即可触发。导航类快捷键需在 600
            毫秒内连续按下两个键。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-1">
          {SHORTCUTS.map((group) => (
            <section key={group.group}>
              <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.group}
              </h3>
              <dl className="space-y-2">
                {group.rows.map((row) => (
                  <div
                    key={row.description}
                    className="flex items-center justify-between gap-3"
                  >
                    <dt className="text-sm text-foreground">{row.description}</dt>
                    <dd className="flex items-center gap-1">
                      {row.keys.map((key, i) => (
                        <span key={key} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              then
                            </span>
                          )}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
