// Slack gateway — ทุกการคุยกับ Slack Web API อยู่ที่นี่ที่เดียว
// (อ่าน history, โพสต์ข้อความ/การ์ด, ทำ action จริงอย่าง canvas/scheduled message)
// service จะเรียกผ่าน gateway นี้ ไม่แตะ WebClient ตรง ๆ

import type { WebClient } from "@slack/web-api";
import type { WorkflowSpec } from "../../shared/types.js";
import { log } from "../../shared/logger.js";

const PAGE = 1000; // Slack max per page
const MAX_PAGES = 50; // ponytail: ~50k-message ceiling so a giant channel can't loop forever; bump if needed

// ---- READ ----

/** True if a message has real content — emoji-only messages (`:heart:`, 😀) don't count. */
export function isContentful(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const stripped = text
    .replace(/:[a-z0-9_'+-]+:/gi, "") // :shortcode: emoji
    .replace(/\p{Extended_Pictographic}/gu, "") // unicode emoji
    .trim();
  return stripped.length > 0;
}

/** Latest `maxMessages` messages (parents + thread replies counted together), oldest ->
 *  newest. Walks history newest-first, pulls each thread's replies, then keeps the most
 *  recent maxMessages by timestamp.
 *  ponytail: a recent reply on a thread whose parent is older than the fetched window is
 *  missed, and a single huge thread's replies are all fetched before trimming — fine for
 *  a 1000-message window; revisit if either bites. */
export async function getRecentMessages(
  client: WebClient,
  channel: string,
  maxMessages = 1000,
): Promise<string[]> {
  const items: { ts: number; text: string }[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const res = await client.conversations.history({ channel, limit: PAGE, cursor });
    for (const m of res.messages ?? []) {
      if (isContentful(m.text)) items.push({ ts: Number(m.ts), text: m.text });

      if (m.ts && m.thread_ts === m.ts && m.reply_count && m.reply_count > 0) {
        let threadCursor: string | undefined;
        do {
          const threadRes = await client.conversations.replies({ channel, ts: m.ts, limit: PAGE, cursor: threadCursor });
          for (const reply of threadRes.messages?.slice(1) ?? []) {
            // skip parent dup
            if (isContentful(reply.text)) items.push({ ts: Number(reply.ts), text: reply.text });
          }
          threadCursor = threadRes.response_metadata?.next_cursor || undefined;
        } while (threadCursor);
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    pages++;
  } while (cursor && pages < MAX_PAGES && items.length < maxMessages); // stop once we have enough

  items.sort((a, b) => a.ts - b.ts); // oldest -> newest
  return items.slice(-maxMessages).map((i) => i.text); // keep the latest maxMessages
}

// ---- WRITE: plain ----

export async function say(
  client: WebClient,
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}

export async function postParent(
  client: WebClient,
  channel: string,
  text: string,
): Promise<string> {
  const res = await client.chat.postMessage({ channel, text });
  return res.ts as string;
}

// ---- WRITE: loading indicator ----

const INTERVIEW_LOADING_MESSAGES = [
  "Reading your answer…",
  "Preparing the next question…",
  "Checking what we know so far…",
];

const GENERATE_LOADING_MESSAGES = [
  "Drafting the workflow spec…",
  "Structuring triggers and steps…",
  "Checking connectors…",
];

const REVISE_LOADING_MESSAGES = [
  "Applying your feedback…",
  "Revising triggers and steps…",
  "Updating the workflow spec…",
];

/** Native Slack typing indicator — no thread message, no notification ping. */
export async function setThreadStatus(
  client: WebClient,
  channel: string,
  threadTs: string,
  status = "is thinking…",
  loadingMessages: string[] = INTERVIEW_LOADING_MESSAGES,
): Promise<void> {
  try {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status,
      loading_messages: loadingMessages,
    });
  } catch (err) {
    log("slack.status.set.fail", { err: String(err) });
  }
}

/** Clear the typing indicator without posting a message. */
export async function clearThreadStatus(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<void> {
  try {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status: "",
    });
  } catch {
    /* already cleared / unsupported — ignore */
  }
}

export function generateStatusMessages(refining: boolean): { status: string; loadingMessages: string[] } {
  return refining
    ? { status: "is revising your workflow…", loadingMessages: REVISE_LOADING_MESSAGES }
    : { status: "is drafting your workflow…", loadingMessages: GENERATE_LOADING_MESSAGES };
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
    text: { type: "plain_text", text: "Skip — generate workflow" },
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

// ---- WRITE: workflow brief + file ----

export async function postBrief(
  client: WebClient,
  channel: string,
  threadTs: string,
  spec: WorkflowSpec,
): Promise<void> {
  const trigger = spec.triggerSummary?.trim() || "—";
  const checkpoint = spec.checkpointSummary?.trim() || "—";
  const connectors =
    spec.connectorsUsed.length > 0 ? spec.connectorsUsed.join(", ") : "—";
  const steps = spec.briefBullets.map((b) => `• ${b}`).join("\n");

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: spec.title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: spec.title } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Solves: ${spec.triggeringEvidence}` }],
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Trigger*\n${trigger}` },
          { type: "mrkdwn", text: `*Checkpoint*\n${checkpoint}` },
          { type: "mrkdwn", text: `*Connectors*\n${connectors}` },
        ],
      },
      { type: "section", text: { type: "mrkdwn", text: `*Steps*\n${steps}` } },
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Accept" },
            value: spec.id,
            action_id: "accept_workflow",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Refine" },
            value: spec.id,
            action_id: "refine_workflow",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Download the attached \`${spec.slug}.md\` for the full spec.`,
          },
        ],
      },
    ],
  });
}

export async function uploadWorkflowFile(
  client: WebClient,
  channel: string,
  threadTs: string,
  spec: WorkflowSpec,
): Promise<void> {
  const filename = `${slugify(spec.slug)}.md`;
  const content = Buffer.from(spec.markdown, "utf8");
  try {
    await client.files.uploadV2({
      channel_id: channel,
      thread_ts: threadTs,
      filename,
      file: content,
      title: spec.title,
    });
    log("slack.file.upload", { filename, thread: threadTs });
  } catch (err) {
    log("slack.file.upload.fail", { err: String(err), filename });
    throw err;
  }
}

function slugify(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workflow";
}
