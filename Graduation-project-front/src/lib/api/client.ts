/**
 * 后端只读接口的最小 HTTP 客户端。
 *
 * 统一约定：
 * - 基地址来自 NEXT_PUBLIC_API_BASE，默认 http://localhost:8000
 * - 所有请求走 `apiGet`，非 2xx 抛 ApiError
 * - 不缓存（后端是本地实时查询）
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type QueryValue = string | number | boolean | undefined | null;

export async function apiGet<T>(
  path: string,
  params?: Record<string, QueryValue>,
): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`无法连接后端 ${API_BASE}`, 0);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body?.detail) detail = String(body.detail);
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new ApiError(detail || `请求失败（${res.status}）`, res.status);
  }

  return (await res.json()) as T;
}
