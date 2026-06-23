// Step 2: retrieve + summarize channel context (§3, Q8).
//
// Pull a wide window of recent messages, then run a CHEAP summarize pre-pass into
// recurring friction patterns. Evidence signals (which catalog blocks the team can
// use) come from deterministic keyword matching, NOT the LLM. Summarizing keeps the
// opening question sharp and keeps us inside the context window.

import type { WebClient } from "@slack/web-api";
import { allowedBlocksFor } from "./catalog.js";
import { chat } from "./llm.js";
import type { ContextSummary } from "./types.js";

const HISTORY_LIMIT = 200;

export async function readChannelText(client: WebClient, channel: string): Promise<string> {
  const res = await client.conversations.history({ channel, limit: HISTORY_LIMIT });
  const msgs = (res.messages ?? [])
    .filter((m) => typeof m.text === "string" && m.text.length > 0)
    .reverse(); // oldest -> newest
  return msgs.map((m) => m.text).join("\n");
}

export async function summarizeContext(channelText: string): Promise<ContextSummary> {
  // Evidence signals are deterministic (§5.1), not model-decided.
  const evidenceSignals = allowedBlocksFor(channelText);

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
    {
      role: "user",
      content: `Recent messages (oldest first):\n"""\n${channelText.slice(-12000)}\n"""`,
    },
  ]);

  const text = msg.content ?? "{}";
  let parsed: { patterns?: string[]; notes?: string } = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    parsed = { patterns: [], notes: "Could not parse summary." };
  }

  return {
    patterns: parsed.patterns ?? [],
    evidenceSignals,
    notes: parsed.notes ?? "",
  };
}
