"use client";

import { useCallback, useMemo } from "react";
import {
  Database,
  ExternalLink,
  Gauge,
  Info,
  Laptop,
  Moon,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavStore } from "@/lib/rag/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const NAV_STORAGE_KEY = "coderag-nav";
const THEME_STORAGE_KEY = "coderag-theme";

/**
 * Streaming-speed presets. `streamSpeed` is persisted 1-5; each level maps to
 * a human label shown next to the slider thumb so the user can tell at a
 * glance what the current value means (without us wiring the actual
 * ms-per-token delay in this round — chat-page is off-limits).
 */
const SPEED_LABELS: Record<number, string> = {
  1: "极慢",
  2: "慢",
  3: "标准",
  4: "快",
  5: "极快",
};

/**
 * Read the current byte size of the `coderag-nav` localStorage entry, in KB
 * with 2 decimals. Returns "0.00" when the entry is absent or empty so the
 * Settings panel can render a stable value before the user has done anything.
 *
 * Wrapped in try/catch because Safari private mode throws on localStorage
 * access — we degrade to "—" rather than crashing the dialog.
 */
function readNavStorageKb(): string {
  if (typeof window === "undefined") return "0.00";
  try {
    const raw = window.localStorage.getItem(NAV_STORAGE_KEY) ?? "";
    const bytes = new Blob([raw]).size;
    return (bytes / 1024).toFixed(2);
  } catch {
    return "—";
  }
}

/**
 * Single settings row — a label on the left, an arbitrary control on the
 * right. Standardizes spacing across the four settings sections so they read
 * as a single coherent form rather than four ad-hoc blocks.
 */
function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Section header for the four settings groups (主题 / 流式速率 / 数据管理 /
 * 关于). The icon is tinted brand so each section has a visual anchor without
 * competing with the actual controls.
 */
function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border pb-2">
      <Icon className="size-4 text-brand" />
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    </div>
  );
}

/**
 * Application-level settings dialog. Controlled via `open` / `onOpenChange`
 * so the trigger (a gear icon button in the app-header) can live next to the
 * theme toggle while the dialog content stays self-contained.
 *
 * Sections:
 *  1. 主题 — light / dark RadioGroup wired to `setTheme`. A "跟随系统" button
 *     reads `prefers-color-scheme` and snaps to the corresponding concrete
 *     theme (the store only models light/dark, so we resolve "system" once
 *     at click time and persist the result — no live media-query subscription).
 *  2. 流式速率 — Slider 1-5 bound to `streamSpeed`. The actual ms-per-token
 *     wiring into chat-page's streamReply is deferred (chat-page is
 *     off-limits this round); the value is stored now so the chat page can
 *     consume it next round.
 *  3. 数据管理 — localStorage usage display + "清空所有会话" (AlertDialog-gated
 *     destructive action) + "重置为默认数据" (AlertDialog-gated, clears both
 *     `coderag-nav` and `coderag-theme` then reloads to restore mock data).
 *  4. 关于 — version + tech stack summary + external FastGPT link.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useNavStore((s) => s.theme);
  const setTheme = useNavStore((s) => s.setTheme);
  const streamSpeed = useNavStore((s) => s.streamSpeed);
  const setStreamSpeed = useNavStore((s) => s.setStreamSpeed);
  const sessions = useNavStore((s) => s.sessions);

  // LocalStorage usage in KB, computed on demand via useMemo. We deliberately
  // avoid useState + useEffect here (setState-in-effect is an anti-pattern
  // that triggers cascading renders). Instead we recompute when `open`
  // toggles true or `sessions` changes — both are reactive deps that cause
  // this component to re-render naturally. When `open` is false we short-
  // circuit to "0.00" so SSR and the initial client render produce the same
  // value (no hydration mismatch), and we don't touch localStorage during
  // SSR / pre-open renders.
  const navKb = useMemo(() => {
    if (!open) return "0.00";
    return readNavStorageKb();
  }, [open, sessions]);

  const handleFollowSystem = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    setTheme(prefersDark ? "dark" : "light");
    toast.success(`已切换为跟随系统（${prefersDark ? "深色" : "浅色"}）`);
  }, [setTheme]);

  const handleClearSessions = useCallback(() => {
    useNavStore.setState({
      sessions: [],
      activeSessionId: null,
      activeCitationIndex: null,
      sourcePanelOpen: false,
    });
    toast.success("已清空所有会话");
    // `sessions` reference changes above → useMemo recomputes navKb on the
    // next render, so the displayed size updates without manual setState.
  }, []);

  const handleResetDefaults = useCallback(() => {
    try {
      window.localStorage.removeItem(NAV_STORAGE_KEY);
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
    toast.success("已重置为默认数据，正在刷新…");
    // Slight delay so the toast paints before the reload tears down the page.
    window.setTimeout(() => window.location.reload(), 350);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b border-border px-6 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4 text-brand" />
            设置
          </DialogTitle>
          <DialogDescription className="text-xs">
            管理应用偏好与本地数据。所有设置仅保存在本浏览器中。
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[calc(85vh-7rem)] space-y-6 overflow-y-auto px-6 py-5">
          {/* 主题 */}
          <section className="space-y-1">
            <SectionHeader icon={Sun} title="主题" />
            <SettingsRow
              label="外观模式"
              hint="选择浅色或深色界面主题"
              htmlFor="theme-radio"
            >
              <RadioGroup
                id="theme-radio"
                value={theme}
                onValueChange={(v) =>
                  setTheme(v === "dark" ? "dark" : "light")
                }
                className="grid grid-cols-2 gap-2"
              >
                <Label
                  htmlFor="theme-light"
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                    theme === "light"
                      ? "border-brand bg-brand-soft text-brand-soft-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <RadioGroupItem id="theme-light" value="light" />
                  <Sun className="size-3.5" />
                  浅色
                </Label>
                <Label
                  htmlFor="theme-dark"
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                    theme === "dark"
                      ? "border-brand bg-brand-soft text-brand-soft-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <RadioGroupItem id="theme-dark" value="dark" />
                  <Moon className="size-3.5" />
                  深色
                </Label>
              </RadioGroup>
            </SettingsRow>
            <div className="flex items-center justify-between py-1">
              <p className="text-xs text-muted-foreground">
                跟随系统：读取浏览器 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">prefers-color-scheme</code> 偏好。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFollowSystem}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Laptop className="size-3.5" />
                跟随系统
              </Button>
            </div>
          </section>

          {/* 流式速率 */}
          <section className="space-y-1">
            <SectionHeader icon={Gauge} title="流式速率" />
            <div className="py-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <Label className="text-sm font-medium text-foreground">
                    Token 流式输出速度
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    数值越大，回复生成越快。下一轮接入对话流后生效。
                  </p>
                </div>
                <span className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-soft-foreground">
                  {streamSpeed}
                  <span className="text-muted-foreground">·</span>
                  {SPEED_LABELS[streamSpeed] ?? "标准"}
                </span>
              </div>
              <Slider
                id="stream-speed-slider"
                min={1}
                max={5}
                step={1}
                value={[streamSpeed]}
                onValueChange={(vals) => {
                  const next = vals[0];
                  if (typeof next === "number") setStreamSpeed(next);
                }}
                aria-label="流式速率"
              />
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>慢</span>
                <span>标准</span>
                <span>快</span>
              </div>
            </div>
          </section>

          {/* 数据管理 */}
          <section className="space-y-1">
            <SectionHeader icon={Database} title="数据管理" />
            <div className="py-3">
              <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Database className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    本地存储占用
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {navKb}
                  </span>
                  <span className="text-xs text-muted-foreground">KB</span>
                </div>
              </div>

              <div className="space-y-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-start gap-2 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      清空所有会话
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {sessions.length} 条
                      </span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>清空所有会话？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作将删除所有 {sessions.length}{" "}
                        条对话会话及其消息历史，无法撤销。已同步的代码仓库与切片数据不受影响。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleClearSessions}
                        className={cn(
                          "bg-destructive text-white hover:bg-destructive/90",
                          "focus-visible:ring-destructive/20",
                        )}
                      >
                        清空
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-start gap-2 text-xs"
                    >
                      <RotateCcw className="size-3.5" />
                      重置为默认数据
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        刷新后生效
                      </span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>重置为默认数据？</AlertDialogTitle>
                      <AlertDialogDescription>
                        将清除浏览器中的所有 CodeRAG
                        本地数据（会话、主题、偏好设置），页面刷新后恢复为初始示例数据。此操作无法撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleResetDefaults}
                        className={cn(
                          "bg-destructive text-white hover:bg-destructive/90",
                          "focus-visible:ring-destructive/20",
                        )}
                      >
                        重置并刷新
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </section>

          {/* 关于 */}
          <section className="space-y-1">
            <SectionHeader icon={Info} title="关于" />
            <div className="space-y-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">版本</span>
                <span className="font-mono text-xs font-medium text-foreground">
                  CodeRAG v1.0
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">技术栈</span>
                <span className="text-xs text-foreground">
                  Next.js 16 · TS · Tailwind 4 · shadcn/ui
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">检索模型</span>
                <span className="text-xs text-foreground">
                  bge-m3 · bge-reranker-v2-m3
                </span>
              </div>
              <a
                href="https://github.com/labring/FastGPT"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:border-brand/40 hover:bg-brand-soft"
              >
                <span className="text-muted-foreground">
                  参考实现：FastGPT
                </span>
                <span className="inline-flex items-center gap-1 text-brand">
                  访问
                  <ExternalLink className="size-3" />
                </span>
              </a>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
