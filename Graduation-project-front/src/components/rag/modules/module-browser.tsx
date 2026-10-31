"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Boxes, Filter, Layers, Search, SearchX, ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavStore } from "@/lib/rag/store";
import { MODULES, REPOS, getModulesByRepo } from "@/lib/rag/mock-data";
import type { Language, ModuleType } from "@/lib/rag/types";
import { LANGUAGE_META, MODULE_TYPE_META } from "@/components/rag/shared/meta";
import { ModuleGridSkeleton } from "@/components/rag/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModuleCard } from "./module-card";

const ALL_REPOS_VALUE = "__all__";

type SortKey = "updated" | "name" | "chunks" | "lines" | "complexity";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "最近更新" },
  { value: "name", label: "名称" },
  { value: "chunks", label: "切片数" },
  { value: "lines", label: "代码行数" },
  { value: "complexity", label: "复杂度" },
];

const COMPLEXITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const TYPE_ORDER: ModuleType[] = [
  "function",
  "class",
  "component",
  "hook",
  "service",
  "page",
  "util",
  "config",
];

export function ModuleBrowserPage() {
  const activeRepoId = useNavStore((s) => s.activeRepoId);
  const openRepo = useNavStore((s) => s.openRepo);

  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<Language | "all">("all");
  const [type, setType] = useState<ModuleType | "all">("all");
  const [sort, setSort] = useState<SortKey>("updated");

  // Local repo filter (allows "__all__" for cross-repo search). Kept local so
  // choosing "__all__" doesn't clobber the store's activeRepoId, but we still
  // sync from the store when activeRepoId changes externally (sidebar / header
  // / chat panel). Render-time comparison pattern avoids setState-in-effect.
  const [repoFilter, setRepoFilter] = useState<string>(activeRepoId);
  const [lastActiveRepo, setLastActiveRepo] = useState<string>(activeRepoId);
  if (activeRepoId !== lastActiveRepo) {
    setLastActiveRepo(activeRepoId);
    setRepoFilter(activeRepoId);
  }

  // Brief loading skeleton on mount and whenever the repo selection changes.
  // Flip loading → true via render-time comparison (sync setState in effect
  // body would trip react-hooks/set-state-in-effect), then schedule the
  // flip → false inside a setTimeout callback (async, allowed by the rule).
  const [loading, setLoading] = useState(true);
  const [lastLoadingRepo, setLastLoadingRepo] = useState<string>(repoFilter);
  if (repoFilter !== lastLoadingRepo) {
    setLastLoadingRepo(repoFilter);
    setLoading(true);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 400);
    return () => window.clearTimeout(timer);
  }, [repoFilter]);

  const isAllRepos = repoFilter === ALL_REPOS_VALUE;

  const candidateModules = useMemo(
    () => (isAllRepos ? MODULES : getModulesByRepo(repoFilter)),
    [isAllRepos, repoFilter],
  );

  const languages = useMemo(() => {
    const set = new Set<Language>();
    candidateModules.forEach((m) => set.add(m.language));
    return Array.from(set);
  }, [candidateModules]);

  const types = useMemo(() => {
    const set = new Set<ModuleType>();
    candidateModules.forEach((m) => set.add(m.type));
    return TYPE_ORDER.filter((t) => set.has(t));
  }, [candidateModules]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = candidateModules.filter((m) => {
      if (language !== "all" && m.language !== language) return false;
      if (type !== "all" && m.type !== type) return false;
      if (q) {
        const hay = `${m.name} ${m.filePath} ${m.summary} ${m.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorted = [...matched];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "chunks":
          return b.chunkCount - a.chunkCount;
        case "lines":
          return b.lineCount - a.lineCount;
        case "complexity":
          return (
            (COMPLEXITY_RANK[a.complexity] ?? 2) - (COMPLEXITY_RANK[b.complexity] ?? 2)
          );
        case "updated":
        default:
          // Descending by updatedAt (string compare works for "YYYY-MM-DD HH:mm")
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });
    return sorted;
  }, [candidateModules, search, language, type, sort]);

  const totalChunks = filtered.reduce((acc, m) => acc + m.chunkCount, 0);

  function resetFilters() {
    setSearch("");
    setLanguage("all");
    setType("all");
  }

  function handleRepoChange(id: string) {
    setRepoFilter(id);
    if (id !== ALL_REPOS_VALUE) {
      openRepo(id, "modules");
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-6">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="size-5 text-brand" />
            <h1 className="text-xl font-semibold text-foreground">模块浏览</h1>
            <motion.span
              key={filtered.length}
              initial={{ scale: 0.85, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand-soft-foreground"
              aria-live="polite"
            >
              {filtered.length}
            </motion.span>
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isAllRepos
              ? `跨仓库 · ${MODULES.length} 模块 · ${REPOS.length} 仓库`
              : `当前仓库共 ${candidateModules.length} 个模块 · ${languages.length} 种语言`}
          </p>
        </div>
        <Select value={repoFilter} onValueChange={handleRepoChange}>
          <SelectTrigger aria-label="仓库筛选" className="h-9 w-[220px]">
            <SelectValue placeholder="选择仓库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_REPOS_VALUE}>
              <Layers className="size-3.5" />
              全部仓库
            </SelectItem>
            {REPOS.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sticky filters */}
      <div className="sticky top-0 z-10 space-y-3 border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模块名、路径或摘要..."
            aria-label="搜索模块"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-3.5 text-muted-foreground" />
          <Pill active={language === "all"} onClick={() => setLanguage("all")}>
            全部语言
          </Pill>
          {languages.map((l) => (
            <Pill key={l} active={language === l} onClick={() => setLanguage(l)}>
              {LANGUAGE_META[l].label}
            </Pill>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <ArrowDownUp className="size-3.5 text-muted-foreground" />
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger aria-label="排序方式" className="h-8 w-[130px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={type === "all"} onClick={() => setType("all")}>
            全部类型
          </Pill>
          {types.map((t) => (
            <Pill key={t} active={type === t} onClick={() => setType(t)}>
              {MODULE_TYPE_META[t].label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Grid (scrollable) */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <ModuleGridSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState onReset={resetFilters} hasFilters={search !== "" || language !== "all" || type !== "all"} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m, index) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}
              >
                <ModuleCard module={m} showRepo={isAllRepos} />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Footer summary */}
      <div className="border-t border-border bg-background/80 px-6 py-2 text-center text-[12px] text-muted-foreground backdrop-blur">
        共 {filtered.length} 个模块 · {totalChunks} 个切片
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        active
          ? "bg-brand text-brand-foreground"
          : "border border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  onReset,
  hasFilters,
}: {
  onReset: () => void;
  hasFilters: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-brand-soft/60">
        <SearchX className="size-8 text-brand" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">未找到匹配的模块</p>
        <p className="text-[13px] text-muted-foreground">
          {hasFilters ? "尝试调整筛选条件或清空筛选" : "当前仓库暂无可浏览的模块"}
        </p>
      </div>
      {hasFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="gap-1.5 border-brand/30 text-brand hover:bg-brand-soft hover:text-brand-soft-foreground"
        >
          清空筛选
        </Button>
      )}
    </div>
  );
}
