// Building-block catalog (§5.1, Q9).
//
// Ideas may ONLY be composed from blocks in this catalog. The set of blocks a
// given team is allowed to use is the catalog INTERSECTED with the evidence found
// in their channel — so the bot can't propose, say, a GitHub Action unless the
// team actually showed signs of using CI. This is the deterministic anti-
// hallucination mechanism; it does not depend on "asking the LLM to be careful".

import type { BlockId } from "./types.js";

export interface Block {
  id: BlockId;
  label: string;
  /** Can the bot DO this itself, in Slack, or does it hand back an artifact? (Q10) */
  execution: "execute_in_slack" | "hand_back_artifact";
  /**
   * Keywords whose presence in channel history is treated as evidence the team
   * can use this block. Empty array = always available (pure Slack-native).
   */
  evidenceKeywords: string[];
  description: string;
}

export const CATALOG: Block[] = [
  {
    id: "slack_scheduled_message",
    label: "Slack scheduled message",
    execution: "execute_in_slack",
    evidenceKeywords: [], // native, always available
    description: "Post a recurring message / nudge on a schedule.",
  },
  {
    id: "slack_canvas",
    label: "Slack canvas",
    execution: "execute_in_slack",
    evidenceKeywords: [], // native, always available
    description: "Persist accepted ideas or a summary to a channel canvas.",
  },
  {
    id: "slack_workflow_step",
    label: "Slack Workflow Builder step",
    execution: "hand_back_artifact", // API support is thin; hand back the steps
    evidenceKeywords: [],
    description: "A no-code Workflow Builder step the user assembles.",
  },
  {
    id: "incoming_webhook",
    label: "Incoming webhook",
    execution: "hand_back_artifact",
    evidenceKeywords: ["webhook", "ci", "pipeline", "deploy", "build"],
    description: "An external system posts into Slack via an incoming webhook.",
  },
  {
    id: "github_action",
    label: "GitHub Action",
    execution: "hand_back_artifact",
    evidenceKeywords: ["github", "gh actions", "github actions", "workflow.yml", "pull request", "pr "],
    description: "A CI step in GitHub Actions that calls Slack.",
  },
  {
    id: "cron_script",
    label: "cron + script",
    execution: "hand_back_artifact",
    evidenceKeywords: ["cron", "script", "nightly", "scheduled job", "migration"],
    description: "A scheduled script that does work and reports to Slack.",
  },
];

const BY_ID = new Map(CATALOG.map((b) => [b.id, b]));

export function getBlock(id: BlockId): Block | undefined {
  return BY_ID.get(id);
}

/**
 * Discovered catalog (§5.1): keep a block if it is native (no evidence required)
 * or if at least one of its evidence keywords appears in the channel text.
 */
export function allowedBlocksFor(channelText: string): BlockId[] {
  const hay = channelText.toLowerCase();
  return CATALOG.filter(
    (b) => b.evidenceKeywords.length === 0 || b.evidenceKeywords.some((k) => hay.includes(k)),
  ).map((b) => b.id);
}
