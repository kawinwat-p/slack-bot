// Slack handlers — Bolt routing for command / message / button actions.
// This is the INBOUND side of the Slack gateway; it loads state, advances the agent
// loop (interview service), and persists. Business logic lives in services/.

import type { App } from "@slack/bolt";
import { postParent, say } from "./slack.gateway.js";
import { readChannelText, summarizeContext } from "../../services/context/context.service.js";
import { runLoop, answerPending, type AgentDeps } from "../../services/interview/interview.service.js";
import { buildIdea } from "../../services/build/build.service.js";
import { loadState, saveState } from "../../repositories/state.repository.js";
import { log } from "../../shared/logger.js";
import { checkInput } from "../../shared/input.js";
import type { ConvState } from "../../shared/types.js";

export function registerHandlers(app: App): void {
  const deps = (): AgentDeps => ({ client: app.client });

  // 1. Manual trigger
  app.command("/workflow-ideas", async ({ command, ack, client }) => {
    await ack();
    const channel = command.channel_id;
    const user = command.user_id;
    const check = checkInput(command.text);
    if (!check.ok) {
      log("command.blocked", { user, channel, reason: check.reason });
      await client.chat.postEphemeral({ channel, user, text: `:no_entry: ${check.reason}` });
      return;
    }
    const userPrompt = check.text;
    log("command", { cmd: "/workflow-ideas", user, channel, prompt: userPrompt || null });

    const threadTs = await postParent(
      client,
      channel,
      `:mag: Hi <@${user}> — I read this channel's *recent messages* to ground my questions ` +
        "(used only for this session). Give me a moment to look…",
    );

    const channelText = await readChannelText(client, channel);
    const context = await summarizeContext(channelText, userPrompt);

    const state: ConvState = {
      threadTs,
      channel,
      user,
      phase: "interview",
      context,
      questionsAsked: 0,
      proposedIdeas: [],
      history: [
        {
          role: "user",
          content:
            "Begin. Use the observed context to open with one sharp, grounded question " +
            "(or propose ideas immediately if you already understand the pain)." +
            (userPrompt ? ` The user added: "${userPrompt}".` : ""),
        },
      ],
    };
    saveState(state);
    log("state.initial", { context: state.context, opening: state.history[0]?.content });
    await runLoop(deps(), state);
  });

  // 2. Free-text reply in an interview thread
  app.message(async ({ message }) => {
    const m = message as any;
    if (m.subtype || !m.thread_ts || m.bot_id) return;
    const state = loadState(m.thread_ts);
    if (!state || state.pending?.kind !== "ask_user") return;
    const check = checkInput(m.text);
    if (check.ok && !check.text) return; // empty/whitespace reply — ignore
    if (!check.ok) {
      log("event.reply.blocked", { channel: m.channel, reason: check.reason });
      await say(client, m.channel, m.thread_ts, `:no_entry: ${check.reason}`);
      return; // keep pending so the user can retry
    }
    log("event.reply", { channel: m.channel });
    answerPending(state, check.text);
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
    log("event.build", { idea: idea.title });

    const outcome = await buildIdea(client, state.channel, idea);
    await say(client, state.channel, threadTs, outcome.message);
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
