// Context service — retrieve raw channel text (via Slack gateway) + distill it (via LLM
// gateway) into three things the interview needs: the tools the company uses, a short
// summary, and the recurring pain points. The optional userPrompt (text typed after the
// slash command) steers the distillation.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebClient } from "@slack/web-api";
import { getRecentText } from "../../gateways/slack/slack.gateway.js";
import { chat } from "../../gateways/llm/llm.gateway.js";
import { log } from "../../shared/logger.js";
import type { ContextSummary } from "../../shared/types.js";

export async function readChannelText(client: WebClient, channel: string): Promise<string> {
  const { text, count } = await getRecentText(client, channel);
  log("context.read", { channel, messages: count, chars: text.length });
  // chat ดิบเต็ม ๆ เขียนลงไฟล์ (คอนโซลตัดบรรทัดยาว) เปิดดูครบที่ path ด้านล่าง
  const file = join(process.cwd(), ".state", `raw-${channel}.txt`);
  writeFileSync(file, text);
  log("context.raw", { file, chars: text.length });
  return text;
}

export async function summarizeContext(channelText: string, userPrompt = ""): Promise<ContextSummary> {
  if (!channelText.trim()) {
    return { tools: [], summary: "No readable recent messages in this channel.", painPoints: [] };
  }

  const focus = userPrompt.trim() ? `\n\nThe user is specifically interested in: "${userPrompt.trim()}". Bias the distillation toward that.` : "";

  const msg = await chat([
    {
      role: "system",
      content:
        "You distill a Slack channel's recent messages into three things, grounded ONLY in what the chat actually says — never invent tools or facts. " +
        "1) tools: the tools/services/systems the company uses, as named in the chat (e.g. GitHub, Jira, Datadog). " +
        "2) summary: 2-4 sentences on what this channel is about and how the team works. " +
        "3) painPoints: 3-6 concrete recurring frictions, quoting specifics (e.g. \"deploys announced by hand\", \"daily 'why is staging down' thread\"). " +
        'Reply ONLY as JSON: {"tools": string[], "summary": string, "painPoints": string[]}.',
    },
    { role: "user", content: `Recent messages (oldest first):\n"""\n${channelText.slice(-60000)}\n"""${focus}` },
  ], undefined, true, 4000);

  const text = msg.content ?? "{}";
  let parsed: Partial<ContextSummary> = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    log("context.parse_fail", { raw: text.slice(0, 500) });
    parsed = { summary: "Could not parse summary." };
  }

  const result: ContextSummary = {
    tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints.map(String) : [],
  };
  log("context.summarize", { tools: result.tools.length, pains: result.painPoints.length });
  return result;
}
