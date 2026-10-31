"use client";

import { motion } from "framer-motion";
import { ArrowRight, FileCode2, Github, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavStore } from "@/lib/rag/store";
import { getRepoById } from "@/lib/rag/mock-data";
import type { CodeModule, Language } from "@/lib/rag/types";
import { COMPLEXITY_META } from "@/components/rag/shared/meta";
import { LanguageBadge, TypeBadge } from "@/components/rag/shared/badges";

// Tailwind border-color classes mirroring LANGUAGE_META.dot. Declared as
// literals so the JIT compiler picks them up (runtime string replace wouldn't
// be detected and the classes would be purged from the final CSS).
const LANGUAGE_BORDER: Record<Language, string> = {
  typescript: "border-blue-500",
  tsx: "border-cyan-500",
  javascript: "border-yellow-500",
  jsx: "border-amber-500",
  python: "border-emerald-500",
  go: "border-sky-500",
  rust: "border-orange-500",
};

/* Complexity progress ring config — keeps every Tailwind color class as a
   static literal so the JIT sees it. Stroke class drives the SVG arc fill,
   `text` drives the centered letter (L/M/H). `pct` is the arc fill ratio.
   - low    → 33% filled, emerald
   - medium → 66% filled, amber
   - high   → 100% filled, rose
   `zh` provides the native tooltip suffix ("复杂度: 高/中/低"). */
const COMPLEXITY_RING: Record<
  "low" | "medium" | "high",
  { pct: number; stroke: string; text: string; letter: string; zh: string }
> = {
  low: { pct: 33, stroke: "stroke-emerald-500", text: "text-emerald-600", letter: "L", zh: "低" },
  medium: { pct: 66, stroke: "stroke-amber-500", text: "text-amber-600", letter: "M", zh: "中" },
  high: { pct: 100, stroke: "stroke-rose-500", text: "text-rose-600", letter: "H", zh: "高" },
};

const RING_SIZE = 28; // size-7
const RING_STROKE = 3;
const RING_R = (RING_SIZE - RING_STROKE) / 2; // 12.5
const RING_C = 2 * Math.PI * RING_R; // circumference ≈ 78.54

/** Circular SVG progress ring showing module complexity (low / medium / high).
 *  28px outer, 3px stroke, arc fills 33/66/100% with emerald/amber/rose.
 *  Letter L/M/H sits centered. `title` provides a native tooltip with the
 *  full "复杂度: X" label for screen readers / hover. */
function ComplexityRing({ complexity }: { complexity: "low" | "medium" | "high" }) {
  const meta = COMPLEXITY_RING[complexity];
  const fullLabel = COMPLEXITY_META[complexity].label;
  const offset = RING_C * (1 - meta.pct / 100);
  return (
    <span
      role="img"
      aria-label={`复杂度: ${meta.zh}`}
      title={`复杂度: ${meta.zh}（${fullLabel}）`}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
        aria-hidden
      >
        {/* track */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted/50"
          vectorEffect="non-scaling-stroke"
        />
        {/* arc */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
          className={cn("complexity-ring", meta.stroke)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[9px] font-bold leading-none",
          meta.text,
        )}
        aria-hidden
      >
        {meta.letter}
      </span>
    </span>
  );
}

interface ModuleCardProps {
  module: CodeModule;
  /** Show the module's repo badge — typically only when browsing across repos. */
  showRepo?: boolean;
}

export function ModuleCard({ module, showRepo = false }: ModuleCardProps) {
  const openModule = useNavStore((s) => s.openModule);
  const repo = showRepo ? getRepoById(module.repoId) : undefined;
  const langBorder = LANGUAGE_BORDER[module.language];

  return (
    <motion.button
      type="button"
      onClick={() => openModule(module.id)}
      aria-label={`查看模块 ${module.name}`}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={cn(
        "group relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-5 text-left shadow-card transition-colors duration-200 ease-out",
        "hover:border-brand hover:shadow-card-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* left accent bar — appears on hover */}
      <span
        aria-hidden
        className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-brand opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />

      {/* Top row: type/language + repo badge + chunk count */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TypeBadge type={module.type} />
          <LanguageBadge language={module.language} />
        </div>
        <div className="flex items-center gap-1.5">
          {repo && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <Github className="size-3" />
              {repo.name}
            </span>
          )}
          <span className="relative inline-flex items-center gap-0.5 overflow-hidden rounded-md bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-soft-foreground">
            {/* hover shimmer sweep — a single translateX gradient overlay.
                Kept subtle (max opacity 0.5) so the brand-soft tint still
                reads; pointer-events-none so it never intercepts clicks. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:translate-x-full group-hover:opacity-50"
            />
            <Hash className="size-3" />
            {module.chunkCount} 切片
          </span>
        </div>
      </div>

      {/* Module name */}
      <div className="truncate text-[15px] font-semibold text-foreground">
        {module.name}
      </div>

      {/* File path — language-tinted left border for a quick color cue */}
      <div className={cn("flex items-center gap-1.5 border-l-2 pl-2", langBorder)}>
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
          {module.filePath}
        </span>
      </div>

      {/* Summary — leading brand dot to distinguish from the mono file path above */}
      <p className="line-clamp-2 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-brand/60" />
        <span className="min-w-0 flex-1">{module.summary}</span>
      </p>

      {/* Highlights — min-height keeps grid cards aligned when some modules
          have 2 highlights and others 3 (avoids the card shrinking vertically). */}
      {module.highlights.length > 0 && (
        <ul className="min-h-[3.5rem] space-y-1">
          {module.highlights.slice(0, 3).map((h, idx) => (
            <li
              key={idx}
              className="flex items-start gap-1.5 text-[12px] leading-snug text-foreground/80"
            >
              <span className="mt-[5px] size-1 shrink-0 rounded-full bg-brand transition-transform duration-200 group-hover:animate-[pulse-dot_1.6s_ease-in-out_infinite]" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Bottom row: tags + complexity */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {module.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {module.tags.length > 3 && (
            <span
              title={`更多标签：${module.tags.slice(3).join("、")}`}
              className="cursor-help rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-brand-soft hover:text-brand-soft-foreground"
            >
              +{module.tags.length - 3}
            </span>
          )}
        </div>
        <ComplexityRing complexity={module.complexity} />
      </div>

      {/* hover hint: "查看详情 →" slides + fades in at bottom-right */}
      <div className="pointer-events-none absolute bottom-4 right-5 inline-flex translate-x-1 items-center gap-1 text-[11px] font-medium text-brand opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
        查看详情
        <ArrowRight className="size-3" />
      </div>
    </motion.button>
  );
}
