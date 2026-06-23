// LLM layer — OpenRouter via the OpenAI-compatible SDK.
//
// OpenRouter exposes an OpenAI-compatible /chat/completions endpoint (no Anthropic-
// native /v1/messages), so we use the `openai` SDK with a custom baseURL. Swap the
// model with OPENROUTER_MODEL (e.g. "anthropic/claude-3.5-sonnet", "openai/gpt-4o",
// "google/gemini-2.0-flash-001"). Tool calling works across most of these.

import OpenAI from "openai";

export const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  defaultHeaders: {
    // Optional but recommended by OpenRouter for attribution / rankings.
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://example.com",
    "X-Title": "Workflow Ideas Bot",
  },
});

export const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet";

export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** One round-trip to the model. Returns the assistant message verbatim. */
export async function chat(
  messages: ChatMsg[],
  tools?: ChatTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1200,
    messages,
    ...(tools ? { tools, tool_choice: "auto" } : {}),
  });
  return res.choices[0].message;
}
