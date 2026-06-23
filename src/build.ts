// "Build this" behavior per block (§6, Q10).
//
// Mixed per-block: blocks the bot can actually reach (Slack) are EXECUTED for real;
// blocks outside Slack (CI / GitHub / cron) return a ready-to-paste artifact. The bot
// is honest about what it can and cannot do — it never pretends to wire into a repo.

import type { WebClient } from "@slack/web-api";
import { getBlock } from "./catalog.js";
import type { Idea } from "./types.js";

export interface BuildOutcome {
  executed: boolean; // did we actually perform a side effect in Slack?
  message: string; // what to post back to the user
}

/**
 * Tiered approval (§4.4, Q4): a build is "blast radius" if it creates something other
 * people will see (a scheduled message posts into the channel on a cadence). Those
 * require a Confirm click. Self-contained builds (canvas) and artifact hand-offs run free.
 */
export function isBlastRadius(idea: Idea): boolean {
  return idea.blocks[0] === "slack_scheduled_message";
}

export async function buildIdea(
  client: WebClient,
  channel: string,
  idea: Idea,
): Promise<BuildOutcome> {
  // Pick the primary block to drive the build action.
  const primary = idea.blocks[0];
  const block = getBlock(primary);

  if (block?.execution === "execute_in_slack") {
    return executeInSlack(client, channel, idea, primary);
  }
  return { executed: false, message: artifactFor(idea, primary) };
}

async function executeInSlack(
  client: WebClient,
  channel: string,
  idea: Idea,
  block: string,
): Promise<BuildOutcome> {
  if (block === "slack_scheduled_message") {
    // Schedule a single concrete instance ~24h out as a live proof; a real impl
    // would compute the cadence from idea.trigger.
    const postAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    await client.chat.scheduleMessage({
      channel,
      post_at: postAt,
      text: `:robot_face: *${idea.title}* — ${idea.steps[0] ?? "scheduled nudge"}`,
    });
    return {
      executed: true,
      message: `:white_check_mark: Scheduled a live "${idea.title}" message for ~24h from now. I can change the cadence — just say the word.`,
    };
  }

  if (block === "slack_canvas") {
    const md =
      `# ${idea.title}\n\n**Problem:** ${idea.problem}\n\n**Trigger:** ${idea.trigger}\n\n` +
      `**Steps:**\n${idea.steps.map((s) => `- ${s}`).join("\n")}\n\n` +
      `_Evidence: ${idea.triggeringEvidence}_`;
    const res = await client.canvases.create({
      title: idea.title,
      document_content: { type: "markdown", markdown: md },
    });
    return {
      executed: true,
      message: `:white_check_mark: Saved "${idea.title}" to a canvas (${res.canvas_id ?? "created"}).`,
    };
  }

  return { executed: false, message: artifactFor(idea, block) };
}

/** Ready-to-paste artifact for out-of-Slack blocks. */
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
      return [
        `Build this in Workflow Builder (Tools ▸ Workflow Builder ▸ New):`,
        ...idea.steps.map((s, i) => `${i + 1}. ${s}`),
      ].join("\n");
    default:
      return `Steps for ${idea.title}:\n${idea.steps.map((s) => `• ${s}`).join("\n")}`;
  }
}
