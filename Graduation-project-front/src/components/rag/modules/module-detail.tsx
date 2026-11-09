"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileCode2,
  GitBranch,
  Github,
  Hash,
  Layers,
  MessageSquareText,
  Quote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useNavStore } from "@/lib/rag/store";
import { useModuleDetail, useRepoById } from "@/lib/api/hooks";
// D3/D4：后端没有引用索引与模块关系表，这两个数组恒为空，下面的 mock 查找分支
// 仅用于保持既有空态结构，实际不会渲染任何 mock 模块。
import { getModuleById } from "@/lib/rag/mock-data";
import type { CallEdge, ReferenceRecord } from "@/lib/rag/types";
import { COMPLEXITY_META } from "@/components/rag/shared/meta";
import { LanguageBadge, TypeBadge } from "@/components/rag/shared/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CodeViewer } from "./code-viewer";

const REF_KIND_META: Record<ReferenceRecord["kind"], { label: string; color: string }> = {
  import: { label: "import", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  call: { label: "call", color: "text-brand-soft-foreground bg-brand-soft border-brand/20" },
  extend: { label: "extend", color: "text-violet-600 bg-violet-50 border-violet-200" },
  "type-ref": { label: "type-ref", color: "text-amber-600 bg-amber-50 border-amber-200" },
};

export function ModuleDetailPage() {
  const activeModuleId = useNavStore((s) => s.activeModuleId);
  const moduleDetail = useModuleDetail(activeModuleId);
  const moduleData = moduleDetail.data;
  const repo = useRepoById(moduleData?.repoId ?? null);
  const detailHighlight = useNavStore((s) => s.detailHighlight);
  const activeRepoId = useNavStore((s) => s.activeRepoId);
  const go = useNavStore((s) => s.go);
  const openModule = useNavStore((s) => s.openModule);
  const openRepo = useNavStore((s) => s.openRepo);

  const [tab, setTab] = useState("code");
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedAst, setCopiedAst] = useState(false);
  // Track the previously-seen detailHighlight so we can switch to the code tab
  // when a new citation jump arrives — done during render to avoid the
  // "setState in effect" anti-pattern.
  const [lastHighlight, setLastHighlight] = useState(detailHighlight);

  if (detailHighlight !== lastHighlight) {
    setLastHighlight(detailHighlight);
    if (detailHighlight) {
      setTab("code");
    }
  }

  if (!moduleData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-20 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
          <FileCode2 className="size-8 text-muted-foreground" />
        </div>
        <div>
          <p className="text-base font-medium text-foreground">
            {moduleDetail.loading ? "正在加载模块…" : "未选择模块"}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {moduleDetail.loading
              ? "正在从后端读取模块详情"
              : moduleDetail.error ?? "从模块浏览中选择一个模块查看详情"}
          </p>
        </div>
        <Button variant="default" onClick={() => go("modules")} className="gap-1.5">
          <ChevronLeft className="size-4" />
          返回模块浏览
        </Button>
      </div>
    );
  }

  const cm = COMPLEXITY_META[moduleData.complexity];
  // Repo context — lookup the module's owning repo and detect cross-repo
  // navigation (e.g. citation jump from a chat in repo A to a module in
  // repo B, or an all-repos card click). When cross-repo we render a
  // three-level breadcrumb + a "switch to this repo" affordance.
  const crossRepo = !!repo && repo.id !== activeRepoId;
  const codeStartLine =
    moduleData.chunkBoundaries.find((b) => b.chunkId === moduleData.id)?.startLine ??
    1;
  const highlights = moduleData.chunkBoundaries.map((b) => ({
    start: b.startLine,
    end: b.endLine,
    active: b.chunkId === activeChunkId,
  }));
  // Merge citation-jump highlight (from chat source panel) as an active entry.
  const mergedHighlights = detailHighlight
    ? [
        ...highlights,
        {
          start: detailHighlight.startLine,
          end: detailHighlight.endLine,
          active: true,
        },
      ]
    : highlights;
  const incoming = moduleData.callChain.filter((e) => e.direction === "incoming");
  const outgoing = moduleData.callChain.filter((e) => e.direction === "outgoing");
  const maxTokens = moduleData.chunkBoundaries.reduce(
    (acc, b) => Math.max(acc, b.tokenCount),
    0,
  );

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(moduleData.filePath);
      setCopiedPath(true);
      toast.success("文件路径已复制");
      setTimeout(() => setCopiedPath(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleCopyAst = async () => {
    try {
      await navigator.clipboard.writeText(moduleData.astPath);
      setCopiedAst(true);
      toast.success("AST 路径已复制");
      setTimeout(() => setCopiedAst(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleChunkClick = (chunkId: string) => {
    setActiveChunkId(chunkId);
    setTab("code");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-1.5 text-[13px]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go("modules")}
            className="h-7 gap-1 px-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            模块浏览
          </Button>
          <span className="text-muted-foreground/50">/</span>
          {crossRepo && repo ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                <Github className="size-3.5" />
                {repo.name}
              </span>
              <span className="text-muted-foreground/50">/</span>
              <span className="font-medium text-foreground">{moduleData.name}</span>
            </>
          ) : (
            <span className="font-medium text-foreground">{moduleData.name}</span>
          )}
        </div>

        {/* Header card */}
        <Card className="mb-5 p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={moduleData.type} />
                <LanguageBadge language={moduleData.language} />
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                    cm.color,
                  )}
                >
                  {cm.label}
                </span>
                {repo && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <Github className="size-3" />
                    {repo.name}
                    {repo.branch ? (
                      <span className="text-muted-foreground/70">· {repo.branch}</span>
                    ) : null}
                  </span>
                )}
                {crossRepo && repo ? (
                  <Button
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[11px] font-medium text-brand hover:bg-brand-soft/40 hover:text-brand"
                    onClick={() => {
                      openRepo(moduleData.repoId, "modules");
                      toast.success(`已切换到仓库 ${repo.name}`);
                    }}
                  >
                    切换到该仓库
                  </Button>
                ) : null}
              </div>
              <h1 className="text-xl font-semibold text-foreground">{moduleData.name}</h1>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">
                  {moduleData.filePath}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleCopyPath}
                  aria-label="复制路径"
                >
                  {copiedPath ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">{moduleData.summary}</p>
              {moduleData.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Hash className="size-3.5 text-muted-foreground" />
                  {moduleData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="default"
              onClick={() => go("chat")}
              className="gap-1.5 self-start"
            >
              <MessageSquareText className="size-4" />
              就这个模块提问
            </Button>
          </div>
        </Card>

        {/* Main grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left column */}
          <div className="min-w-0">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="code" className="gap-1.5">
                  <FileCode2 className="size-3.5" />
                  代码
                </TabsTrigger>
                <TabsTrigger value="metadata" className="gap-1.5">
                  <Braces className="size-3.5" />
                  元数据
                </TabsTrigger>
                <TabsTrigger value="callchain" className="gap-1.5">
                  <GitBranch className="size-3.5" />
                  调用链
                </TabsTrigger>
                <TabsTrigger value="chunks" className="gap-1.5">
                  <Layers className="size-3.5" />
                  切片边界
                </TabsTrigger>
              </TabsList>

              {/* Code tab */}
              <TabsContent value="code">
                {detailHighlight && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft/40 px-3 py-2 text-[12.5px] text-brand-soft-foreground">
                    <ArrowUpRight className="size-4 shrink-0 text-brand" />
                    <span className="flex-1">
                      已定位到引用来源
                      <span className="ml-1 font-mono font-semibold tabular-nums">
                        L{detailHighlight.startLine}-L{detailHighlight.endLine}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() =>
                        activeModuleId && openModule(activeModuleId, null)
                      }
                      aria-label="清除引用来源高亮"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                )}
                <CodeViewer
                  code={moduleData.code}
                  language={moduleData.language}
                  highlights={mergedHighlights}
                  startLine={codeStartLine}
                  onLineClick={(line) => {
                    const boundary = moduleData.chunkBoundaries.find(
                      (b) => line >= b.startLine && line <= b.endLine,
                    );
                    if (boundary) setActiveChunkId(boundary.chunkId);
                  }}
                />
              </TabsContent>

              {/* Metadata tab */}
              <TabsContent value="metadata">
                <Card className="p-5 shadow-card">
                  <div className="space-y-5">
                    <div>
                      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <Braces className="size-4 text-brand" />
                        参数列表
                      </h3>
                      {moduleData.parameters.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">无参数</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>名称</TableHead>
                              <TableHead>类型</TableHead>
                              <TableHead>必填</TableHead>
                              <TableHead>描述</TableHead>
                              <TableHead>默认值</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {moduleData.parameters.map((p) => (
                              <TableRow key={p.name}>
                                <TableCell className="font-mono text-[12px] text-foreground">
                                  {p.name}
                                </TableCell>
                                <TableCell className="font-mono text-[12px] text-brand-soft-foreground">
                                  {p.type}
                                </TableCell>
                                <TableCell>
                                  {p.required ? (
                                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
                                      必填
                                    </span>
                                  ) : (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                      可选
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-[12px] text-muted-foreground">
                                  {p.description}
                                </TableCell>
                                <TableCell className="font-mono text-[12px] text-muted-foreground">
                                  {p.default ?? "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <FileCode2 className="size-4 text-brand" />
                        模块元数据
                      </h3>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                        <MetaItem
                          label="行数"
                          value={`${moduleData.lineCount}`}
                          icon={<Hash className="size-3" />}
                        />
                        <MetaItem
                          label="切片数"
                          value={`${moduleData.chunkCount}`}
                          icon={<Layers className="size-3" />}
                        />
                        <MetaItem label="复杂度" value={cm.label} />
                        <MetaItem
                          label="更新时间"
                          value={moduleData.updatedAt}
                          icon={<Clock className="size-3" />}
                        />
                      </dl>
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[12px] text-muted-foreground">AST 路径</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={handleCopyAst}
                            aria-label="复制 AST 路径"
                          >
                            {copiedAst ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </Button>
                        </div>
                        <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-[12px] text-muted-foreground">
                          {moduleData.astPath}
                        </code>
                      </div>
                    </div>
                  </div>
                </Card>
              </TabsContent>

              {/* Call chain tab */}
              <TabsContent value="callchain">
                <Card className="p-5 shadow-card">
                  <div className="space-y-5">
                    <CallChainSection
                      title="调用方"
                      subtitle="incoming"
                      edges={incoming}
                      icon={<ArrowDownLeft className="size-4 text-emerald-600" />}
                      emptyText="无调用方"
                    />
                    <CallChainSection
                      title="被调用"
                      subtitle="outgoing"
                      edges={outgoing}
                      icon={<ArrowUpRight className="size-4 text-brand" />}
                      emptyText="无被调用"
                    />
                  </div>
                </Card>
              </TabsContent>

              {/* Chunks tab */}
              <TabsContent value="chunks">
                <Card className="p-5 shadow-card">
                  <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Layers className="size-4 text-brand" />
                    切片边界
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                      {moduleData.chunkBoundaries.length}
                    </span>
                  </h3>
                  {moduleData.chunkBoundaries.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">无切片边界</p>
                  ) : (
                    <div className="space-y-2">
                      {moduleData.chunkBoundaries.map((b) => {
                        const widthPct =
                          maxTokens > 0 ? Math.round((b.tokenCount / maxTokens) * 100) : 0;
                        const isActive = b.chunkId === activeChunkId;
                        return (
                          <button
                            key={b.chunkId}
                            type="button"
                            onClick={() => handleChunkClick(b.chunkId)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                              isActive
                                ? "border-brand bg-brand-soft/40"
                                : "border-border bg-card hover:border-brand/40 hover:bg-muted/40",
                            )}
                          >
                            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[11px] font-semibold text-brand-soft-foreground">
                              {b.chunkId.replace("chk-", "")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium text-foreground">
                                  {b.label}
                                </span>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {b.startLine}-{b.endLine}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-brand transition-all"
                                    style={{ width: `${widthPct}%` }}
                                  />
                                </div>
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {b.tokenCount} tok
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {/* Related modules */}
            <Card className="p-5 shadow-card">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Boxes className="size-4 text-brand" />
                关联模块
              </h3>
              {moduleData.relatedModuleIds.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">无关联模块</p>
              ) : (
                <ul className="space-y-1">
                  {moduleData.relatedModuleIds.map((id) => {
                    const related = getModuleById(id);
                    if (!related) return null;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChunkId(null);
                            openModule(id);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {related.name}
                              </span>
                              <TypeBadge type={related.type} />
                            </div>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {related.filePath}
                            </p>
                          </div>
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* References */}
            <Card className="p-5 shadow-card">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Quote className="size-4 text-brand" />
                被引用记录
              </h3>
              {moduleData.references.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">无引用记录</p>
              ) : (
                <ul className="space-y-2">
                  {moduleData.references.map((ref) => {
                    const meta = REF_KIND_META[ref.kind];
                    const targetExists = !!getModuleById(ref.moduleId);
                    return (
                      <li key={ref.id}>
                        <button
                          type="button"
                          disabled={!targetExists}
                          onClick={() => targetExists && openModule(ref.moduleId)}
                          className={cn(
                            "flex w-full flex-col gap-1.5 rounded-lg border border-border p-3 text-left transition-all",
                            targetExists
                              ? "hover:border-brand/40 hover:bg-muted/40"
                              : "cursor-default opacity-80",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-foreground">
                                {ref.moduleName}
                              </span>
                              <span
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                                  meta.color,
                                )}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {ref.filePath}:{ref.line}
                            </span>
                          </div>
                          <code className="line-clamp-2 break-all font-mono text-[11px] text-muted-foreground">
                            {ref.snippet}
                          </code>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

function CallChainSection({
  title,
  subtitle,
  edges,
  icon,
  emptyText,
}: {
  title: string;
  subtitle: string;
  edges: CallEdge[];
  icon: ReactNode;
  emptyText: string;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {title}
        <span className="font-mono text-[11px] font-normal text-muted-foreground">
          ({subtitle})
        </span>
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
          {edges.length}
        </span>
      </h3>
      {edges.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {edges.map((edge, idx) => (
            <li key={`${edge.name}-${idx}`} className="relative pl-6">
              <div className="absolute bottom-0 left-2 top-0 w-px bg-border" />
              <div className="absolute left-0 top-2.5 flex size-4 items-center justify-center rounded-full border border-border bg-card">
                <FileCode2 className="size-2.5 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-1.5 py-1">
                <span className="text-[13px] font-medium text-foreground">{edge.name}</span>
                <TypeBadge type={edge.kind} />
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {edge.filePath}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
