"use client";

import { useCallback, useEffect } from "react";
import {
  Boxes,
  Database,
  FileCode2,
  Github,
  Keyboard,
  MessageSquareText,
  Moon,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { useNavStore } from "@/lib/rag/store";
import { MODULES, REPOS } from "@/lib/rag/mock-data";
import { SHORTCUTS_TOGGLE_EVENT } from "@/hooks/use-keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/lib/rag/types";

/**
 * Global command palette — FastGPT-style Cmd+K quick switcher.
 *
 * Open: Ctrl+K (Windows/Linux) or Cmd+K (macOS). The keydown listener is
 * registered locally in this component (not in `use-keyboard-shortcuts`)
 * so the rest of the shortcut suite stays untouched. The listener works
 * even when focus is inside an input — Ctrl+K is a chord, not a single
 * key, so it can't accidentally collide with typing.
 *
 * Layout (cmdk filters across all groups simultaneously):
 *  - 导航: jump to modules / chat / knowledge view (calls `go(view)`)
 *  - 模块: list of all MODULES, searchable by name or file path. Capped at
 *    8 visible results to keep the palette scannable; cmdk re-filters as the
 *    user types so deeper matches surface on demand. Selecting one calls
 *    `openModule(module.id)`.
 *  - 仓库: list of REPOS. Selecting calls `openRepo(repo.id, "knowledge")`.
 *  - 会话: list of CHAT_SESSIONS from the persisted store. Selecting calls
 *    `setActiveSession(id)` + `go("chat")`.
 *  - 操作: toggle theme / open settings (via `onOpenSettings` callback) /
 *    show keyboard shortcuts (dispatches SHORTCUTS_TOGGLE_EVENT).
 *
 * On select: the palette closes (`onOpenChange(false)`) before the action
 * fires so navigation doesn't fight the dialog's unmount transition. A
 * short toast confirms what was opened (helpful when the target view is
 * below the fold).
 */

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof Boxes }[] = [
  { id: "modules", label: "模块浏览", icon: Boxes },
  { id: "chat", label: "对话问答", icon: MessageSquareText },
  { id: "knowledge", label: "知识库", icon: Database },
];

const MAX_MODULE_RESULTS = 8;

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}) {
  const go = useNavStore((s) => s.go);
  const openModule = useNavStore((s) => s.openModule);
  const openRepo = useNavStore((s) => s.openRepo);
  const sessions = useNavStore((s) => s.sessions);
  const setActiveSession = useNavStore((s) => s.setActiveSession);
  const toggleTheme = useNavStore((s) => s.toggleTheme);

  // Cmd+K / Ctrl+K → open the palette. preventDefault stops the browser's
  // default "focus search bar" / "Cmd+K bookmark" handling so our palette
  // is the only consumer. The listener is gated on `open` so it doesn't
  // double-fire while the palette is already open (Esc / outside-click
  // close it instead).
  useEffect(() => {
    if (open) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenChange(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Close + run a side-effect. Centralized so every item's onSelect shares
  // the same close-first ordering, avoiding race conditions where the
  // underlying view swap happens mid-transition and causes a focus jump.
  const closeAndRun = useCallback(
    (fn: () => void) => {
      onOpenChange(false);
      // Defer to the next tick so Radix can start its unmount transition
      // before the store mutation triggers a re-render of the new view.
      // requestAnimationFrame is more reliable than setTimeout(0) for
      // ordering DOM writes after the dialog close.
      requestAnimationFrame(() => fn());
    },
    [onOpenChange],
  );

  const handleNav = useCallback(
    (view: ViewId, label: string) => {
      closeAndRun(() => {
        go(view);
        toast.success(`已切换到「${label}」`);
      });
    },
    [closeAndRun, go],
  );

  const handleOpenModule = useCallback(
    (moduleId: string, name: string) => {
      closeAndRun(() => {
        openModule(moduleId);
        toast.success(`已打开模块：${name}`);
      });
    },
    [closeAndRun, openModule],
  );

  const handleOpenRepo = useCallback(
    (repoId: string, name: string) => {
      closeAndRun(() => {
        openRepo(repoId, "knowledge");
        toast.success(`已切换仓库：${name}`);
      });
    },
    [closeAndRun, openRepo],
  );

  const handleOpenSession = useCallback(
    (sessionId: string, title: string) => {
      closeAndRun(() => {
        setActiveSession(sessionId);
        go("chat");
        toast.success(`已打开会话：${title}`);
      });
    },
    [closeAndRun, go, setActiveSession],
  );

  const handleToggleTheme = useCallback(() => {
    closeAndRun(() => toggleTheme());
  }, [closeAndRun, toggleTheme]);

  const handleOpenSettings = useCallback(() => {
    closeAndRun(() => onOpenSettings());
  }, [closeAndRun, onOpenSettings]);

  const handleShowShortcuts = useCallback(() => {
    closeAndRun(() => {
      window.dispatchEvent(new CustomEvent(SHORTCUTS_TOGGLE_EVENT));
    });
  }, [closeAndRun]);

  // Limit module results to MAX_MODULE_RESULTS. cmdk filters further based
  // on the live search input, so capping the initial list keeps the palette
  // scannable without hiding matches — typing narrows the 8 down to the
  // few that actually matter.
  const moduleResults = MODULES.slice(0, MAX_MODULE_RESULTS);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="命令面板"
      description="搜索模块、仓库、会话或操作"
      className="sm:max-w-xl"
    >
      <CommandInput placeholder="搜索模块、仓库、会话或操作…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>未找到匹配项。</CommandEmpty>

        {/* 导航 */}
        <CommandGroup heading="导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.id}
                value={`导航 ${item.label} view nav`}
                onSelect={() => handleNav(item.id, item.label)}
              >
                <Icon className="size-4 text-brand" />
                <span className="flex-1">{item.label}</span>
                <CommandShortcut>⏎</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* 模块 */}
        <CommandGroup heading="模块">
          {moduleResults.map((mod) => {
            // value drives cmdk's fuzzy filter — include name + filePath so
            // searching by path (e.g. "use-debounce") or by display name
            // (e.g. "useDebounce") both surface the same module.
            const searchValue = `${mod.name} ${mod.filePath} ${mod.summary}`;
            return (
              <CommandItem
                key={mod.id}
                value={searchValue}
                onSelect={() => handleOpenModule(mod.id, mod.name)}
              >
                <FileCode2 className="size-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {mod.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {mod.filePath}
                  </span>
                </div>
                <CommandShortcut>⏎</CommandShortcut>
              </CommandItem>
            );
          })}
          {MODULES.length > MAX_MODULE_RESULTS && (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              仅显示前 {MAX_MODULE_RESULTS} 个模块，输入关键词以缩小范围…
            </p>
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* 仓库 */}
        <CommandGroup heading="仓库">
          {REPOS.map((repo) => (
            <CommandItem
              key={repo.id}
              value={`${repo.name} 仓库 repo ${repo.description}`}
              onSelect={() => handleOpenRepo(repo.id, repo.name)}
            >
              <Github className="size-4 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {repo.name}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {repo.description}
                </span>
              </div>
              <CommandShortcut>⏎</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* 会话 */}
        <CommandGroup heading="会话">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              暂无会话。在对话页面新建一个会话即可。
            </p>
          ) : (
            sessions.map((sess) => (
              <CommandItem
                key={sess.id}
                value={`${sess.title} 会话 session ${sess.id}`}
                onSelect={() => handleOpenSession(sess.id, sess.title)}
              >
                <MessageSquareText className="size-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {sess.title}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {sess.messages.length} 条消息 · {sess.createdAt}
                  </span>
                </div>
                <CommandShortcut>⏎</CommandShortcut>
              </CommandItem>
            ))
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* 操作 */}
        <CommandGroup heading="操作">
          <CommandItem
            value="切换主题 theme toggle 切换明暗"
            onSelect={handleToggleTheme}
          >
            <Sun className="size-4 text-amber-500" />
            <span className="flex-1">切换主题</span>
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
                "bg-muted text-muted-foreground",
              )}
            >
              <Moon className="size-3" />
              <span>t</span>
            </span>
          </CommandItem>
          <CommandItem
            value="打开设置 settings preferences 设置"
            onSelect={handleOpenSettings}
          >
            <Settings className="size-4 text-muted-foreground" />
            <span className="flex-1">打开设置</span>
            <CommandShortcut>⏎</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="显示快捷键 shortcuts help keyboard 快捷键"
            onSelect={handleShowShortcuts}
          >
            <Keyboard className="size-4 text-muted-foreground" />
            <span className="flex-1">显示快捷键</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Footer hint row — tells the user how the palette is filtered and
          that Esc closes it. Hidden on small screens to save vertical
          space; the input already implies searchability. */}
      <div className="hidden items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground sm:flex">
        <span className="inline-flex items-center gap-1">
          <Search className="size-3" />
          输入关键词以筛选所有分组
        </span>
        <span>
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">
            Esc
          </kbd>{" "}
          关闭
        </span>
      </div>
    </CommandDialog>
  );
}

/**
 * Small "⌘K" hint badge for the app header. Clicking it opens the palette
 * via the parent's `onOpen` callback. Renders as a ghost pill so it reads
 * as a keyboard hint rather than a primary action. Hidden on `xs` screens
 * to avoid crowding the header on mobile (mobile users tap the search
 * affordance inside each view instead).
 */
export function CommandPaletteHint({
  onOpen,
}: {
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onOpen}
      aria-label="打开命令面板 (Ctrl+K)"
      className={cn(
        "hidden h-7 gap-1.5 px-2 text-[11px] text-muted-foreground sm:inline-flex",
        "hover:bg-brand-soft hover:text-brand-soft-foreground",
      )}
    >
      <Search className="size-3" />
      <span>搜索</span>
      <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] text-foreground">
        ⌘K
      </kbd>
    </Button>
  );
}
