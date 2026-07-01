// Slack handlers — Bolt routing for command / message / button actions.
// This is the INBOUND side of the Slack gateway; it loads state, advances the agent
// loop (interview service), and persists. Business logic lives in services/.
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { postParent, say } from "./slack.gateway.js";
import { gatherContextText, summarizeContext } from "../../services/context/context.service.js";
import { runLoop, answerPending, type AgentDeps } from "../../services/interview/interview.service.js";
import { runGenerate } from "../../services/workflow/generate.service.js";
import { deleteState, loadState, saveState } from "../../repositories/state.repository.js";
import { log } from "../../shared/logger.js";
import { checkInput } from "../../shared/input.js";
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

async function runGenerateSafe(client: WebClient, deps: AgentDeps, state: ConvState, feedback: string): Promise<void> {
  try {
    await runGenerate(deps, state, undefined, feedback);
  } catch (err) {
    log("generate.error", { thread: state.threadTs, err: String(err) });
    await say(client, state.channel, state.threadTs, ":warning: Could not revise the workflow — try again.");
    state.pending = { kind: "review_workflow", specId: state.currentSpec!.id };
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
    await withThreadLock(threadTs, async () => {
      const channelText = await gatherContextText(client, channel, userPrompt);
      const context = await summarizeContext(channelText, userPrompt);
      const state: ConvState = {
        threadTs,
        channel,
        user,
        phase: "interview",
        context,
        questionsAsked: 0,
        pains: [],
        currentPainIndex: 0,
        forceProposed: false,
        history: [
          {
            role: "user",
            content:
              "Begin. Use the observed context to open with one sharp, grounded question " +
              "(or generate a workflow immediately if you already understand the pain)." +
              (userPrompt ? ` The user added: "${userPrompt}".` : ""),
          },
        ],
      };
      saveState(state);
      log("state.initial", { context: state.context, opening: state.history[0]?.content });
      await runLoopSafe(client, deps(), state);
    });
  });

  // 2. Free-text reply in a thread (interview or refine)
  app.message(async ({ message, client }) => {
    const m = message as any;
    if (m.subtype || !m.thread_ts || m.bot_id) return;
    const state = loadState(m.thread_ts);
    if (!state) return;

    if (state.pending?.kind === "ask_user") {
      const check = checkInput(m.text);
      if (check.ok && !check.text) return;
      if (!check.ok) {
        log("event.reply.blocked", { channel: m.channel, reason: check.reason });
        await say(client, m.channel, m.thread_ts, `:no_entry: ${check.reason}`);
        return;
      }
      log("event.reply", { channel: m.channel });
      await withThreadLock(m.thread_ts, async () => {
        const fresh = loadState(m.thread_ts)!;
        answerPending(fresh, check.text);
        saveState(fresh);
        await runLoopSafe(client, deps(), fresh);
      });
      return;
    }

    if (state.pending?.kind === "refine") {
      const check = checkInput(m.text);
      if (check.ok && !check.text) return;
      if (!check.ok) {
        log("event.refine.blocked", { channel: m.channel, reason: check.reason });
        await say(client, m.channel, m.thread_ts, `:no_entry: ${check.reason}`);
        return;
      }
      log("event.refine", { channel: m.channel });
      await withThreadLock(m.thread_ts, async () => {
        const fresh = loadState(m.thread_ts)!;
        if (fresh.pending?.kind !== "refine" || !fresh.currentSpec) return;
        fresh.pending = undefined;
        saveState(fresh);
        await runGenerateSafe(client, deps(), fresh, check.text);
      });
    }
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
        answerPending(state, "The user wants a workflow now.");
      } else {
        answerPending(state, value);
      }
      saveState(state);
      await runLoopSafe(client, deps(), state);
    });
  };

  app.action(/^answer_\d$/, handleAnswerButton);
  app.action("skip_interview", handleAnswerButton);

  // 4. Workflow review buttons
  app.action("accept_workflow", async ({ ack, body, client }) => {
    await ack();
    const b = body as any;
    const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
    if (!threadTs) return;
    await withThreadLock(threadTs, async () => {
      const state = loadState(threadTs);
      if (!state || state.phase !== "review" || !state.currentSpec) return;
      log("event.accept", { spec: state.currentSpec.title });
      await say(
        client,
        state.channel,
        threadTs,
        "Done — download the `.md` above anytime. Session closed.",
      );
      deleteState(threadTs);
    });
  });

  app.action("refine_workflow", async ({ ack, body, client }) => {
    await ack();
    const b = body as any;
    const threadTs: string = b.message?.thread_ts ?? b.container?.thread_ts;
    if (!threadTs) return;
    await withThreadLock(threadTs, async () => {
      const state = loadState(threadTs);
      if (!state || state.phase !== "review" || !state.currentSpec) return;
      state.pending = { kind: "refine", specId: state.currentSpec.id };
      saveState(state);
      await say(
        client,
        state.channel,
        threadTs,
        "What should I change? (e.g. trigger, a step, the cadence)",
      );
    });
  });
}
