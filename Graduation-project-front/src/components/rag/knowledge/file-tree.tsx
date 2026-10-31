"use client";

import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { FileTreeNode } from "@/lib/rag/types";
import { LANGUAGE_META } from "@/components/rag/shared/meta";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  nodes: FileTreeNode[];
  defaultExpanded?: boolean;
  onSelect?: (node: FileTreeNode) => void;
  /**
   * Controlled expanded set of dir paths. When provided together with
   * `setExpanded`, the tree switches to controlled mode and the parent
   * owns the expansion state (used to power collapse/expand-all buttons).
   */
  expanded?: Set<string>;
  /**
   * Setter for the controlled expanded set. Receives the next Set (not an
   * updater). Required when `expanded` is provided.
   */
  setExpanded?: (next: Set<string>) => void;
}

/**
 * Walk a tree and collect every directory's path. Powers "expand all" /
 * initial-expand-all behavior so callers don't re-implement the traversal.
 */
export function collectDirPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileTreeNode[]) => {
    for (const n of ns) {
      if (n.type === "dir") {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export function FileTree({
  nodes,
  defaultExpanded = false,
  onSelect,
  expanded: controlledExpanded,
  setExpanded: controlledSetExpanded,
}: FileTreeProps) {
  const initial = useMemo(() => {
    if (!defaultExpanded) return new Set<string>();
    return new Set(collectDirPaths(nodes));
  }, [nodes, defaultExpanded]);

  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(initial);

  // Controlled mode wins when both `expanded` and `setExpanded` are supplied.
  const expanded = controlledExpanded ?? internalExpanded;

  function toggle(path: string) {
    if (controlledExpanded && controlledSetExpanded) {
      const next = new Set(controlledExpanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      controlledSetExpanded(next);
    } else {
      setInternalExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }
  }

  return (
    <div className="text-[13px]">
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  expanded,
  onToggle,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect?: (node: FileTreeNode) => void;
  depth: number;
}) {
  const isOpen = expanded.has(node.path);
  const indent = depth * 12 + 6;

  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left transition-colors hover:bg-accent"
          style={{ paddingLeft: indent }}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {isOpen ? (
            <FolderOpen className="size-4 shrink-0 text-brand" />
          ) : (
            <Folder className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {node.chunkCount} 切片
          </span>
        </button>
        {isOpen && node.children && node.children.length > 0 && (
          <div className="ml-2 border-l border-border/60 pl-3">
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const lang = node.language ? LANGUAGE_META[node.language] : null;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(node)}
      className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left transition-colors hover:bg-accent"
      style={{ paddingLeft: indent + 18 }}
    >
      {lang ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", lang.dot)} />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      )}
      <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {node.chunkCount} 切片 · {node.lineCount} 行
      </span>
    </button>
  );
}
