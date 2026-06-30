// Context service — retrieve raw channel text (via Slack gateway) + distill it (via LLM
// gateway) into three things the interview needs: the tools the company uses, a short
// summary, and the recurring pain points. The optional userPrompt (text typed after the
// slash command) steers the distillation.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebClient } from "@slack/web-api";
import { getRecentMessages } from "../../gateways/slack/slack.gateway.js";
import { chat } from "../../gateways/llm/llm.gateway.js";
import { log } from "../../shared/logger.js";
import type { ContextSummary } from "../../shared/types.js";

const MAX_MESSAGES = 1000; // latest 1000 messages, thread replies counted in

function dumpRaw(channel: string, messages: string[]): void {
  const file = join(process.cwd(), ".state", `raw-${channel}.txt`);
  writeFileSync(file, messages.join("\n")); // full raw chat (console truncates long lines)
  log("context.raw", { file, messages: messages.length });
}

/** Choose the messages to summarize: always use the latest ~1000 messages. */
export async function gatherContextText(
  client: WebClient,
  channel: string,
  userPrompt: string,
): Promise<string> {
  const messages = await getRecentMessages(client, channel, MAX_MESSAGES);
  log("context.read", { channel, messages: messages.length });
  dumpRaw(channel, messages);
  return messages.join("\n");
}

export async function summarizeContext(
  channelText: string,
  userPrompt = "",
): Promise<ContextSummary> {
  if (!channelText.trim()) {
    return {
      tools: [],
      summary: "No readable recent messages in this channel.",
      painPoints: [],
    };
  }

  const focus = userPrompt.trim()
    ? `\n\nThe user is specifically interested in: "${userPrompt.trim()}". Bias the distillation toward that.`
    : "";

  const msg = await chat(
    [
      {
        role: "system",
        content: [
          "# Persona",
          "You are a precise analyst who distills Slack channel history into structured, evidence-grounded summaries. You never invent tools or facts that aren't in the chat.",
          "",
          "# Task",
          "Read the recent messages and produce three things:",
          "1) tools — the tools/services/systems the company uses, exactly as named in the chat (e.g. GitHub, Jira, Datadog).",
          "2) summary — 2-4 sentences on what this channel is about and how the team works.",
          '3) painPoints — 3-6 concrete recurring frictions, quoting specifics (e.g. "deploys announced by hand", "daily \'why is staging down\' thread").',
          "",
          "# Context",
          "The input is the channel's recent messages, oldest first. Ground every item ONLY in what the chat actually says — if something isn't mentioned, leave it out. Do not infer tools, teams, or problems that aren't stated.",
          "",
          "# Format",
          'Reply ONLY as JSON: {"tools": string[], "summary": string, "painPoints": string[]}. No prose, no markdown fences.',
        ].join("\n"),
      },
      {
        role: "user",
        content: `Recent messages (oldest first):\n"""\n${channelText.slice(-60000)}\n"""${focus}`,
      },
    ],
    undefined,
    true,
    4000,
  );

  const text = msg.content ?? "{}";
  let parsed: Partial<ContextSummary> = {};
  try {
    parsed = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    );
  } catch {
    log("context.parse_fail", { raw: text.slice(0, 500) });
    parsed = { summary: "Could not parse summary." };
  }

  const result: ContextSummary = {
    tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    painPoints: Array.isArray(parsed.painPoints)
      ? parsed.painPoints.map(String)
      : [],
  };
  log("context.summarize", {
    tools: result.tools.length,
    pains: result.painPoints.length,
  });
  return result;
}
