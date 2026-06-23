// Block Kit builders + posting helpers.

import type { WebClient } from "@slack/web-api";
import type { Idea } from "./types.js";

const SKIP_ACTION = "skip_interview";

export async function postQuestion(
  client: WebClient,
  channel: string,
  threadTs: string,
  question: string,
  quickReplies: string[] = [],
): Promise<void> {
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: question } },
  ];

  const buttons = quickReplies.slice(0, 4).map((label, i) => ({
    type: "button",
    text: { type: "plain_text", text: label },
    value: label,
    action_id: `answer_${i}`,
  }));
  buttons.push({
    type: "button",
    text: { type: "plain_text", text: "Skip — just give me ideas" },
    value: "__skip__",
    action_id: SKIP_ACTION,
  } as any);

  blocks.push({ type: "actions", elements: buttons });
  await client.chat.postMessage({ channel, thread_ts: threadTs, text: question, blocks });
}

export async function postIdeaCard(
  client: WebClient,
  channel: string,
  threadTs: string,
  idea: Idea,
): Promise<void> {
  const text =
    `*💡 ${idea.title}*\n` +
    `*Problem:* ${idea.problem}\n` +
    `*Why you:* ${idea.triggeringEvidence}\n` +
    `*Trigger:* ${idea.trigger}\n` +
    `*Steps:* ${idea.steps.map((s) => `\n  • ${s}`).join("")}\n` +
    `*Built with:* ${idea.blocks.join(", ")}  ·  *Effort:* ${idea.effort}`;

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: idea.title,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "👍 Build this" },
            value: idea.id,
            action_id: "build_idea",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✏️ Refine" },
            value: idea.id,
            action_id: "refine_idea",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "👎 Not it" },
            value: idea.id,
            action_id: "reject_idea",
          },
        ],
      },
    ],
  });
}

/** Tiered-approval confirm card for blast-radius actions (§4.4, Q4). */
export async function postApprovalCard(
  client: WebClient,
  channel: string,
  threadTs: string,
  summary: string,
  token: string,
): Promise<void> {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "Confirm action",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:warning: I'm about to: ${summary}` } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Confirm" },
            value: token,
            action_id: "approve_action",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Cancel" },
            value: token,
            action_id: "cancel_action",
          },
        ],
      },
    ],
  });
}

export async function say(
  client: WebClient,
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}
