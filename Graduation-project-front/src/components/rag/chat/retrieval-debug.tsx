"use client";

import { Bug, ChevronDown, Hash, RefreshCw, Timer } from "lucide-react";
import { useState } from "react";
import type { ModuleType, RetrievalDebug, SourceChunk } from "@/lib/rag/types";
import { ScoreBar, TypeBadge } from "@/components/rag/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ReRetrieveParams {
  topK: number;
  rerank: boolean;
  vectorWeight: number;
}

interface RetrievalDebugPanelProps {
  debug: RetrievalDebug;
  /** When true, render interactive controls above the results table. */
  editable?: boolean;
  /** Called when the user clicks 重新检索 with the current params. */
  onReRetrieve?: (params: ReRetrieveParams) => void;
  /** Called when a result row is clicked (used to jump to source). */
  onSelectResult?: (chunk: SourceChunk) => void;
}

export function RetrievalDebugPanel({
  debug,
  editable = false,
  onReRetrieve,
  onSelectResult,
}: RetrievalDebugPanelProps) {
  const [open, setOpen] = useState(true);
  const vectorPct = Math.round(debug.vectorWeight * 100);
  const keywordPct = Math.round(debug.keywordWeight * 100);

  // Local editable state, synced from debug when debug changes (e.g. after
  // re-retrieve). Uses the "adjust state during render" pattern from the
  // React docs to avoid cascading renders from setState-in-effect.
  const [topK, setTopK] = useState(debug.topK);
  const [rerank, setRerank] = useState(debug.reranked);
  const [vectorWeight, setVectorWeight] = useState(debug.vectorWeight);
  const [lastSyncKey, setLastSyncKey] = useState("");
  const syncKey = `${debug.topK}|${debug.reranked ? 1 : 0}|${debug.vectorWeight}`;
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    setTopK(debug.topK);
    setRerank(debug.reranked);
    setVectorWeight(debug.vectorWeight);
  }
  const keywordWeight = 1 - vectorWeight;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={open}
        >
          <Bug className="size-4 text-brand" />
          <span className="text-[13px] font-semibold">检索调试</span>
          <span className="text-[11px] text-muted-foreground">
            · {debug.latencyMs}ms · topK {debug.topK}
          </span>
          {editable && (
            <Badge className="border-brand/20 bg-brand-soft text-brand-soft-foreground">
              可调
            </Badge>
          )}
          <ChevronDown
            className={cn(
              "ml-auto size-4 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-3 space-y-4">
          {/* stats row */}
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            {!editable && (
              <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5">
                topK{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {debug.topK}
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5">
              <Timer className="size-3 text-muted-foreground" />
              <span className="font-semibold tabular-nums text-foreground">
                {debug.latencyMs}
              </span>
              <span className="text-muted-foreground">ms</span>
            </span>
            {!editable &&
              (debug.reranked ? (
                <Badge className="border-brand/20 bg-brand-soft text-brand-soft-foreground">
                  已重排
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground">
                  未重排
                </Badge>
              ))}
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5">
              <span className="text-muted-foreground">model</span>
              <span className="font-mono text-foreground">{debug.rerankModel}</span>
            </span>
          </div>

          {editable && onReRetrieve ? (
            <EditableControls
              topK={topK}
              rerank={rerank}
              vectorWeight={vectorWeight}
              keywordWeight={keywordWeight}
              rerankModel={debug.rerankModel}
              onChangeTopK={setTopK}
              onChangeRerank={setRerank}
              onChangeVectorWeight={setVectorWeight}
              onReRetrieve={() =>
                onReRetrieve({ topK, rerank, vectorWeight })
              }
            />
          ) : (
            /* weight bars (display-only mode) */
            <div className="grid gap-3 sm:grid-cols-2">
              <WeightBar label="向量权重" pct={vectorPct} colorClass="bg-brand" />
              <WeightBar label="关键词权重" pct={keywordPct} colorClass="bg-slate-400" />
            </div>
          )}

          {/* results list */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              检索结果 ({debug.results.length})
            </div>
            <div className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-1">
              {debug.results.map((r, i) => {
                const clickable = !!onSelectResult;
                return (
                  <div
                    key={r.chunk.id}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={
                      clickable
                        ? () => onSelectResult?.(r.chunk)
                        : undefined
                    }
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectResult?.(r.chunk);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "rounded-lg border border-border bg-card p-2.5 text-[12px] transition-colors",
                      clickable &&
                        "cursor-pointer hover:bg-accent/40 hover:border-brand/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="truncate font-mono text-[12px] font-medium">
                        {r.chunk.filePath.split("/").pop()}
                      </span>
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <Hash className="size-3" />
                        <span className="tabular-nums">
                          L{r.chunk.startLine}-L{r.chunk.endLine}
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <span className="w-10 text-[11px] text-muted-foreground">原始</span>
                        <ScoreBar score={r.score} className="flex-1" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-10 text-[11px] text-muted-foreground">重排</span>
                        <ScoreBar score={r.rerankedScore} className="flex-1" />
                      </div>
                    </div>
                    <div className="mt-1.5">
                      <ChunkTypeBadge type={r.chunk.chunkType} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EditableControls({
  topK,
  rerank,
  vectorWeight,
  keywordWeight,
  rerankModel,
  onChangeTopK,
  onChangeRerank,
  onChangeVectorWeight,
  onReRetrieve,
}: {
  topK: number;
  rerank: boolean;
  vectorWeight: number;
  keywordWeight: number;
  rerankModel: string;
  onChangeTopK: (v: number) => void;
  onChangeRerank: (v: boolean) => void;
  onChangeVectorWeight: (v: number) => void;
  onReRetrieve: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      {/* topK slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="font-medium text-foreground">topK</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-foreground">
              {topK}
            </span>
            <span className="text-[10px] text-muted-foreground">候选切片数</span>
          </span>
        </div>
        <Slider
          value={[topK]}
          min={1}
          max={12}
          step={1}
          onValueChange={(v) => onChangeTopK(v[0] ?? 1)}
          className="[&_[data-slot=slider-range]]:bg-brand"
        />
      </div>

      {/* rerank switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5 text-[11.5px]">
          <span className="font-medium text-foreground">重排</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {rerankModel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-muted-foreground">
            {rerank ? "已启用" : "已关闭"}
          </span>
          <Switch checked={rerank} onCheckedChange={onChangeRerank} />
        </div>
      </div>

      {/* vectorWeight slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="font-medium text-foreground">向量权重</span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-soft-foreground">
              向量 {Math.round(vectorWeight * 100)}%
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              关键词 {Math.round(keywordWeight * 100)}%
            </span>
          </span>
        </div>
        <Slider
          value={[vectorWeight]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={(v) => onChangeVectorWeight(v[0] ?? 0)}
          className="[&_[data-slot=slider-range]]:bg-brand"
        />
      </div>

      {/* re-retrieve button */}
      <Button
        type="button"
        size="sm"
        onClick={onReRetrieve}
        className="w-full gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
      >
        <RefreshCw className="size-3.5" />
        重新检索
      </Button>
    </div>
  );
}

function WeightBar({
  label,
  pct,
  colorClass,
}: {
  label: string;
  pct: number;
  colorClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ChunkTypeBadge({ type }: { type: ModuleType | "block" | "import" }) {
  if (type === "block" || type === "import") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
        <span className="size-1.5 rounded-full bg-slate-400" />
        {type === "block" ? "代码块" : "导入"}
      </span>
    );
  }
  return <TypeBadge type={type} />;
}
