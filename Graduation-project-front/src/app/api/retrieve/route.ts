import { NextResponse } from "next/server";
import { SOURCE_CHUNKS } from "@/lib/rag/mock-data";
import type { RetrievalResult, SourceChunk } from "@/lib/rag/types";

/**
 * /api/retrieve — mock retrieval backend.
 *
 * There is no real vector DB wired up yet, so this endpoint fakes retrieval by
 * sampling `topK` chunks from the in-memory `SOURCE_CHUNKS` mock and assigning
 * each a pseudo-random vector + rerank score. It gives the retrieval debug
 * panel and any future "re-retrieve" feature a real API surface to call
 * (instead of a pure client-side Math.random() in the component) — the shape
 * of the response matches `RetrievalResult[]` so the debug panel can render
 * the data unchanged.
 *
 * The scoring formula (0.86 baseline, -0.035 per rank, ±0.03 jitter) mirrors
 * the client-side mock in chat-page.tsx's `handleReRetrieve` so scores look
 * consistent across the two surfaces. Rerank score is always a small boost
 * above the raw score to mimic the "reranker improves relevance" behavior
 * the UI implies.
 *
 * Errors:
 *   500 → JSON parse failure or any unexpected throw. 400 is not used because
 *         every field has a sensible default (topK=5, query="", repoId="" ).
 */

const DEFAULT_TOP_K = 5;
const MIN_TOP_K = 1;
const MAX_TOP_K = 10;

interface RetrieveRequestBody {
  query?: string;
  topK?: number;
  repoId?: string;
}

function clampScore(n: number, min = 0.35, max = 0.95): number {
  return Math.max(min, Math.min(max, n));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RetrieveRequestBody;
    const requestedTopK = typeof body.topK === "number" ? body.topK : DEFAULT_TOP_K;
    const topK = Math.max(MIN_TOP_K, Math.min(MAX_TOP_K, Math.round(requestedTopK)));

    // Cycle through SOURCE_CHUNKS if topK exceeds the available mock pool so
    // the endpoint stays well-behaved even when the caller asks for 10 results
    // from a 5-chunk mock dataset.
    const picks: SourceChunk[] = [];
    for (let i = 0; i < topK; i++) {
      picks.push(SOURCE_CHUNKS[i % SOURCE_CHUNKS.length]);
    }

    const results: RetrievalResult[] = picks.map((chunk, i) => {
      const base = 0.86 - i * 0.035;
      const jitter = (Math.random() - 0.5) * 0.06;
      const score = clampScore(base + jitter);
      const rerankedScore = clampScore(score + 0.04 + (Math.random() - 0.5) * 0.08, 0.4, 0.97);
      return { chunk, score, rerankedScore };
    });

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/retrieve] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
