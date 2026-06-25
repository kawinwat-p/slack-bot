// Build service — "Build this" behavior per block. Mixed per-block: blocks the bot can
// reach (Slack) are executed via the Slack gateway; blocks outside Slack (CI/GitHub/
// cron) return a ready-to-paste artifact. Honest about what it can and cannot do.

import type { WebClient } from "@slack/web-api";
import { createCanvas, scheduleMessage } from "../../gateways/slack/slack.gateway.js";
import { log } from "../../shared/logger.js";
import type { Idea } from "../../shared/types.js";
import { getBlock } from "../catalog/catalog.js";

export interface BuildOutcome {
  executed: boolean;
  message: string;
}

/** Blast radius = creates something others will see (a scheduled channel post). */
export function isBlastRadius(idea: Idea): boolean {
  return idea.blocks[0] === "slack_scheduled_message";
}

export async function buildIdea(client: WebClient, channel: string, idea: Idea): Promise<BuildOutcome> {
  const primary = idea.blocks[0];
  const block = getBlock(primary);
  log("build.start", { idea: idea.title, block: primary });

  if (block?.execution === "execute_in_slack") {
    const out = await executeInSlack(client, channel, idea, primary);
    log("build.done", { idea: idea.title, executed: out.executed });
    return out;
  }
  log("build.done", { idea: idea.title, executed: false, kind: "artifact" });
  return { executed: false, message: artifactFor(idea, primary) };
}

async function executeInSlack(client: WebClient, channel: string, idea: Idea, block: string): Promise<BuildOutcome> {
  if (block === "slack_scheduled_message") {
    const postAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    await scheduleMessage(client, channel, postAt, `:robot_face: *${idea.title}* — ${idea.steps[0] ?? "scheduled nudge"}`);
    return { executed: true, message: `:white_check_mark: Scheduled a live "${idea.title}" message for ~24h from now. I can change the cadence — just say the word.` };
  }

  if (block === "slack_canvas") {
    const md =
      `# ${idea.title}\n\n**Problem:** ${idea.problem}\n\n**Trigger:** ${idea.trigger}\n\n` +
      `**Steps:**\n${idea.steps.map((s) => `- ${s}`).join("\n")}\n\n_Evidence: ${idea.triggeringEvidence}_`;
    const id = await createCanvas(client, idea.title, md);
    return { executed: true, message: `:white_check_mark: Saved "${idea.title}" to a canvas (${id}).` };
  }

  return { executed: false, message: artifactFor(idea, block) };
}

function artifactFor(idea: Idea, block: string): string {
  switch (block) {
    case "github_action":
      return [
        `Here's a drop-in GitHub Actions step for *${idea.title}*:`,
        "```yaml",
        `- name: Notify Slack — ${idea.title}`,
        "  if: ${{ always() }}",
        "  run: |",
        '    curl -X POST "$SLACK_WEBHOOK_URL" \\',
        "      -H 'Content-type: application/json' \\",
        `      -d '{"text":"${idea.title}: \${{ github.repository }} run \${{ github.run_id }}"}'`,
        "```",
        "Add `SLACK_WEBHOOK_URL` to your repo secrets. Want a GitLab CI version?",
      ].join("\n");
    case "incoming_webhook":
      return [
        `Create an incoming webhook, then have your system POST to it for *${idea.title}*:`,
        "```bash",
        'curl -X POST "$SLACK_WEBHOOK_URL" \\',
        "  -H 'Content-type: application/json' \\",
        `  -d '{"text":"${idea.title}"}'`,
        "```",
      ].join("\n");
    case "cron_script":
      return [
        `Schedule a script for *${idea.title}*:`,
        "```cron",
        `0 9 * * 1-5  /usr/bin/node /opt/jobs/${idea.id}.js  # ${idea.trigger}`,
        "```",
        "The script does the steps above and POSTs the result to your Slack webhook.",
      ].join("\n");
    case "slack_workflow_step":
      return [`Build this in Workflow Builder (Tools ▸ Workflow Builder ▸ New):`, ...idea.steps.map((s, i) => `${i + 1}. ${s}`)].join("\n");
    default:
      return `Steps for ${idea.title}:\n${idea.steps.map((s) => `• ${s}`).join("\n")}`;
  }
}
