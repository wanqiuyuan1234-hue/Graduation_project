"use client";

import { Boxes, Database, Github, MessageSquareText, Sparkles } from "lucide-react";
import { useNavStore } from "@/lib/rag/store";
import { useRepos } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";

const NAV = [
  { id: "modules", label: "模块浏览", icon: Boxes, desc: "代码模块卡片" },
  { id: "chat", label: "对话问答", icon: MessageSquareText, desc: "RAG 问答" },
  { id: "knowledge", label: "知识库", icon: Database, desc: "仓库与切片" },
] as const;

export function AppSidebar() {
  const view = useNavStore((s) => s.view);
  const go = useNavStore((s) => s.go);
  const openRepo = useNavStore((s) => s.openRepo);
  const activeRepoId = useNavStore((s) => s.activeRepoId);
  const { repos } = useRepos();

  return (
    <aside role="complementary" aria-label="主侧栏" className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="flex size-9 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-sm">
          <Sparkles className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-foreground">CodeRAG</div>
          <div className="text-[11px] text-muted-foreground">代码库问答系统</div>
        </div>
      </div>

      <nav aria-label="主导航" className="flex-1 px-3 py-4 space-y-1">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          导航
        </div>
        {NAV.map((item) => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-brand-soft text-brand-soft-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-accent-foreground")} />
              <span className="flex-1 text-left">{item.label}</span>
              {active && <span className="size-1.5 rounded-full bg-brand" />}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3 space-y-1">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          知识库
        </div>
        {repos.map((repo) => {
          const active = repo.id === activeRepoId;
          return (
            <button
              key={repo.id}
              onClick={() => openRepo(repo.id, "knowledge")}
              aria-label={`${repo.name} 仓库，状态 ${repo.status}，${repo.totalChunks} 切片`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
                active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <Github className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{repo.name}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <StatusBadge status={repo.status} />
                  <span className="text-[11px] text-muted-foreground">{repo.totalChunks} 切片</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
