// Build service — "Build this" behavior. Without a building-block catalog there's no
// reliable execute-in-Slack vs hand-back routing, so every idea is persisted to a Slack
// canvas (a real, shareable artifact) and its steps handed back. Honest about scope.
// ponytail: canvas-for-everything; re-add per-tool execution if a real integration lands.

import type { WebClient } from "@slack/web-api";
import { createCanvas } from "../../gateways/slack/slack.gateway.js";
import { log } from "../../shared/logger.js";
import type { Idea } from "../../shared/types.js";

export interface BuildOutcome {
  executed: boolean;
  message: string;
}

export async function buildIdea(client: WebClient, _channel: string, idea: Idea): Promise<BuildOutcome> {
  log("build.start", { idea: idea.title });
  const md =
    `# ${idea.title}\n\n**Problem:** ${idea.problem}\n\n**Trigger:** ${idea.trigger}\n\n` +
    `**Steps:**\n${idea.steps.map((s) => `- ${s}`).join("\n")}\n\n_Evidence: ${idea.triggeringEvidence}_`;
  const id = await createCanvas(client, idea.title, md);
  log("build.done", { idea: idea.title, canvas: id });
  return { executed: true, message: `:white_check_mark: Saved "${idea.title}" to a canvas (${id}). Want me to refine the steps?` };
}
