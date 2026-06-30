// Interview service — the re-entrant hybrid agent loop (OpenAI tool calling).
//
// runLoop() drives the agent until it SUSPENDS (called ask_user, needs a reply) or
// FINISHES (called propose_ideas, posted cards). Called fresh on every inbound Slack
// event; persisted state carries memory across events. Termination is a tool choice.

import type { WebClient } from "@slack/web-api";
import { chat } from "../../gateways/llm/llm.gateway.js";
import { postIdeaCard, postQuestion, say } from "../../gateways/slack/slack.gateway.js";
import { saveState } from "../../repositories/state.repository.js";
import { log, tid } from "../../shared/logger.js";
import type { ChatMsg, ConvState } from "../../shared/types.js";
import { validateIdeas } from "../ideas/ideas.service.js";
import { validateAskUser } from "./ask-validation.js";
import { autoDeadendIncompletePains, upsertPain } from "./pain.js";
import { validateProposeGate } from "./propose-validation.js";
import { MAX_QUESTIONS, TOOLS, systemPrompt } from "./interview.prompts.js";

export interface AgentDeps {
  client: WebClient;
  chatFn?: typeof chat;
}

const MAX_ITERS = 6;

function toolResult(id: string, content: string): ChatMsg {
  return { role: "tool", tool_call_id: id, content };
}

export async function runLoop(deps: AgentDeps, state: ConvState): Promise<void> {
  const { client } = deps;
  const chatRound = deps.chatFn ?? chat;
  const T = tid(state.threadTs);

  for (let i = 0; i < MAX_ITERS; i++) {
    log("loop.iter", { thread: T, iter: i, asked: state.questionsAsked });
    const messages: ChatMsg[] = [
      {
        role: "system",
        content: systemPrompt(state.context!, state.questionsAsked, state.pains, state.currentPainIndex),
      },
      ...state.history,
    ];
    const assistant = await chatRound(messages, TOOLS);
    state.history.push(assistant as ChatMsg);

    const toolCalls = assistant.tool_calls ?? [];
    log("loop.llm", { thread: T, tool: toolCalls[0]?.function.name ?? "text" });
    if (toolCalls.length === 0) {
      log("loop.text.rejected", { thread: T });
      state.history.push({
        role: "user",
        content:
          "Invalid turn: use ask_user or propose_ideas only — no plain text. " +
          "Resend as the appropriate tool call.",
      });
      continue;
    }

    const primary = toolCalls[0];
    const otherIds = toolCalls.slice(1).map((t) => t.id);
    const args = safeParse(primary.function.arguments);

    if (primary.function.name === "ask_user") {
      const painSnapshot = structuredClone(state.pains);
      const painIndexSnapshot = state.currentPainIndex;
      const upsert = upsertPain(state, args.pain);

      if (state.forceProposed) {
        log("loop.forceProposed", { thread: T });
        state.history.push(toolResult(primary.id, "User wants ideas now. Call propose_ideas."));
        for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
        continue;
      }

      if (state.questionsAsked >= MAX_QUESTIONS) {
        log("loop.ceiling", { thread: T, asked: state.questionsAsked });
        for (const t of toolCalls) {
          state.history.push(toolResult(t.id, "Question budget exhausted. Call propose_ideas now using what you know."));
        }
        continue;
      }

      const lastUserAnswer = state.lastUserAnswer ?? "";
      const v = validateAskUser(args, state, upsert, lastUserAnswer);
      if (!v.ok) {
        state.pains = painSnapshot;
        state.currentPainIndex = painIndexSnapshot;
        log("ask_user.rejected", { thread: T, reason: v.reason });
        state.history.push(toolResult(primary.id, v.reason));
        for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
        continue;
      }

      const question = String(args.question ?? "Tell me more?");
      const quick = Array.isArray(args.quick_replies) ? args.quick_replies.map(String) : [];
      await postQuestion(client, state.channel, state.threadTs, question, quick);
      state.questionsAsked += 1;
      state.pains[state.currentPainIndex].drillCount += 1;
      state.pending = { kind: "ask_user", toolCallId: primary.id, otherIds };
      saveState(state);
      log("ask_user", { thread: T, n: state.questionsAsked, q: question, pains: state.pains.length });
      log("suspend", { thread: T });
      return;
    }

    if (primary.function.name === "propose_ideas") {
      autoDeadendIncompletePains(state);
      const gate = validateProposeGate(state);
      if (!gate.ok) {
        log("propose.gate.rejected", { thread: T, reason: gate.reason });
        state.history.push(toolResult(primary.id, gate.reason));
        for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
        continue;
      }
      const { valid, rejected } = validateIdeas(args.ideas ?? []);
      log("propose.validate", { thread: T, valid: valid.length, rejected: rejected.length });

      if (valid.length === 0) {
        log("propose.retry", { thread: T, reasons: rejected.map((r) => r.reason) });
        state.history.push(
          toolResult(
            primary.id,
            "None of those passed validation. Reasons: " +
              rejected.map((r) => r.reason).join("; ") +
              ". Include every required field, at least one step, and a non-empty triggeringEvidence.",
          ),
        );
        for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
        continue;
      }

      for (const idea of valid) {
        state.proposedIdeas.push(idea);
        await postIdeaCard(client, state.channel, state.threadTs, idea);
      }
      state.phase = "done";
      state.pending = undefined;
      state.history.push(toolResult(primary.id, `Posted ${valid.length} idea card(s); ${rejected.length} rejected.`));
      for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
      saveState(state);
      log("propose.posted", { thread: T, ideas: valid.map((idea) => idea.title) });
      log("loop.done", { thread: T, reason: "ideas-posted" });
      return;
    }

    for (const t of toolCalls) state.history.push(toolResult(t.id, "unknown tool; ignored"));
  }

  await say(client, state.channel, state.threadTs, "Let me regroup — try `/workflow-ideas` again.");
  state.phase = "done";
  saveState(state);
}

/** Resume a suspended ask_user: feed the user's answer back as the tool result. */
export function answerPending(state: ConvState, text: string): void {
  if (state.pending?.kind !== "ask_user") return;
  const { toolCallId, otherIds } = state.pending;
  state.history.push(toolResult(toolCallId, text));
  for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
  state.pending = undefined;
  state.lastUserAnswer = text;
  log("resume", { thread: tid(state.threadTs), answer: text.slice(0, 80) });
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
