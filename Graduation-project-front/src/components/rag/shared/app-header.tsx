"use client";

import { Database, Menu, Boxes, MessageSquareText, Github, Moon, Sparkles, Sun, Settings } from "lucide-react";
import { useNavStore } from "@/lib/rag/store";
import { useRepos } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { SettingsDialog } from "@/components/rag/shared/settings-dialog";
import {
  CommandPalette,
  CommandPaletteHint,
} from "@/components/rag/shared/command-palette";

const NAV = [
  { id: "modules", label: "模块浏览", icon: Boxes },
  { id: "chat", label: "对话问答", icon: MessageSquareText },
  { id: "knowledge", label: "知识库", icon: Database },
] as const;

const THEME_STORAGE_KEY = "coderag-theme";

export function AppHeader() {
  const view = useNavStore((s) => s.view);
  const go = useNavStore((s) => s.go);
  const openRepo = useNavStore((s) => s.openRepo);
  const activeRepoId = useNavStore((s) => s.activeRepoId);
  const theme = useNavStore((s) => s.theme);
  const toggleTheme = useNavStore((s) => s.toggleTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { repos } = useRepos();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  // Apply theme to <html> + persist to localStorage. The store initializes
  // synchronously from localStorage (see store.ts getInitialTheme), and the
  // inline blocking script in layout.tsx applies the class before paint, so
  // there's no FOUC and no clobbering race.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }, [theme]);

  return (
    <header role="banner" className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
      <button
        className="md:hidden inline-flex size-9 items-center justify-center rounded-lg hover:bg-accent"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="菜单"
        aria-expanded={menuOpen}
      >
        <Menu className="size-5" />
      </button>

      <div className="flex items-center gap-2 md:hidden">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <Sparkles className="size-4" />
        </div>
        <span className="text-sm font-semibold">CodeRAG</span>
      </div>

      <nav aria-label="主导航" className="hidden md:flex items-center gap-1">
        {NAV.map((item) => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-soft text-brand-soft-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {activeRepo && (
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
            <Github className="size-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">{activeRepo.name}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{activeRepo.totalChunks} 切片</span>
          </div>
        )}
        <CommandPaletteHint onOpen={() => setPaletteOpen(true)} />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
          className="size-9 text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="切换主题"
          aria-pressed={theme === "dark"}
          className="size-9 text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
          <div className="flex size-6 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Sparkles className="size-3.5" />
          </div>
          <span className="hidden sm:inline text-xs font-medium text-foreground">bge-m3</span>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => {
          setPaletteOpen(false);
          setSettingsOpen(true);
        }}
      />

      {menuOpen && (
        <div className="absolute left-0 right-0 top-16 z-40 border-b border-border bg-card p-3 shadow-lg md:hidden">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  go(item.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-accent"
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
          <div className="mt-2 border-t border-border pt-2">
            {repos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => {
                  openRepo(repo.id, "knowledge");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent"
              >
                <Github className="size-4 text-muted-foreground" />
                {repo.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
