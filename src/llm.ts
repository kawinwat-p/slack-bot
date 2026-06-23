// LLM layer — OpenRouter via the OpenAI-compatible SDK.
//
// OpenRouter exposes an OpenAI-compatible /chat/completions endpoint (no Anthropic-
// native /v1/messages), so we use the `openai` SDK with a custom baseURL. Swap the
// model with OPENROUTER_MODEL. Use a slug that exists in your OpenRouter account —
// check https://openrouter.ai/models (IDs change over time). Examples that support
// tool calling: "anthropic/claude-opus-4.8", "anthropic/claude-opus-4.8-fast",
// "openai/gpt-5.5", "google/gemini-3.5-flash".

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

export const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-4.8-fast";

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
