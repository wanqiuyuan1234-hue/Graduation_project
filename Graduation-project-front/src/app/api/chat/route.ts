import { NextResponse } from "next/server";
import ZAI, { type ChatMessage as ZaiChatMessage } from "z-ai-web-dev-sdk";
import type { ChatMessage } from "@/lib/rag/types";

/**
 * /api/chat — CodeRAG chat backend.
 *
 * Accepts the app-side `ChatMessage[]` (which carry id / timestamp / citations
 * etc. that the LLM does not care about), projects them down to the SDK's
 * `{ role, content }` shape, prepends a CodeRAG system prompt, and asks
 * `z-ai-web-dev-sdk` for a completion.
 *
 * The response is a plain JSON `{ content }` — the client (chat-page.tsx)
 * simulates a token-streaming typewriter effect on top of this real content,
 * so we do NOT need a true SSE / ReadableStream implementation here. Keeping
 * the transport simple means the SDK's non-streaming `chat.completions.create`
 * is sufficient and the client's existing `streamReply` pipeline keeps working
 * unchanged.
 *
 * Errors:
 *   400 → malformed body (no messages / wrong shape).
 *   500 → SDK init failure, network error, empty completion, or any thrown
 *         exception. The client falls back to its mock `generateReply` on any
 *         non-2xx, so the app stays functional even when the API key is not
 *         configured or the upstream LLM is unavailable.
 */

// Keep the system prompt in Chinese to match the product UI language and the
// mock-reply tone. Markdown is requested so the existing `prose-chat` styling
// (headings / lists / code blocks) renders correctly.
const SYSTEM_PROMPT =
  "你是 CodeRAG 代码仓库问答助手。基于检索到的代码片段回答问题，回答用中文 Markdown 格式。" +
  "如果问题与代码无关，礼貌说明你专注于代码问答。";

// Cap the conversation history sent to the LLM to the last 10 turns so we
// don't blow past the model's context window on long sessions. The user's
// most recent message is always included because the client appends it to the
// history array before calling.
const MAX_HISTORY = 10;

interface ChatRequestBody {
  messages?: ChatMessage[];
  repoId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "messages is required and must be a non-empty array" },
        { status: 400 },
      );
    }

    // Project app-side ChatMessage[] → SDK ChatMessage[]: keep only the last
    // MAX_HISTORY user/assistant turns, drop system (we add our own), drop all
    // the citation / retrieval / tokens metadata that the LLM doesn't need.
    const history: ZaiChatMessage[] = body.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    const sdkMessages: ZaiChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ];

    // ZAI.create() reads API key / base URL from env. If the env is not
    // configured, this throws and we return a 500 → client falls back to mock.
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: sdkMessages,
      thinking: { type: "disabled" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    if (!content) {
      return NextResponse.json(
        { error: "LLM returned empty content" },
        { status: 502 },
      );
    }

    return NextResponse.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
