"use client";

/**
 * 只读数据 hooks：把后端聚合接口拉下来并转成前端领域模型。
 *
 * - 仓库列表用 useSyncExternalStore 做模块级缓存，多个组件共享一次请求
 * - 模块 / 文件树 / 切片按需请求，组件卸载后丢弃结果
 * - 所有失败都落在 error 上，页面走既有空态，不用 mock 兜底
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { CodeModule, FileTreeNode, Repo } from "@/lib/rag/types";
import { useNavStore } from "@/lib/rag/store";
import { apiGet } from "./client";
import {
  toCodeModule,
  toCodeModuleDetail,
  toFileTree,
  toRepo,
  type ApiChunk,
  type ApiFileTree,
  type ApiModuleDetail,
  type ApiModulePage,
  type ApiRepo,
} from "./adapters";

/* ------------------------------ 仓库共享缓存 ------------------------------ */

interface ReposState {
  repos: Repo[];
  loading: boolean;
  error: string | null;
}

let reposState: ReposState = { repos: [], loading: false, error: null };
const repoListeners = new Set<() => void>();
let reposPromise: Promise<void> | null = null;

function emitRepos() {
  for (const listener of repoListeners) listener();
}

function setReposState(patch: Partial<ReposState>) {
  reposState = { ...reposState, ...patch };
  emitRepos();
}

function subscribeRepos(listener: () => void) {
  repoListeners.add(listener);
  return () => {
    repoListeners.delete(listener);
  };
}

function getReposSnapshot(): ReposState {
  return reposState;
}

/** 拉取仓库列表；已有缓存时不重复请求。force=true 可强制刷新。 */
export function loadRepos(force = false): Promise<void> {
  if (!force && reposState.repos.length > 0) return Promise.resolve();
  if (reposPromise) return reposPromise;

  setReposState({ loading: true, error: null });
  reposPromise = apiGet<ApiRepo[]>("/api/repos")
    .then((list) => {
      const repos = list.map(toRepo);
      setReposState({ repos, loading: false, error: null });
      // 首次拿到真实仓库后，把 localStorage 里遗留的 mock activeRepoId 校正为第一个仓库
      const nav = useNavStore.getState();
      if (!repos.some((repo) => repo.id === nav.activeRepoId) && repos[0]) {
        nav.setActiveRepoId(repos[0].id);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setReposState({ loading: false, error: message });
    })
    .finally(() => {
      reposPromise = null;
    });
  return reposPromise;
}

export function useRepos(): ReposState {
  const state = useSyncExternalStore(
    subscribeRepos,
    getReposSnapshot,
    getReposSnapshot,
  );
  useEffect(() => {
    void loadRepos();
  }, []);
  return state;
}

export function useRepoById(repoId: string | null | undefined): Repo | undefined {
  const { repos } = useRepos();
  return repoId ? repos.find((repo) => repo.id === repoId) : undefined;
}

/* -------------------------------- 模块列表 -------------------------------- */

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

const EMPTY_MODULES: CodeModule[] = [];

/** repoId 为 null 表示跨仓库。size=1000 覆盖当前 700 个模块。 */
export function useModules(repoId: string | null): AsyncState<CodeModule[]> {
  const [state, setState] = useState<AsyncState<CodeModule[]>>({
    data: EMPTY_MODULES,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: EMPTY_MODULES, loading: true, error: null });

    apiGet<ApiModulePage>("/api/modules", {
      repo_id: repoId ? Number(repoId) : undefined,
      size: 1000,
    })
      .then((page) => {
        if (cancelled) return;
        setState({ data: page.items.map(toCodeModule), loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: EMPTY_MODULES,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [repoId]);

  return state;
}

/* -------------------------------- 模块详情 -------------------------------- */

export function useModuleDetail(
  moduleId: string | null,
): AsyncState<CodeModule | null> {
  const [state, setState] = useState<AsyncState<CodeModule | null>>({
    data: null,
    loading: !!moduleId,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!moduleId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    apiGet<ApiModuleDetail>(`/api/modules/${moduleId}`)
      .then((detail) => {
        if (cancelled) return;
        setState({
          data: toCodeModuleDetail(detail),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  return state;
}

/* -------------------------------- 文件树 -------------------------------- */

export function useFileTree(repoId: string | null): AsyncState<FileTreeNode[]> {
  const [state, setState] = useState<AsyncState<FileTreeNode[]>>({
    data: [],
    loading: !!repoId,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!repoId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState({ data: [], loading: true, error: null });
    apiGet<ApiFileTree>(`/api/repos/${repoId}/tree`)
      .then((tree) => {
        if (cancelled) return;
        setState({ data: toFileTree(tree.items), loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [repoId]);

  return state;
}

/* -------------------------------- 文件切片 -------------------------------- */

export function useFileChunks(
  fileId: string | null,
  strategy?: "ast" | "fixed",
): AsyncState<ApiChunk[]> {
  const [state, setState] = useState<AsyncState<ApiChunk[]>>({
    data: [],
    loading: !!fileId,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!fileId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState({ data: [], loading: true, error: null });
    apiGet<ApiChunk[]>(`/api/files/${fileId}/chunks`, { strategy })
      .then((chunks) => {
        if (cancelled) return;
        setState({ data: chunks, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, strategy]);

  return state;
}
