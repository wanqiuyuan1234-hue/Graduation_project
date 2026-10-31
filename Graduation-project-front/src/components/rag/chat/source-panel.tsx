"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, FileCode2, Hash, Quote, X } from "lucide-react";
import type { Citation, SourceChunk } from "@/lib/rag/types";
import { LanguageBadge, ScoreBar } from "@/components/rag/shared/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SourcePanelProps {
  open: boolean;
  onClose: () => void;
  citations: Citation[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  onJumpToCode?: (chunk: SourceChunk) => void;
}

export function SourcePanel({
  open,
  onClose,
  citations,
  activeIndex,
  onSelect,
  onJumpToCode,
}: SourcePanelProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden
        />
      )}
      <motion.aside
        initial={false}
        animate={{ x: open ? 0 : "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }}
        className={cn(
          "fixed top-0 right-0 z-50 flex h-full w-[380px] max-w-[90vw] flex-col border-l border-border bg-card shadow-2xl",
          !open && "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Quote className="size-4 text-brand" />
            <h2 className="text-[15px] font-semibold">引用来源</h2>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {citations.length}
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="关闭引用来源面板"
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin p-4">
          {citations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Quote className="size-8 opacity-40" />
              <p className="text-sm">暂无引用来源</p>
            </div>
          ) : (
            citations.map((c) => {
              const isActive = activeIndex === c.index;
              return (
                <div
                  key={`${c.index}-${c.chunk.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(c.index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(c.index);
                    }
                  }}
                  className={cn(
                    "block w-full cursor-pointer rounded-xl border p-3 text-left transition-all",
                    isActive
                      ? "border-brand bg-brand-soft/30 ring-1 ring-brand/30"
                      : "border-border bg-card hover:border-brand/40 hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-brand text-[11px] font-semibold text-brand-foreground tabular-nums">
                      {c.index}
                    </span>
                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-[13px] font-medium">
                      {c.chunk.filePath.split("/").pop()}
                    </span>
                    <LanguageBadge language={c.chunk.language} className="ml-auto" />
                  </div>

                  <div className="mt-1.5 truncate font-mono text-[12px] text-muted-foreground">
                    {c.chunk.filePath}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Hash className="size-3.5" />
                    <span className="tabular-nums">
                      L{c.chunk.startLine} - L{c.chunk.endLine}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="tabular-nums">{c.chunk.tokenCount} tokens</span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">相似度</span>
                    <ScoreBar
                      score={c.chunk.rerankedScore ?? c.chunk.score}
                      className="flex-1"
                    />
                  </div>

                  <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                    {c.chunk.content}
                  </pre>

                  {onJumpToCode && (
                    <div className="mt-2.5 flex justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToCode(c.chunk);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-brand transition-colors hover:bg-brand-soft hover:text-brand/80"
                        aria-label={`跳转到代码 L${c.chunk.startLine}-L${c.chunk.endLine}`}
                      >
                        跳转代码
                        <ArrowUpRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </motion.aside>
    </>
  );
}
