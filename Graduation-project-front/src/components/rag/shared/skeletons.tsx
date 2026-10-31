"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton mimicking ModuleCard layout — matches the real card's
 * top row (two small pills + chunk badge), name line, file path line,
 * summary block (two lines), and 3 highlight lines.
 */
export function ModuleCardSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
      {/* Top row: two small pills + chunk badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
        <Skeleton className="h-5 w-16 rounded-md" />
      </div>

      {/* Module name */}
      <Skeleton className="h-4 w-2/3 rounded" />

      {/* File path */}
      <Skeleton className="h-3 w-3/4 rounded" />

      {/* Summary */}
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-5/6 rounded" />
      </div>

      {/* Highlights */}
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-1/2 rounded" />
        <Skeleton className="h-3 w-1/2 rounded" />
        <Skeleton className="h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

/**
 * Skeleton grid mimicking ModuleBrowserPage grid layout.
 * Renders 9 cards by default to fill a 3-column grid.
 */
export function ModuleGridSkeleton({ count = 9 }: { count?: number }) {
  const safeCount = Math.max(1, count);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: safeCount }).map((_, i) => (
        <ModuleCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton mimicking KnowledgeBase StatCard — icon box + label + big number.
 */
export function KnowledgeStatSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-3 w-14 rounded" />
      </div>
      <Skeleton className="mt-2 h-7 w-12 rounded" />
    </div>
  );
}

/**
 * Skeleton mimicking an assistant chat message card — avatar + name line
 * plus 3 text lines of varying width.
 */
export function MessageSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-11/12 rounded" />
        <Skeleton className="h-3 w-3/4 rounded" />
      </div>
    </div>
  );
}
