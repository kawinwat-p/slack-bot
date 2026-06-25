// Context service — retrieve channel text (via Slack gateway) + summarize (via LLM
// gateway) into friction patterns. Evidence signals are deterministic (catalog), not
// model-decided.

import type { WebClient } from "@slack/web-api";
import { getRecentText } from "../../gateways/slack/slack.gateway.js";
import { chat } from "../../gateways/llm/llm.gateway.js";
import { log } from "../../shared/logger.js";
import type { ContextSummary } from "../../shared/types.js";
import { allowedBlocksFor } from "../catalog/catalog.js";

export async function readChannelText(client: WebClient, channel: string): Promise<string> {
  const { text, count } = await getRecentText(client, channel);
  log("context.read", { channel, messages: count, chars: text.length });
  return text;
}

export async function summarizeContext(channelText: string): Promise<ContextSummary> {
  const evidenceSignals = allowedBlocksFor(channelText);
  log("context.evidence", evidenceSignals);

  if (!channelText.trim()) {
    return { patterns: [], evidenceSignals, notes: "No readable recent messages in this channel." };
  }

  const msg = await chat([
    {
      role: "system",
      content:
        "You distill a Slack channel's recent messages into recurring workflow friction. " +
        "Return 3-6 short, concrete patterns a teammate would recognize (e.g. " +
        '"deploys announced by hand x15", "daily \'why is staging down\' thread"). ' +
        "Quote specifics. Do not invent tools the channel never mentions. " +
        'Reply ONLY as JSON: {"patterns": string[], "notes": string}.',
    },
    { role: "user", content: `Recent messages (oldest first):\n"""\n${channelText.slice(-12000)}\n"""` },
  ]);

  const text = msg.content ?? "{}";
  let parsed: { patterns?: string[]; notes?: string } = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    parsed = { patterns: [], notes: "Could not parse summary." };
  }

  log("context.summarize", { patterns: parsed.patterns?.length ?? 0 });
  return { patterns: parsed.patterns ?? [], evidenceSignals, notes: parsed.notes ?? "" };
}
