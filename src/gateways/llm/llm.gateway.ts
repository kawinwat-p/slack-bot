// LLM gateway — OpenRouter via the OpenAI-compatible SDK.
//
// OpenRouter exposes an OpenAI-compatible /chat/completions endpoint (no Anthropic-
// native /v1/messages). Swap the model with OPENROUTER_MODEL; use a slug that exists
// in your account (https://openrouter.ai/models). Examples that support tool calling:
// "anthropic/claude-opus-4.8", "anthropic/claude-opus-4.8-fast", "openai/gpt-5.5".

import OpenAI from "openai";
import { log } from "../../shared/logger.js";
import type { ChatMsg, ChatTool } from "../../shared/types.js";

export const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://example.com",
    "X-Title": "Workflow Ideas Bot",
  },
});

export const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-4.8-fast";

/** One round-trip to the model. Returns the assistant message verbatim.
 *  jsonMode forces a bare JSON object back (no prose/fences) — needs "json" in the prompt. */
export async function chat(
  messages: ChatMsg[],
  tools?: ChatTool[],
  jsonMode = false,
  maxTokens = 1200,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const t0 = Date.now();
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages,
    ...(tools ? { tools, tool_choice: "auto" } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  log("llm.call", { model: MODEL, ms: Date.now() - t0, tokens: res.usage?.total_tokens ?? null });
  return res.choices[0].message;
}
