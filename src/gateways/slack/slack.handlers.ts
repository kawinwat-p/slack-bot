// Slack handlers — Bolt routing for command / message / button actions.
// This is the INBOUND side of the Slack gateway; it loads state, advances the agent
// loop (interview service), and persists. Business logic lives in services/.
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { postParent, say } from "./slack.gateway.js";
import { readChannelText, summarizeContext } from "../../services/context/context.service.js";
import { runLoop, answerPending, type AgentDeps } from "../../services/interview/interview.service.js";
import { buildIdea } from "../../services/build/build.service.js";
import { loadState, saveState } from "../../repositories/state.repository.js";
import { log } from "../../shared/logger.js";
import { clampInput } from "../../shared/input.js";
import { withThreadLock } from "../../shared/thread-lock.js";
import type { ConvState } from "../../shared/types.js";

async function runLoopSafe(client: WebClient, deps: AgentDeps, state: ConvState): Promise<void> {
  try {
    await runLoop(deps, state);
  } catch (err) {
    log("loop.error", { thread: state.threadTs, err: String(err) });
    await say(client, state.channel, state.threadTs, "Something went wrong — try `/workflow-ideas` again.");
    state.phase = "done";
    saveState(state);
  }
}
export function registerHandlers(app: App): void {
  const deps = (): AgentDeps => ({ client: app.client });
  // 1. Manual trigger
  app.command("/workflow-ideas-achi", async ({ command, ack, client }) => {
    await ack();
    const channel = command.channel_id;
    const user = command.user_id;
    const userPrompt = clampInput(command.text);
    log("command", { cmd: "/workflow-ideas", user, channel, prompt: userPrompt || null });
    const threadTs = await postParent(
      client,
      channel,
      `:mag: Hi <@${user}> — I read this channel's *recent messages* to ground my questions ` +
        "(used only for this session). Give me a moment to look…",
    );
    await withThreadLock(threadTs, async () => {
      const channelText = await readChannelText(client, channel);
      const context = await summarizeContext(channelText, userPrompt);
      console.log("context", context);
      console.log("channelText", channelText);
      const state: ConvState = {
        threadTs,
        channel,
        user,
        phase: "interview",
        context,
        questionsAsked: 0,
        proposedIdeas: [],
        pains: [],
        currentPainIndex: 0,
        forceProposed: false,
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
      await runLoopSafe(client, deps(), state);
    });
  });

  // 2. Free-text reply in an interview thread
  app.message(async ({ message, client }) => {
    const m = message as any;
    if (m.subtype || !m.thread_ts || m.bot_id) return;
    const threadTs = m.thread_ts as string;
    const text = clampInput(m.text);
    if (!text) return;
    await withThreadLock(threadTs, async () => {
      const state = loadState(threadTs);
      if (!state || state.pending?.kind !== "ask_user") return;
      log("event.reply", { channel: m.channel });
      answerPending(state, text);
      saveState(state);
      await runLoopSafe(client, deps(), state);
    });
  });

  // 3. Quick-reply buttons + Skip
  const handleAnswerButton = async ({ ack, body, action, client }: any) => {
    await ack();
    const threadTs: string | undefined = body.message?.thread_ts ?? body.container?.thread_ts;
    if (!threadTs) return;
    await withThreadLock(threadTs, async () => {
      const state = loadState(threadTs);
      if (!state || state.pending?.kind !== "ask_user") return;
      const value = action.value as string;
      log("event.button", { action: value === "__skip__" ? "skip" : "quick_reply", value });
      if (value === "__skip__") {
        state.forceProposed = true;
        answerPending(state, "The user wants ideas now.");
      } else {
        answerPending(state, value);
      }
      saveState(state);
      await runLoopSafe(client, deps(), state);
    });
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