"use client";

import { ArrowUp, Github, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShortcutsDialog } from "@/components/rag/shared/shortcuts-dialog";

function handleBackToTop() {
  try {
    // The main scrollable container is the div directly under <main>.
    const el = document.querySelector<HTMLDivElement>(
      "main > div.overflow-y-auto",
    );
    if (el) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Fallback: scroll any overflow-y-auto under main.
    const fallback = document.querySelector<HTMLDivElement>(
      "main div.overflow-y-auto",
    );
    if (fallback) {
      fallback.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("无法返回顶部");
    }
  }
}

export function AppFooter() {
  return (
    <footer role="contentinfo" aria-label="页脚" className="mt-auto border-t border-border bg-background/80 backdrop-blur-sm">
      {/* subtle brand-tinted top divider gradient */}
      <div
        aria-hidden
        className="h-px w-full bg-gradient-to-r from-transparent via-brand/30 to-transparent"
      />
      <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-brand" />
          <span className="font-medium text-foreground">CodeRAG</span>
          <span>· 代码仓库 RAG 问答系统</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline">AST 语义切分 · bge-m3 · bge-reranker-v2-m3</span>
          <a
            href="#"
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-brand"
          >
            <Github className="size-3.5" />
            <span>FastGPT 风格复刻</span>
          </a>
          <span className="hidden items-center gap-1 sm:inline-flex">
            Built with <Heart className="size-3 fill-rose-500 text-rose-500" /> React + TS
          </span>
          <ShortcutsDialog />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBackToTop}
            className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground hover:bg-brand-soft hover:text-brand-soft-foreground"
            aria-label="返回顶部"
          >
            <ArrowUp className="size-3.5" />
            <span className="hidden sm:inline">返回顶部</span>
          </Button>
        </div>
      </div>
    </footer>
  );
}
