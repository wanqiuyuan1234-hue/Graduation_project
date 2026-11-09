"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Cpu,
  Database,
  Download,
  Folder,
  GitBranch,
  Github,
  Hash,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SLICE_STRATEGIES } from "@/lib/rag/mock-data";
import { useFileChunks, useFileTree, useRepos } from "@/lib/api/hooks";
import type {
  FileTreeNode,
  Repo,
  SliceStrategy,
} from "@/lib/rag/types";
import { useNavStore } from "@/lib/rag/store";
import { StatusBadge } from "@/components/rag/shared/badges";
import { KnowledgeStatSkeleton } from "@/components/rag/shared/skeletons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FileTree, collectDirPaths } from "./file-tree";

type StrategyOption = NonNullable<SliceStrategy["options"]>[number];

// 后端 strategies 为 ast / fixed，这里给出可直接展示的中文标签
const STRATEGY_LABELS: Record<string, string> = {
  ast: "AST 结构切分",
  fixed: "固定窗口切分",
  unknown: "未标注策略",
  "ast-semantic": "AST 语义切分",
  "ast-function": "AST 函数级切分",
  "fixed-token": "固定 token 切分",
  "markdown-header": "Markdown 标题切分",
  "line-window": "行窗口切分",
};

const EMBEDDING_MODELS = ["bge-m3", "text-embedding-3-small", "bge-large-zh"];

export function KnowledgeBasePage() {
  const activeRepoId = useNavStore((s) => s.activeRepoId);
  const openRepo = useNavStore((s) => s.openRepo);

  const { repos, loading: reposLoading, error: reposError } = useRepos();

  const stats = useMemo(() => {
    const repoCount = repos.length;
    const modules = repos.reduce((sum, r) => sum + r.totalModules, 0);
    const chunks = repos.reduce((sum, r) => sum + r.totalChunks, 0);
    const syncing = repos.filter((r) => r.status === "syncing").length;
    return { repos: repoCount, modules, chunks, syncing };
  }, [repos]);

  // Brief loading skeleton on mount (300ms) for the stats cards row.
  // setState lives inside the setTimeout callback (async) so it doesn't
  // trip react-hooks/set-state-in-effect.
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setStatsLoading(false), 300);
    return () => window.clearTimeout(timer);
  }, []);

  const activeRepo =
    repos.find((r) => r.id === activeRepoId) ?? repos[0];

  if (!activeRepo) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center">
        <Database className="size-8 text-muted-foreground" />
        <p className="mt-4 text-base font-medium text-foreground">
          {reposLoading ? "正在加载知识库…" : "暂无已建库的仓库"}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {reposError ?? "请先运行后端建库脚本，或在知识库中拉取仓库"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      {/* header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Database className="size-6 text-brand" />
            知识库
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理代码仓库、切片策略与向量索引
          </p>
        </div>
        <PullRepoDialog />
      </div>

      {/* stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {statsLoading ? (
          <>
            <KnowledgeStatSkeleton />
            <KnowledgeStatSkeleton />
            <KnowledgeStatSkeleton />
            <KnowledgeStatSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Database} label="仓库数" value={stats.repos} />
            <StatCard icon={Boxes} label="总模块数" value={stats.modules} />
            <StatCard icon={Layers} label="总切片数" value={stats.chunks} />
            <StatCard
              icon={RefreshCw}
              label="同步中数量"
              value={stats.syncing}
              highlight={stats.syncing > 0}
            />
          </>
        )}
      </div>

      {/* repo list */}
      <div className="mb-6 space-y-3">
        {repos.map((repo) => (
          <RepoCard
            key={repo.id}
            repo={repo}
            active={repo.id === activeRepoId}
            onViewTree={() => openRepo(repo.id, "knowledge")}
          />
        ))}
      </div>

      {/* file tree + chunk preview for the active repo */}
      <FileTreeSection repo={activeRepo} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            highlight
              ? "bg-amber-50 text-amber-600"
              : "bg-brand-soft text-brand-soft-foreground",
          )}
        >
          <Icon className="size-4" />
        </div>
        <span className="text-[12px] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function RepoCard({
  repo,
  active,
  onViewTree,
}: {
  repo: Repo;
  active: boolean;
  onViewTree: () => void;
}) {
  const strategyLabel = STRATEGY_LABELS[repo.sliceStrategy];
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-card transition-all",
        active
          ? "border-brand ring-1 ring-brand/20"
          : "border-border hover:border-brand/40 hover:shadow-card-hover hover:-translate-y-0.5",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* identity */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Github className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold">{repo.name}</span>
            <Badge variant="outline" className="gap-1">
              <GitBranch className="size-3" />
              {repo.branch}
            </Badge>
            <StatusBadge status={repo.status} />
          </div>
          <div className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
            {repo.url}
          </div>
          {/* D6：后端不提供仓库描述，为空时不渲染该行 */}
          {repo.description ? (
            <div className="mt-1.5 text-[13px] text-muted-foreground">
              {repo.description}
            </div>
          ) : null}
        </div>

        {/* progress / meta */}
        <div className="lg:w-72">
          {repo.status === "syncing" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>同步进度</span>
                <span className="tabular-nums">{repo.progress}%</span>
              </div>
              <Progress value={repo.progress} className="h-1.5" />
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              <span>最近同步：{repo.lastSyncAt}</span>
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3" />
                {repo.embeddingModel}
              </span>
              <span>{strategyLabel}</span>
            </div>
          )}
        </div>

        {/* stats + actions */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <Pill icon={Boxes} value={repo.totalModules} label="模块" />
            <Pill icon={Layers} value={repo.totalChunks} label="切片" />
            <Pill icon={Folder} value={repo.totalFiles} label="文件" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              onClick={onViewTree}
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              查看文件树
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[12px]"
              onClick={() => toast.info(`已开始重新同步 ${repo.name}`)}
            >
              <RefreshCw className="size-3.5" />
              重新同步
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="更多操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => toast.info(`已开始导出 ${repo.name}`)}
              >
                <Download className="size-4" />
                导出
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => toast.error(`已删除 ${repo.name}`)}
              >
                <Trash2 className="size-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5">
      <Icon className="size-3 text-muted-foreground" />
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function PullRepoDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [strategy, setStrategy] = useState<string>("ast-semantic");
  const [embedding, setEmbedding] = useState("bge-m3");
  const [strategyOptions, setStrategyOptions] = useState<
    Record<string, number | string>
  >({});

  function reset() {
    setUrl("");
    setBranch("main");
    setStrategy("ast-semantic");
    setEmbedding("bge-m3");
    setStrategyOptions({});
  }

  function handleSubmit() {
    setOpen(false);
    toast.success("仓库拉取已开始", {
      description: url ? `正在拉取 ${url}` : "请稍候…",
    });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-brand text-brand-foreground hover:bg-brand/90">
          <Plus className="size-4" />
          拉取仓库
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>拉取新仓库</DialogTitle>
          <DialogDescription>
            填入仓库地址，选择切片策略与 embedding 模型
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">仓库 URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="font-mono text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">分支</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="font-mono text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">切片策略</label>
            <div className="grid gap-2">
              {SLICE_STRATEGIES.map((s) => {
                const selected = s.id === strategy;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStrategy(s.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-all",
                      selected
                        ? "border-brand bg-brand-soft/30 ring-1 ring-brand/30"
                        : "border-border bg-card hover:border-brand/40 hover:bg-accent/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border",
                          selected
                            ? "border-brand bg-brand text-brand-foreground"
                            : "border-border",
                        )}
                      >
                        {selected && <Check className="size-3" />}
                      </span>
                      <span className="text-[13px] font-semibold">{s.name}</span>
                      {s.recommended && (
                        <Badge className="border-brand/20 bg-brand-soft text-brand-soft-foreground">
                          推荐
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 pl-6 text-[12px] text-muted-foreground">
                      {s.description}
                    </p>
                    {selected && s.options && s.options.length > 0 && (
                      <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                        {s.options.map((opt) => (
                          <StrategyOptionInput
                            key={opt.key}
                            option={opt}
                            value={strategyOptions[opt.key] ?? opt.value}
                            onChange={(v) =>
                              setStrategyOptions((prev) => ({
                                ...prev,
                                [opt.key]: v,
                              }))
                            }
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">Embedding 模型</label>
            <Select value={embedding} onValueChange={setEmbedding}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={handleSubmit}
            disabled={!url.trim()}
          >
            开始拉取
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StrategyOptionInput({
  option,
  value,
  onChange,
}: {
  option: StrategyOption;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  if (option.type === "select") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{option.label}</label>
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="h-8 w-full text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {option.options?.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground">
        {option.label}
        {option.min !== undefined && option.max !== undefined && (
          <span className="ml-1 text-[10px]">
            ({option.min}-{option.max})
          </span>
        )}
      </label>
      <Input
        type="number"
        value={Number(value)}
        min={option.min}
        max={option.max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-[12px]"
      />
    </div>
  );
}

function FileTreeSection({ repo }: { repo: Repo }) {
  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null);
  const [filter, setFilter] = useState("");
  // Track the repo this selection belongs to; reset when repo changes (adjust during render, no effect)
  const [selectedRepoId, setSelectedRepoId] = useState(repo.id);

  const treeState = useFileTree(repo.id);
  const tree = treeState.data;

  // Expansion is owned by the parent so the collapse-all / expand-all buttons
  // can drive it. Initialize to "all dirs expanded" to preserve the previous
  // defaultExpanded=true behavior.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(collectDirPaths(tree)),
  );

  // 文件树是异步到达的：首次拿到数据时补做一次"全部展开"（渲染期同步，避免 setState in effect）
  const [lastTreeSize, setLastTreeSize] = useState(0);
  if (tree.length > 0 && tree.length !== lastTreeSize) {
    setLastTreeSize(tree.length);
    setExpanded(new Set(collectDirPaths(tree)));
  }

  if (selectedRepoId !== repo.id) {
    setSelectedRepoId(repo.id);
    setSelectedFile(null);
    setFilter("");
    setExpanded(new Set(collectDirPaths(tree)));
  }

  const filteredTree = useMemo(() => filterTree(tree, filter), [tree, filter]);
  const totalFiles = useMemo(() => countFiles(tree), [tree]);
  const totalChunks = useMemo(() => countChunks(tree), [tree]);

  const breadcrumbSegments = selectedFile
    ? selectedFile.path.split("/").filter(Boolean)
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* file tree card */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold">
            文件树 · {repo.name}
          </h3>
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="全部展开"
              aria-label="全部展开"
              onClick={() => setExpanded(new Set(collectDirPaths(tree)))}
            >
              <ChevronsUpDown className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="全部折叠"
              aria-label="全部折叠"
              onClick={() => setExpanded(new Set())}
            >
              <ChevronsDownUp className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {treeState.loading
            ? "正在加载文件树…"
            : treeState.error
              ? `文件树加载失败：${treeState.error}`
              : `共 ${totalFiles} 文件 · ${totalChunks} 切片`}
        </p>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="按文件名过滤"
            className="h-8 pl-8 text-[12px]"
          />
        </div>
        {/* Breadcrumb: shows the selected file's full path. Muted segments +
            foreground filename + .breadcrumb-sep slash. Empty state hint when
            nothing is selected. */}
        <div className="mb-3 min-h-[18px]">
          {selectedFile ? (
            <div className="flex flex-wrap items-center font-mono text-[11px] leading-tight">
              {breadcrumbSegments.flatMap((seg, i) => {
                const isLast = i === breadcrumbSegments.length - 1;
                return [
                  i > 0 ? (
                    <span key={`sep-${i}`} className="breadcrumb-sep">
                      /
                    </span>
                  ) : null,
                  <span
                    key={`seg-${i}`}
                    className={cn(
                      isLast
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {seg}
                  </span>,
                ];
              })}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              选择文件查看路径
            </span>
          )}
        </div>
        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto pr-1">
          {filteredTree.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">
              未匹配到文件
            </div>
          ) : (
            <FileTree
              nodes={filteredTree}
              expanded={expanded}
              setExpanded={setExpanded}
              onSelect={setSelectedFile}
            />
          )}
        </div>
      </div>

      {/* chunk preview card */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
          <Layers className="size-4 text-brand" />
          切片预览
        </h3>
        {selectedFile ? (
          <ChunkPreview file={selectedFile} />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Layers className="size-8 opacity-30" />
            <p className="text-[12px]">选择左侧文件查看切片</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface PreviewChunk {
  label: string;
  startLine: number;
  endLine: number;
  tokens: number;
}

function ChunkPreview({ file }: { file: FileTreeNode }) {
  const chunksState = useFileChunks(file.id ?? null);
  const chunks: PreviewChunk[] = chunksState.data.map((chunk) => ({
    label:
      chunk.name ??
      (chunk.strategy === "fixed" ? "固定窗口切片" : chunk.chunk_type),
    startLine: chunk.start_line,
    endLine: chunk.end_line,
    tokens: Math.max(1, Math.round(chunk.char_count / 4)),
  }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge variant="outline" className="gap-1">
          <Hash className="size-3" />
          {file.chunkCount} 切片
        </Badge>
        <Badge variant="outline">{file.lineCount} 行</Badge>
        {file.language && (
          <span className="text-muted-foreground">{file.language}</span>
        )}
      </div>
      {chunksState.loading ? (
        <p className="text-[12px] text-muted-foreground">正在加载切片…</p>
      ) : chunksState.error ? (
        <p className="text-[12px] text-muted-foreground">
          切片加载失败：{chunksState.error}
        </p>
      ) : chunks.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">该文件暂无切片记录</p>
      ) : null}
      <div className="space-y-2">
        {chunks.map((c, i) => {
          return (
            <div
              key={i}
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="truncate font-mono text-[12px] font-medium">
                  {c.label}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  L{c.startLine} - L{c.endLine}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground">tokens</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {c.tokens}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- helpers ----

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (ns: FileTreeNode[]): FileTreeNode[] => {
    const out: FileTreeNode[] = [];
    for (const n of ns) {
      if (n.type === "dir") {
        const children = n.children ? walk(n.children) : [];
        if (children.length > 0 || n.name.toLowerCase().includes(q)) {
          out.push({ ...n, children });
        }
      } else if (n.name.toLowerCase().includes(q)) {
        out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}

function countFiles(nodes: FileTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "file") n += 1;
    else if (node.children) n += countFiles(node.children);
  }
  return n;
}

function countChunks(nodes: FileTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "file") n += node.chunkCount;
    else if (node.children) n += countChunks(node.children);
  }
  return n;
}
