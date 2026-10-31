import {
  Boxes,
  Code2,
  Database,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import type { Language, ModuleType } from "@/lib/rag/types";

export interface NavItem {
  id: "modules" | "chat" | "knowledge";
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "modules", label: "模块浏览", icon: Boxes, description: "代码模块卡片" },
  { id: "chat", label: "对话问答", icon: MessageSquareText, description: "RAG 问答" },
  { id: "knowledge", label: "知识库", icon: Database, description: "仓库与切片" },
];

export const MODULE_TYPE_META: Record<ModuleType, { label: string; color: string; dot: string }> = {
  function: { label: "函数", color: "text-emerald-600 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  class: { label: "类", color: "text-violet-600 bg-violet-50 border-violet-200", dot: "bg-violet-500" },
  component: { label: "组件", color: "text-brand-soft-foreground bg-brand-soft border-brand/20", dot: "bg-brand" },
  hook: { label: "Hook", color: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  util: { label: "工具", color: "text-sky-600 bg-sky-50 border-sky-200", dot: "bg-sky-500" },
  service: { label: "服务", color: "text-rose-600 bg-rose-50 border-rose-200", dot: "bg-rose-500" },
  config: { label: "配置", color: "text-slate-600 bg-slate-100 border-slate-200", dot: "bg-slate-500" },
  page: { label: "页面", color: "text-indigo-600 bg-indigo-50 border-indigo-200", dot: "bg-indigo-500" },
};

export const LANGUAGE_META: Record<Language, { label: string; badge: string; dot: string }> = {
  typescript: { label: "TypeScript", badge: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  tsx: { label: "TSX", badge: "bg-cyan-50 text-cyan-700 border-cyan-200", dot: "bg-cyan-500" },
  javascript: { label: "JavaScript", badge: "bg-yellow-50 text-yellow-700 border-yellow-200", dot: "bg-yellow-500" },
  jsx: { label: "JSX", badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  python: { label: "Python", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  go: { label: "Go", badge: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
  rust: { label: "Rust", badge: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
};

export const STATUS_META: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  synced: { label: "已同步", color: "text-emerald-600 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  syncing: { label: "同步中", color: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-500 animate-pulse" },
  failed: { label: "同步失败", color: "text-rose-600 bg-rose-50 border-rose-200", dot: "bg-rose-500" },
  pending: { label: "等待中", color: "text-slate-600 bg-slate-100 border-slate-200", dot: "bg-slate-400" },
};

export const COMPLEXITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "低复杂度", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  medium: { label: "中复杂度", color: "text-amber-600 bg-amber-50 border-amber-200" },
  high: { label: "高复杂度", color: "text-rose-600 bg-rose-50 border-rose-200" },
};

export const CodeIcon = Code2;
