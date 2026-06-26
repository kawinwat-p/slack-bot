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

const mockClient = {
  chat: { postMessage: async () => ({ ts: "123", ok: true }) },
  canvases: { create: async () => ({ canvas_id: "c1" }) },
} as AgentDeps["client"];

function askUserCall(id: string, question: string, pain: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: {
          name: "ask_user",
          arguments: JSON.stringify({ question, pain, quick_replies: [] }),
        },
      },
    ],
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

// --- propose_ideas completes ---
{
  const state = baseState();
  const chatFn: AgentDeps["chatFn"] = async () => proposeCall("tc3");

  await runLoop({ client: mockClient, chatFn }, state);
  ok(state.phase === "done", "harness: propose sets done");
  ok(state.proposedIdeas.length === 1, "harness: propose adds idea");
}

console.log(`harness PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
