// Building-block catalog. Ideas may ONLY be composed from blocks here, and the set a
// team is allowed to use = catalog ∩ evidence found in their channel. Deterministic
// anti-hallucination — does not depend on "asking the LLM to be careful".

import type { BlockId } from "../../shared/types.js";

export interface Block {
  id: BlockId;
  label: string;
  execution: "execute_in_slack" | "hand_back_artifact";
  /** Keywords whose presence in channel text = evidence the team can use this block. */
  evidenceKeywords: string[];
  description: string;
}

export const CATALOG: Block[] = [
  { id: "slack_scheduled_message", label: "Slack scheduled message", execution: "execute_in_slack", evidenceKeywords: [], description: "Post a recurring message / nudge on a schedule." },
  { id: "slack_canvas", label: "Slack canvas", execution: "execute_in_slack", evidenceKeywords: [], description: "Persist accepted ideas or a summary to a channel canvas." },
  { id: "slack_workflow_step", label: "Slack Workflow Builder step", execution: "hand_back_artifact", evidenceKeywords: [], description: "A no-code Workflow Builder step the user assembles." },
  { id: "incoming_webhook", label: "Incoming webhook", execution: "hand_back_artifact", evidenceKeywords: ["webhook", "ci", "pipeline", "deploy", "build"], description: "An external system posts into Slack via an incoming webhook." },
  { id: "github_action", label: "GitHub Action", execution: "hand_back_artifact", evidenceKeywords: ["github", "gh actions", "github actions", "workflow.yml", "pull request", "pr "], description: "A CI step in GitHub Actions that calls Slack." },
  { id: "cron_script", label: "cron + script", execution: "hand_back_artifact", evidenceKeywords: ["cron", "script", "nightly", "scheduled job", "migration"], description: "A scheduled script that does work and reports to Slack." },
];

const BY_ID = new Map(CATALOG.map((b) => [b.id, b]));

export function getBlock(id: BlockId): Block | undefined {
  return BY_ID.get(id);
}

/** Discovered catalog: native blocks always allowed; others need an evidence keyword. */
export function allowedBlocksFor(channelText: string): BlockId[] {
  const hay = channelText.toLowerCase();
  return CATALOG.filter(
    (b) => b.evidenceKeywords.length === 0 || b.evidenceKeywords.some((k) => hay.includes(k)),
  ).map((b) => b.id);
}
