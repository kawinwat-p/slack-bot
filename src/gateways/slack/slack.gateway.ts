// Slack gateway — ทุกการคุยกับ Slack Web API อยู่ที่นี่ที่เดียว
// (อ่าน history, โพสต์ข้อความ/การ์ด, ทำ action จริงอย่าง canvas/scheduled message)
// service จะเรียกผ่าน gateway นี้ ไม่แตะ WebClient ตรง ๆ

import type { WebClient } from "@slack/web-api";
import type { Idea } from "../../shared/types.js";

const HISTORY_LIMIT = 200;

// ---- READ ----

export async function getRecentText(client: WebClient, channel: string): Promise<{ text: string; count: number }> {
  const res = await client.conversations.history({ channel, limit: HISTORY_LIMIT });
  const msgs = (res.messages ?? [])
    .filter((m) => typeof m.text === "string" && m.text.length > 0)
    .reverse(); // oldest -> newest
  return { text: msgs.map((m) => m.text).join("\n"), count: msgs.length };
}

// ---- WRITE: plain ----

export async function say(client: WebClient, channel: string, threadTs: string, text: string): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}

export async function postParent(client: WebClient, channel: string, text: string): Promise<string> {
  const res = await client.chat.postMessage({ channel, text });
  return res.ts as string;
}

// ---- WRITE: Block Kit ----

const SKIP_ACTION = "skip_interview";

export async function postQuestion(
  client: WebClient,
  channel: string,
  threadTs: string,
  question: string,
  quickReplies: string[] = [],
): Promise<void> {
  const buttons: any[] = quickReplies.slice(0, 4).map((label, i) => ({
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
  });
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: question,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: question } },
      { type: "actions", elements: buttons },
    ],
  });
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
          { type: "button", style: "primary", text: { type: "plain_text", text: "👍 Build this" }, value: idea.id, action_id: "build_idea" },
          { type: "button", text: { type: "plain_text", text: "✏️ Refine" }, value: idea.id, action_id: "refine_idea" },
          { type: "button", text: { type: "plain_text", text: "👎 Not it" }, value: idea.id, action_id: "reject_idea" },
        ],
      },
    ],
  });
}

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
          { type: "button", style: "primary", text: { type: "plain_text", text: "Confirm" }, value: token, action_id: "approve_action" },
          { type: "button", text: { type: "plain_text", text: "Cancel" }, value: token, action_id: "cancel_action" },
        ],
      },
    ],
  });
}

// ---- WRITE: real side effects (build) ----

export async function scheduleMessage(client: WebClient, channel: string, postAt: number, text: string): Promise<void> {
  await client.chat.scheduleMessage({ channel, post_at: postAt, text });
}

export async function createCanvas(client: WebClient, title: string, markdown: string): Promise<string> {
  const res = await client.canvases.create({ title, document_content: { type: "markdown", markdown } });
  return res.canvas_id ?? "created";
}
