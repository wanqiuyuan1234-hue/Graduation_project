import { cn } from "@/lib/utils";
import { LANGUAGE_META, MODULE_TYPE_META, STATUS_META } from "./meta";
import type { Language, ModuleType } from "@/lib/rag/types";

export function TypeBadge({ type, className }: { type: ModuleType; className?: string }) {
  const meta = MODULE_TYPE_META[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        meta.color,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function LanguageBadge({ language, className }: { language: Language; className?: string }) {
  const meta = LANGUAGE_META[language];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        meta.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        meta.color,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 85 ? "bg-emerald-500" : pct >= 70 ? "bg-brand" : pct >= 55 ? "bg-amber-500" : "bg-rose-400";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}
