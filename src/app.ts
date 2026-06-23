// Bolt wiring (§3, Q1). Socket Mode — no public URL needed.
//
// Each handler loads persisted state, advances the re-entrant agent loop, and saves.
// The loop itself lives in agent.ts; this file is just the Slack plumbing.

import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;

import { readChannelText, summarizeContext } from "./context.js";
import { allowedBlocksFor } from "./catalog.js";
import { runLoop, answerPending, type AgentDeps } from "./agent.js";
import { buildIdea, isBlastRadius } from "./build.js";
import { loadState, saveState } from "./state.js";
import { postApprovalCard, say } from "./slackui.js";
import type { ConvState } from "./types.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

const deps = (): AgentDeps => ({ client: app.client });

// ---------------------------------------------------------------------------
// 1. Manual trigger: /workflow-ideas
// ---------------------------------------------------------------------------
app.command("/workflow-ideas", async ({ command, ack, client }) => {
  await ack();
  const channel = command.channel_id;
  const user = command.user_id;

  // Disclosure-on-trigger (§8/Q8): be upfront that we read recent messages.
  const parent = await client.chat.postMessage({
    channel,
    text:
      `:mag: Hi <@${user}> — I read this channel's *recent messages* to ground my questions ` +
      "(used only for this session). Give me a moment to look…",
  });
  const threadTs = parent.ts as string;

  // Step 2: retrieve + summarize, then compute allowed blocks (catalog ∩ evidence).
  const channelText = await readChannelText(client, channel);
  const context = await summarizeContext(channelText);
  const allowedBlocks = allowedBlocksFor(channelText);

  const state: ConvState = {
    threadTs,
    channel,
    user,
    phase: "interview",
    context,
    allowedBlocks,
    questionsAsked: 0,
    proposedIdeas: [],
    history: [
      {
        role: "user",
        content:
          "Begin. Use the observed context to open with one sharp, grounded question " +
          "(or propose ideas immediately if you already understand the pain).",
      },
    ],
  };
  saveState(state);
  await runLoop(deps(), state);
});

// ---------------------------------------------------------------------------
// 2. Free-text reply in an interview thread -> resume the loop
// ---------------------------------------------------------------------------
app.message(async ({ message }) => {
  const m = message as any;
  if (m.subtype || !m.thread_ts || m.bot_id) return; // ignore edits/bots/non-threaded
  const state = loadState(m.thread_ts);
  if (!state || state.pending?.kind !== "ask_user") return;

  answerPending(state, String(m.text ?? ""));
  saveState(state);
  await runLoop(deps(), state);
});

// ---------------------------------------------------------------------------
// 3. Quick-reply buttons (answer_0..3) and Skip
// ---------------------------------------------------------------------------
const handleAnswerButton = async ({ ack, body, action }: any) => {
  await ack();
  const threadTs: string | undefined = body.message?.thread_ts ?? body.container?.thread_ts;
  if (!threadTs) return;
  const state = loadState(threadTs);
  if (!state || state.pending?.kind !== "ask_user") return;

  const value = action.value as string;
  if (value === "__skip__") {
    state.questionsAsked = 999; // force the ceiling so the agent proposes now
    answerPending(state, "The user wants ideas now. Stop interviewing and propose.");
  } else {
    answerPending(state, value);
  }
  saveState(state);
  await runLoop(deps(), state);
};

app.action(/^answer_\d$/, handleAnswerButton);
app.action("skip_interview", handleAnswerButton);

// ---------------------------------------------------------------------------
// 4. Idea card buttons
// ---------------------------------------------------------------------------
app.action("build_idea", async ({ ack, body, action, client }) => {
  await ack();
  const b = body as any;
  const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
  const state = loadState(threadTs);
  if (!state) return;
  const idea = state.proposedIdeas.find((i) => i.id === (action as any).value);
  if (!idea) return;

  // Tiered approval: gate blast-radius builds behind a Confirm card (§4.4).
  if (isBlastRadius(idea)) {
    state.pending = { kind: "approval", ideaId: idea.id };
    saveState(state);
    await postApprovalCard(
      client,
      state.channel,
      threadTs,
      `set up "${idea.title}" — it will post into this channel on a schedule.`,
      idea.id,
    );
    return;
  }

  const outcome = await buildIdea(client, state.channel, idea);
  await say(client, state.channel, threadTs, outcome.message);
});

app.action("approve_action", async ({ ack, body, action, client }) => {
  await ack();
  const b = body as any;
  const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
  const state = loadState(threadTs);
  if (!state || state.pending?.kind !== "approval") return;
  const idea = state.proposedIdeas.find((i) => i.id === (action as any).value);
  state.pending = undefined;
  saveState(state);
  if (!idea) return;
  const outcome = await buildIdea(client, state.channel, idea);
  await say(client, state.channel, threadTs, outcome.message);
});

app.action("cancel_action", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
  const state = loadState(threadTs);
  if (state) {
    state.pending = undefined;
    saveState(state);
  }
  await say(client, b.channel?.id, threadTs, "Cancelled — nothing was changed.");
});

app.action("refine_idea", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
  await say(client, b.channel?.id, threadTs, "What should I change about it? (e.g. cadence, channel, scope)");
});

app.action("reject_idea", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
  await say(client, b.channel?.id, threadTs, "Dropped. :+1:");
});

// ---------------------------------------------------------------------------
await app.start();
console.log("⚡ workflow-ideas bot running (Socket Mode)");
