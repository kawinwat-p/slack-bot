// Slack gateway — ทุกการคุยกับ Slack Web API อยู่ที่นี่ที่เดียว
// (อ่าน history, โพสต์ข้อความ/การ์ด, ทำ action จริงอย่าง canvas/scheduled message)
// service จะเรียกผ่าน gateway นี้ ไม่แตะ WebClient ตรง ๆ

import type { WebClient } from "@slack/web-api";
import type { Idea } from "../../shared/types.js";
import { log } from "../../shared/logger.js";

const PAGE = 1000; // Slack max per page
const MAX_PAGES = 50; // ponytail: ~50k-message ceiling so a giant channel can't loop forever; bump if needed

// ---- READ ----

/** Pull channel messages (paginated), oldest -> newest. maxPages bounds the fetch:
 *  1 page = latest ~1000 messages; default = the whole channel up to the ceiling. */
export async function getRecentMessages(client: WebClient, channel: string, maxPages = MAX_PAGES): Promise<string[]> {
  const texts: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await client.conversations.history({ channel, limit: PAGE, cursor });
    for (const m of res.messages ?? []) {
      if (typeof m.text === "string" && m.text.length > 0) texts.push(m.text);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    pages++;
  } while (cursor && pages < maxPages);
  if (cursor) log("context.read.capped", { channel, pages: maxPages }); // hit the ceiling, older msgs skipped
  texts.reverse(); // pages came newest-first; flip the whole list to oldest -> newest
  return texts;
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
const MAX_BUTTON_TEXT = 75; // Slack plain_text limit for button labels

function clampButtonText(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_BUTTON_TEXT) return t;
  return `${t.slice(0, MAX_BUTTON_TEXT - 1)}…`;
}

export async function postQuestion(
  client: WebClient,
  channel: string,
  threadTs: string,
  question: string,
  quickReplies: string[] = [],
): Promise<void> {
  const buttons: any[] = quickReplies.slice(0, 4).map((label, i) => ({
    type: "button",
    text: { type: "plain_text", text: clampButtonText(label) },
    value: label.trim().slice(0, 2000),
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
    `*Effort:* ${idea.effort}`;

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

// ---- WRITE: real side effects (build) ----

export async function createCanvas(client: WebClient, title: string, markdown: string): Promise<string> {
  // canvases API exists at runtime; Slack SDK types may lag behind manifest scopes
  const res = await (client as WebClient & { canvases: { create: (args: unknown) => Promise<{ canvas_id?: string }> } }).canvases.create({
    title,
    document_content: { type: "markdown", markdown },
  });
  return res.canvas_id ?? "created";
}
