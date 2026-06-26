/**
 * Harness — drive runLoop with fake chat() and stub Slack client.
 * No real Slack/OpenRouter.
 */
process.env.OPENROUTER_API_KEY ??= "test-key-for-harness";

const { runLoop } = await import("./src/services/interview/interview.service.js");
import type { AgentDeps } from "./src/services/interview/interview.service.js";
import type { ConvState, ContextSummary } from "./src/shared/types.js";
import type OpenAI from "openai";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  c ? pass++ : (fail++, console.log("FAIL:", m));
};

type ChatCompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessage;

const context: ContextSummary = {
  tools: ["GitHub"],
  summary: "Engineering channel",
  painPoints: ["manual deploy announcements"],
};

function baseState(overrides: Partial<ConvState> = {}): ConvState {
  return {
    threadTs: "1.0",
    channel: "C",
    user: "U",
    phase: "interview",
    context,
    history: [{ role: "user", content: "Begin." }],
    questionsAsked: 0,
    proposedIdeas: [],
    pains: [],
    currentPainIndex: 0,
    forceProposed: false,
    ...overrides,
  };
}

const postedTexts: string[] = [];
const mockClient = {
  chat: {
    postMessage: async (opts: { text?: string }) => {
      if (opts.text) postedTexts.push(opts.text);
      return { ts: "123", ok: true };
    },
  },
  canvases: { create: async () => ({ canvas_id: "c1" }) },
} as AgentDeps["client"];

function askUserCall(
  id: string,
  question: string,
  pain: Record<string, unknown>,
  quickReplies: string[] = [],
) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: {
          name: "ask_user",
          arguments: JSON.stringify({ question, pain, quick_replies: quickReplies }),
        },
      },
    ],
  } satisfies ChatCompletionMessage;
}

function lastToolResult(state: ConvState): string | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const msg = state.history[i];
    if (msg && "role" in msg && msg.role === "tool" && "content" in msg && typeof msg.content === "string") {
      return msg.content;
    }
  }
  return undefined;
}

function lastUserMessage(state: ConvState): string | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const msg = state.history[i];
    if (msg && "role" in msg && msg.role === "user" && "content" in msg && typeof msg.content === "string") {
      return msg.content;
    }
  }
  return undefined;
}

function textReplyCall(content: string | null) {
  return {
    role: "assistant" as const,
    content,
    tool_calls: [],
  } satisfies ChatCompletionMessage;
}

function proposeCall(id: string) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: {
          name: "propose_ideas",
          arguments: JSON.stringify({
            ideas: [
              {
                title: "Auto deploy note",
                problem: "Manual announces",
                triggeringEvidence: "saw 15 manual deploy msgs",
                trigger: "on deploy",
                steps: ["post to channel"],
                effort: "S",
              },
            ],
          }),
        },
      },
    ],
  } satisfies ChatCompletionMessage;
}

// --- ask_user suspends with pain persisted ---
{
  const state = baseState();
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc1", "Who owns deploys?", { topic: "deploy noise", trigger: "every push" });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "harness: suspends on ask_user");
  ok(state.pains.length === 1 && state.pains[0].topic === "deploy noise", "harness: pain persisted");
  ok(state.questionsAsked === 1, "harness: questionsAsked incremented");
  ok(state.pains[0].drillCount === 1, "harness: drillCount incremented");
}

// --- forceProposed: ask_user does not suspend ---
{
  const state = baseState({ forceProposed: true, history: [{ role: "user", content: "Begin." }] });
  const chatFn: AgentDeps["chatFn"] = async (messages) => {
    const last = messages[messages.length - 1];
    if (last && "role" in last && last.role === "tool") {
      return proposeCall("tc2");
    }
    return askUserCall("tc1", "Should not post?", { topic: "x" });
  };

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending === undefined, "harness: forceProposed no suspend");
  ok(state.questionsAsked === 0, "harness: forceProposed never posts question");
  ok(state.phase === "done", "harness: forceProposed reaches propose");
  ok(state.proposedIdeas.length === 1, "harness: idea posted");
}

// --- propose_ideas completes (resolved pain with impact) ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploy noise",
        trigger: "every push",
        friction: "manual announces",
        who: null,
        howOften: null,
        status: "resolved",
        drillCount: 2,
      },
    ],
  });
  const chatFn: AgentDeps["chatFn"] = async () => proposeCall("tc3");

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "done", "harness: propose sets done");
  ok(state.proposedIdeas.length === 1, "harness: propose adds idea");
}

// --- enforcement: resolved after 1 drill rejected ---
{
  const state = baseState({
    pains: [
      {
        topic: "notion docs",
        trigger: "search fails",
        friction: null,
        who: null,
        howOften: null,
        status: "drilling",
        drillCount: 1,
      },
    ],
    questionsAsked: 1,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-r1", "Move on?", {
      topic: "notion docs",
      trigger: "search fails",
      status: "resolved",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending === undefined, "enforcement: 1 drill resolve no suspend");
  ok(state.questionsAsked === 1, "enforcement: 1 drill resolve questionsAsked unchanged");
  ok(state.pains[0].drillCount === 1, "enforcement: 1 drill resolve drillCount unchanged");
  ok(lastToolResult(state)?.includes("only 1 drill"), "enforcement: 1 drill resolve reason");
}

// --- enforcement: resolved after 2 drills but notes unchanged rejected ---
{
  const state = baseState({
    pains: [
      {
        topic: "notion docs",
        trigger: "search fails",
        friction: "outdated",
        who: "eng",
        howOften: "weekly",
        status: "drilling",
        drillCount: 2,
      },
    ],
    questionsAsked: 2,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-r2", "Good enough?", {
      topic: "notion docs",
      trigger: "search fails",
      friction: "outdated",
      who: "eng",
      howOften: "weekly",
      status: "resolved",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending === undefined, "enforcement: notes unchanged no suspend");
  ok(state.questionsAsked === 2, "enforcement: notes unchanged questionsAsked unchanged");
  ok(state.pains[0].drillCount === 2, "enforcement: notes unchanged drillCount unchanged");
  ok(lastToolResult(state)?.includes("didn't add new detail"), "enforcement: notes unchanged reason");
}

// --- enforcement: resolved after 2 drills with note advanced accepted ---
{
  const state = baseState({
    pains: [
      {
        topic: "notion docs",
        trigger: "search fails",
        friction: "outdated",
        who: "eng",
        howOften: null,
        status: "drilling",
        drillCount: 2,
      },
    ],
    questionsAsked: 2,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-r3", "Confirm weekly?", {
      topic: "notion docs",
      trigger: "search fails",
      friction: "outdated",
      who: "eng",
      howOften: "weekly",
      status: "resolved",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "enforcement: valid resolve suspends");
  ok(state.questionsAsked === 3, "enforcement: valid resolve questionsAsked bumped");
  ok(state.pains[0].drillCount === 3, "enforcement: valid resolve drillCount bumped");
  ok(state.pains[0].status === "resolved", "enforcement: valid resolve status kept");
}

// --- enforcement: rejected question does not bump counters (explicit) ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "push",
        friction: null,
        who: null,
        howOften: null,
        status: "drilling",
        drillCount: 0,
      },
    ],
    questionsAsked: 0,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-r4", "Done?", { topic: "deploys", trigger: "push", status: "resolved" });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.questionsAsked === 0, "enforcement: reject keeps questionsAsked at 0");
  ok(state.pains[0].drillCount === 0, "enforcement: reject keeps drillCount at 0");
}

// --- enforcement: drilling with quick_replies passes Check 1 ---
{
  const state = baseState();
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall(
      "tc-r5",
      "Who owns this?",
      { topic: "deploy noise", trigger: "every push", status: "drilling" },
      ["Platform team", "On-call"],
    );

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "enforcement: quick_replies drilling suspends");
  ok(state.questionsAsked === 1, "enforcement: quick_replies drilling posts question");
}

// --- quality: thin + notesAdvanced rejected ---
{
  const state = baseState({
    lastUserAnswer: "PO and Manager confused",
    pains: [
      {
        topic: "deploys",
        trigger: "daily deploys",
        friction: null,
        who: null,
        howOften: null,
        status: "drilling",
        drillCount: 1,
      },
    ],
    questionsAsked: 1,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-q1", "Who is affected?", {
      topic: "deploys",
      trigger: "daily deploys",
      who: "POs and Managers",
      lastAnswerQuality: "thin",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending === undefined, "quality: thin advance no suspend");
  ok(state.questionsAsked === 1, "quality: thin advance questionsAsked unchanged");
  ok(state.pains[0].who == null, "quality: thin advance pain not mutated");
  ok(lastToolResult(state)?.includes("'thin'"), "quality: thin advance reason");
}

// --- quality: thin + resolved rejected ---
{
  const state = baseState({
    lastUserAnswer: "maybe sometimes",
    pains: [
      {
        topic: "deploys",
        trigger: "daily",
        friction: "missed",
        who: "eng",
        howOften: null,
        status: "drilling",
        drillCount: 2,
      },
    ],
    questionsAsked: 2,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-q2", "Wrap up?", {
      topic: "deploys",
      trigger: "daily",
      friction: "missed",
      who: "eng",
      status: "resolved",
      lastAnswerQuality: "thin",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending === undefined, "quality: thin resolve no suspend");
  ok(lastToolResult(state)?.includes("'thin'"), "quality: thin resolve reason");
}

// --- quality: dont_know + advancing accepted ---
{
  const state = baseState({
    lastUserAnswer: "I don't know",
    pains: [
      {
        topic: "deploys",
        trigger: "daily",
        friction: "missed announces",
        who: "POs",
        howOften: null,
        status: "drilling",
        drillCount: 2,
      },
    ],
    questionsAsked: 2,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-q3", "Anything else?", {
      topic: "deploys",
      trigger: "daily",
      friction: "missed announces",
      who: "POs",
      howOften: "unknown",
      lastAnswerQuality: "dont_know",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "quality: dont_know advance suspends");
  ok(state.questionsAsked === 3, "quality: dont_know advance posts question");
}

// --- quality: substantive normal pass ---
{
  const state = baseState({
    lastUserAnswer: "every push to main",
    pains: [
      {
        topic: "deploys",
        trigger: null,
        friction: null,
        who: null,
        howOften: null,
        status: "drilling",
        drillCount: 1,
      },
    ],
    questionsAsked: 1,
  });
  const chatFn: AgentDeps["chatFn"] = async () =>
    askUserCall("tc-q5", "What goes wrong?", {
      topic: "deploys",
      trigger: "every push",
      lastAnswerQuality: "substantive",
    });

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "quality: substantive suspends");
}

// --- quality: propose while drilling rejected ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "daily",
        friction: null,
        who: null,
        howOften: null,
        status: "drilling",
        drillCount: 3,
      },
    ],
    questionsAsked: 3,
  });
  const chatFn: AgentDeps["chatFn"] = async () => proposeCall("tc-q6");

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.proposedIdeas.length === 0, "quality: drilling propose no ideas");
  ok(lastToolResult(state)?.includes("resolved pain"), "quality: drilling propose reason");
}

// --- quality: propose with resolved + friction proceeds ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "daily",
        friction: "manual announce",
        who: "eng",
        howOften: null,
        status: "resolved",
        drillCount: 3,
      },
    ],
    questionsAsked: 3,
  });
  const chatFn: AgentDeps["chatFn"] = async () => proposeCall("tc-q7");

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "done", "quality: resolved propose done");
  ok(state.proposedIdeas.length === 1, "quality: resolved propose posts idea");
}

// --- quality: deadend no impact propose rejected ---
{
  const state = baseState({
    pains: [
      {
        topic: "unknown",
        trigger: null,
        friction: null,
        who: null,
        howOften: null,
        status: "deadend",
        drillCount: 2,
      },
    ],
    questionsAsked: 2,
  });
  const chatFn: AgentDeps["chatFn"] = async () => proposeCall("tc-q8");

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.proposedIdeas.length === 0, "quality: deadend no impact no ideas");
  ok(lastToolResult(state)?.includes("worth solving"), "quality: deadend no impact reason");
}

// --- text-reply recovery: plain text does not end interview ---
{
  postedTexts.length = 0;
  const state = baseState();
  let calls = 0;
  const chatFn: AgentDeps["chatFn"] = async (messages) => {
    calls++;
    if (calls === 1) return textReplyCall("When you reopen and people don't know who decided, what goes wrong?");
    const last = messages[messages.length - 1];
    ok(
      last && "role" in last && last.role === "user" && last.content?.includes("Invalid turn"),
      "text-reply: nudge visible to model on retry",
    );
    return askUserCall("tc-t1", "Who owns deploys?", { topic: "deploy noise", trigger: "every push" });
  };

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "interview", "text-reply: phase stays interview until suspend");
  ok(state.pending?.kind === "ask_user", "text-reply: recovers to ask_user suspend");
  ok(state.questionsAsked === 1, "text-reply: only real question bumps budget");
  ok(lastUserMessage(state)?.includes("Invalid turn"), "text-reply: nudge in history");
  ok(!postedTexts.some((t) => t.includes("don't know who decided")), "text-reply: prose not posted");
}

// --- text-reply recovery: text then ask_user ---
{
  postedTexts.length = 0;
  const state = baseState();
  let calls = 0;
  const chatFn: AgentDeps["chatFn"] = async () => {
    calls++;
    if (calls === 1) return textReplyCall("This should not be posted.");
    return askUserCall("tc-t2", "What breaks?", { topic: "deploy noise", trigger: "every push" });
  };

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.pending?.kind === "ask_user", "text-reply: text then ask_user suspends");
  ok(state.questionsAsked === 1, "text-reply: text then ask_user questionsAsked is 1");
  ok(!postedTexts.some((t) => t.includes("should not be posted")), "text-reply: text then ask_user no prose");
}

// --- text-reply recovery: text then propose_ideas ---
{
  postedTexts.length = 0;
  const state = baseState({
    pains: [
      {
        topic: "deploy noise",
        trigger: "every push",
        friction: "manual announces",
        who: null,
        howOften: null,
        status: "resolved",
        drillCount: 2,
      },
    ],
  });
  let calls = 0;
  const chatFn: AgentDeps["chatFn"] = async () => {
    calls++;
    if (calls === 1) return textReplyCall("Here are some ideas...");
    return proposeCall("tc-t3");
  };

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "done", "text-reply: text then propose done");
  ok(state.proposedIdeas.length === 1, "text-reply: text then propose posts idea");
  ok(!postedTexts.some((t) => t.includes("Here are some ideas")), "text-reply: text then propose no prose");
}

// --- text-reply recovery: text every iteration hits regroup ---
{
  postedTexts.length = 0;
  const state = baseState();
  const prose = "Still plain text on every turn.";
  const chatFn: AgentDeps["chatFn"] = async () => textReplyCall(prose);

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "done", "text-reply: exhaustion sets done");
  ok(!postedTexts.some((t) => t.includes(prose)), "text-reply: exhaustion does not post prose");
  ok(postedTexts.some((t) => t.includes("Let me regroup")), "text-reply: exhaustion posts regroup");
}

// --- text-reply recovery: empty content and no tool_calls ---
{
  postedTexts.length = 0;
  const state = baseState();
  let calls = 0;
  const chatFn: AgentDeps["chatFn"] = async () => {
    calls++;
    if (calls === 1) return textReplyCall(null);
    return askUserCall("tc-t4", "Tell me more?", { topic: "deploy noise", trigger: "every push" });
  };

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "interview", "text-reply: empty content stays interview");
  ok(state.pending?.kind === "ask_user", "text-reply: empty content recovers to ask_user");
  ok(lastUserMessage(state)?.includes("Invalid turn"), "text-reply: empty content nudge in history");
  ok(state.questionsAsked === 1, "text-reply: empty content only real question counts");
}

console.log(`harness PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
