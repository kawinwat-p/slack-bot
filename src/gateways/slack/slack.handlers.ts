// Slack handlers — Bolt routing for command / message / button actions.
// This is the INBOUND side of the Slack gateway; it loads state, advances the agent
// loop (interview service), and persists. Business logic lives in services/.

import type { App } from "@slack/bolt";
import { postApprovalCard, postParent, say } from "./slack.gateway.js";
import { readChannelText, summarizeContext } from "../../services/context/context.service.js";
import { allowedBlocksFor } from "../../services/catalog/catalog.js";
import { runLoop, answerPending, type AgentDeps } from "../../services/interview/interview.service.js";
import { buildIdea, isBlastRadius } from "../../services/build/build.service.js";
import { loadState, saveState } from "../../repositories/state.repository.js";
import { log } from "../../shared/logger.js";
import type { ConvState } from "../../shared/types.js";

export function registerHandlers(app: App): void {
  const deps = (): AgentDeps => ({ client: app.client });

  // 1. Manual trigger
  app.command("/workflow-ideas", async ({ command, ack, client }) => {
    await ack();
    const channel = command.channel_id;
    const user = command.user_id;
    log("command", { cmd: "/workflow-ideas", user, channel });

    const threadTs = await postParent(
      client,
      channel,
      `:mag: Hi <@${user}> — I read this channel's *recent messages* to ground my questions ` +
        "(used only for this session). Give me a moment to look…",
    );

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

  // 2. Free-text reply in an interview thread
  app.message(async ({ message }) => {
    const m = message as any;
    if (m.subtype || !m.thread_ts || m.bot_id) return;
    const state = loadState(m.thread_ts);
    if (!state || state.pending?.kind !== "ask_user") return;
    log("event.reply", { channel: m.channel });
    answerPending(state, String(m.text ?? ""));
    saveState(state);
    await runLoop(deps(), state);
  });

  // 3. Quick-reply buttons + Skip
  const handleAnswerButton = async ({ ack, body, action }: any) => {
    await ack();
    const threadTs: string | undefined = body.message?.thread_ts ?? body.container?.thread_ts;
    if (!threadTs) return;
    const state = loadState(threadTs);
    if (!state || state.pending?.kind !== "ask_user") return;

    const value = action.value as string;
    log("event.button", { action: value === "__skip__" ? "skip" : "quick_reply", value });
    if (value === "__skip__") {
      state.questionsAsked = 999;
      answerPending(state, "The user wants ideas now. Stop interviewing and propose.");
    } else {
      answerPending(state, value);
    }
    saveState(state);
    await runLoop(deps(), state);
  };
  app.action(/^answer_\d$/, handleAnswerButton);
  app.action("skip_interview", handleAnswerButton);

  // 4. Idea card buttons
  app.action("build_idea", async ({ ack, body, action, client }) => {
    await ack();
    const b = body as any;
    const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
    const state = loadState(threadTs);
    if (!state) return;
    const idea = state.proposedIdeas.find((i) => i.id === (action as any).value);
    if (!idea) return;
    log("event.build", { idea: idea.title, blastRadius: isBlastRadius(idea) });

    if (isBlastRadius(idea)) {
      state.pending = { kind: "approval", ideaId: idea.id };
      saveState(state);
      await postApprovalCard(client, state.channel, threadTs, `set up "${idea.title}" — it will post into this channel on a schedule.`, idea.id);
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
    log("event.approve", { idea: idea.title });
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
}
