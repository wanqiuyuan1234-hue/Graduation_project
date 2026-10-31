"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, FileCode2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/rag/types";
import { LANGUAGE_META } from "@/components/rag/shared/meta";
import { Button } from "@/components/ui/button";

export interface CodeViewerProps {
  code: string;
  language: Language;
  highlights?: { start: number; end: number; active?: boolean }[];
  onLineClick?: (line: number) => void;
}

/* Per-language file-type icon color. We keep FileCode2 as the single icon
   (per task spec — "use FileCode2 to be safe") and vary its tint by language
   so the toolbar still encodes the language family visually. All color
   classes are static literals so the Tailwind JIT picks them up. */
const LANGUAGE_ICON: Record<Language, { icon: typeof FileCode2; tint: string }> = {
  typescript: { icon: FileCode2, tint: "text-blue-500" },
  tsx: { icon: FileCode2, tint: "text-cyan-500" },
  javascript: { icon: FileCode2, tint: "text-yellow-500" },
  jsx: { icon: FileCode2, tint: "text-amber-500" },
  python: { icon: FileCode2, tint: "text-emerald-500" },
  go: { icon: FileCode2, tint: "text-sky-500" },
  rust: { icon: FileCode2, tint: "text-orange-500" },
};

/** Format a character count as a compact human string:
 *  < 1000 → "800"; < 10000 → "1.2k"; else → "13k" (rounded). */
function formatCharCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

type TokenType =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "function"
  | "jsxTag"
  | "plain";

interface Token {
  type: TokenType;
  value: string;
}

interface HighlightRange {
  start: number;
  end: number;
  active: boolean;
}

const TS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "break", "continue", "default", "class", "extends", "implements",
  "interface", "type", "enum", "namespace", "import", "export", "from", "as", "async",
  "await", "new", "this", "super", "typeof", "instanceof", "in", "of", "void", "delete",
  "yield", "static", "public", "private", "protected", "readonly", "abstract", "declare",
  "get", "set", "try", "catch", "finally", "throw", "null", "undefined", "true", "false",
  "number", "string", "boolean", "any", "unknown", "never", "object", "symbol", "bigint",
  "is", "keyof", "infer", "satisfies", "override",
]);

const PY_KEYWORDS = new Set([
  "def", "class", "return", "if", "elif", "else", "for", "while", "break", "continue",
  "import", "from", "as", "try", "except", "finally", "raise", "with", "lambda", "yield",
  "global", "nonlocal", "pass", "assert", "del", "in", "is", "not", "and", "or", "True",
  "False", "None", "self", "cls", "async", "await",
]);

const GO_KEYWORDS = new Set([
  "package", "import", "func", "var", "const", "type", "struct", "interface", "return",
  "if", "else", "for", "switch", "case", "default", "break", "continue", "fallthrough",
  "go", "defer", "select", "chan", "map", "range", "nil", "true", "false",
]);

const RUST_KEYWORDS = new Set([
  "fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl", "pub", "use",
  "mod", "crate", "self", "Self", "super", "as", "in", "if", "else", "for", "while", "loop",
  "match", "return", "break", "continue", "ref", "move", "async", "await", "dyn", "unsafe",
  "extern", "true", "false",
]);

function getKeywords(language: Language): Set<string> {
  if (language === "python") return PY_KEYWORDS;
  if (language === "go") return GO_KEYWORDS;
  if (language === "rust") return RUST_KEYWORDS;
  return TS_KEYWORDS;
}

function tokenize(code: string, language: Language): Token[] {
  const keywords = getKeywords(language);
  const isPy = language === "python";
  const isJsx = language === "tsx" || language === "jsx";
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;
  const push = (type: TokenType, value: string) => tokens.push({ type, value });

  while (i < n) {
    const ch = code[i];
    const rest = code.slice(i);

    // Line comment // (not python)
    if (!isPy && ch === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Block comment /* */
    if (!isPy && ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Python # comment
    if (isPy && ch === "#") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Python triple-quoted strings
    if (isPy && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const quote = rest.startsWith('"""') ? '"""' : "'''";
      const end = code.indexOf(quote, i + 3);
      const stop = end === -1 ? n : end + 3;
      push("string", code.slice(i, stop));
      i = stop;
      continue;
    }
    // Strings: ', ", `
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      push("string", code.slice(i, j));
      i = j;
      continue;
    }
    // Numbers
    if (ch >= "0" && ch <= "9") {
      const m = rest.match(/^[0-9][0-9_]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?/);
      const text = m && m[0] ? m[0] : ch;
      push("number", text);
      i += text.length;
      continue;
    }
    // JSX tags: <Component or </Component
    if (isJsx && ch === "<") {
      const m = rest.match(/^<\/([A-Z][\w.]*)/);
      if (m) {
        push("plain", "</");
        i += 2;
        push("jsxTag", m[1]);
        i += m[1].length;
        continue;
      }
      const m2 = rest.match(/^<([A-Z][\w.]*)/);
      if (m2) {
        push("plain", "<");
        i += 1;
        push("jsxTag", m2[1]);
        i += m2[1].length;
        continue;
      }
    }
    // Identifiers (letters, $, _)
    if (/[A-Za-z_$]/.test(ch)) {
      const m = rest.match(/^[A-Za-z_$][\w$]*/);
      const text = m && m[0] ? m[0] : ch;
      // Check if followed by ( (function call) — skip whitespace
      let k = i + text.length;
      while (k < n && /\s/.test(code[k])) k++;
      const isCall = code[k] === "(";
      if (keywords.has(text)) {
        push("keyword", text);
      } else if (isCall) {
        push("function", text);
      } else {
        push("plain", text);
      }
      i += text.length;
      continue;
    }
    // Default: single char
    push("plain", ch);
    i++;
  }
  return tokens;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  keyword: "text-violet-600",
  string: "text-emerald-600",
  comment: "text-muted-foreground italic",
  number: "text-amber-600",
  function: "text-sky-600",
  jsxTag: "text-rose-700",
  plain: "",
};

function renderHighlighted(code: string, language: Language): ReactNode[][] {
  const tokens = tokenize(code, language);
  const lines: ReactNode[][] = [[]];
  let key = 0;
  for (const tok of tokens) {
    const parts = tok.value.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) {
        lines.push([]);
      }
      if (part) {
        const cls = TOKEN_CLASS[tok.type];
        if (cls) {
          lines[lines.length - 1].push(
            <span key={key++} className={cls}>
              {part}
            </span>,
          );
        } else {
          lines[lines.length - 1].push(<span key={key++}>{part}</span>);
        }
      }
    });
  }
  return lines;
}

export function CodeViewer({ code, language, highlights, onLineClick }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => renderHighlighted(code, language), [code, language]);

  const ranges: HighlightRange[] = useMemo(
    () => (highlights ?? []).map((h) => ({ start: h.start, end: h.end, active: !!h.active })),
    [highlights],
  );

  const lineHighlightMap = useMemo(() => {
    const map = new Map<number, HighlightRange>();
    for (const r of ranges) {
      for (let ln = r.start; ln <= r.end; ln++) {
        const existing = map.get(ln);
        if (!existing || (r.active && !existing.active)) {
          map.set(ln, r);
        }
      }
    }
    return map;
  }, [ranges]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("代码已复制到剪贴板");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败，请手动选择代码");
    }
  };

  const langMeta = LANGUAGE_META[language];
  const langIcon = LANGUAGE_ICON[language];
  const LangIcon = langIcon.icon;
  const charCount = useMemo(() => formatCharCount(code.length), [code]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Language chip — file-type icon + language label, tinted by family */}
          <span className={cn("code-lang-chip", langMeta.badge)}>
            <LangIcon className={cn("size-3.5", langIcon.tint)} />
            <span>{langMeta.label}</span>
          </span>
          {/* Separator + stats: line count · char count (compact, mono) */}
          <span aria-hidden className="text-[10px] leading-none text-muted-foreground/40">
            ·
          </span>
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
            {lines.length} 行 · {charCount} 字符
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5 px-2 text-[12px]"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>

      {/* Code body */}
      <div className="max-h-[600px] overflow-auto bg-card font-mono text-[12.5px] leading-[1.65] scrollbar-thin">
        {lines.map((lineNodes, i) => {
          const lineNum = i + 1;
          const hl = lineHighlightMap.get(lineNum) ?? null;
          const rowBg = hl ? (hl.active ? "bg-brand-soft" : "bg-brand-soft/40") : "";
          const gutterBg = hl
            ? hl.active
              ? "bg-brand-soft"
              : "bg-brand-soft/40"
            : "bg-muted/40";
          // Left gutter marker — a 2px brand bar that fades in via the
          // `.code-line-highlight` ::before pseudo-element. Replaces the
          // previous static `border-l-2 border-l-brand` so the marker has
          // a subtle entrance animation. `--muted` variant for inactive rows.
          const hlMarker = hl
            ? hl.active
              ? "code-line-highlight"
              : "code-line-highlight code-line-highlight--muted"
            : "";
          return (
            <div key={lineNum} className={cn("flex min-w-full", rowBg)}>
              <span
                onClick={() => onLineClick?.(lineNum)}
                className={cn(
                  "sticky left-0 z-10 inline-block w-14 shrink-0 select-none border-r border-border px-3 text-right text-muted-foreground",
                  gutterBg,
                  hlMarker,
                  onLineClick && "cursor-pointer",
                )}
              >
                {lineNum}
              </span>
              <code className="whitespace-pre px-3">
                {lineNodes.length > 0 ? lineNodes : "\u00A0"}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
