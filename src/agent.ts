// The re-entrant hybrid agent loop (§4.2, Q2/Q5/Q6) — OpenAI/OpenRouter tool calling.
//
// runLoop() drives the agent forward until it must SUSPEND (it called ask_user and
// needs a reply) or it FINISHES (it called propose_ideas and we posted the cards).
// It is called fresh on every inbound Slack event; persisted state carries memory
// across events. Termination is a tool choice: ask_user => keep going, propose_ideas
// => done. A hard ceiling (MAX_QUESTIONS) backstops a misbehaving model.

import { CATALOG, getBlock } from "./catalog.js";
import { validateIdeas } from "./ideas.js";
import { chat, type ChatMsg } from "./llm.js";
import { MAX_QUESTIONS, TOOLS, systemPrompt } from "./prompts.js";
import { postIdeaCard, postQuestion, say } from "./slackui.js";
import { saveState } from "./state.js";
import type { ConvState } from "./types.js";
import type { WebClient } from "@slack/web-api";

export interface AgentDeps {
  client: WebClient;
}

const MAX_ITERS = 6; // safety bound on internal tool turns per event

/** OpenAI tool-result message. */
function toolResult(id: string, content: string): ChatMsg {
  return { role: "tool", tool_call_id: id, content };
}

export async function runLoop(deps: AgentDeps, state: ConvState): Promise<void> {
  const { client } = deps;
  const allowed = CATALOG.filter((b) => state.allowedBlocks.includes(b.id));

  for (let i = 0; i < MAX_ITERS; i++) {
    const messages: ChatMsg[] = [
      { role: "system", content: systemPrompt(state.context!, allowed, state.questionsAsked) },
      ...state.history,
    ];
    const assistant = await chat(messages, TOOLS);

    // Record the assistant turn verbatim (preserves tool_call ids for the contract).
    state.history.push(assistant as ChatMsg);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (assistant.content) await say(client, state.channel, state.threadTs, assistant.content);
      state.phase = "done";
      saveState(state);
      return;
    }

    const primary = toolCalls[0];
    const otherIds = toolCalls.slice(1).map((t) => t.id);
    const args = safeParse(primary.function.arguments);

    // --- ask_user: suspend (or hit the ceiling) ---
    if (primary.function.name === "ask_user") {
      if (state.questionsAsked >= MAX_QUESTIONS) {
        for (const t of toolCalls) {
          state.history.push(
            toolResult(t.id, "Question budget exhausted. Call propose_ideas now using what you know."),
          );
        }
        continue;
      }
      const question = String(args.question ?? "Tell me more?");
      const quick = Array.isArray(args.quick_replies) ? args.quick_replies.map(String) : [];
      await postQuestion(client, state.channel, state.threadTs, question, quick);
      state.questionsAsked += 1;
      state.pending = { kind: "ask_user", toolCallId: primary.id, otherIds };
      saveState(state);
      return; // SUSPEND — resumed by app.ts when the user replies/clicks
    }

    // --- propose_ideas: validate deterministically, post cards, finish ---
    if (primary.function.name === "propose_ideas") {
      const { valid, rejected } = validateIdeas(args.ideas ?? [], state.allowedBlocks);

      if (valid.length === 0) {
        state.history.push(
          toolResult(
            primary.id,
            "None of those passed validation. Reasons: " +
              rejected.map((r) => r.reason).join("; ") +
              ". Only use allowed blocks and cite non-empty triggeringEvidence.",
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
      state.history.push(
        toolResult(primary.id, `Posted ${valid.length} idea card(s); ${rejected.length} rejected.`),
      );
      for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
      saveState(state);
      return;
    }

    // Unknown tool — answer to satisfy the contract and continue.
    for (const t of toolCalls) state.history.push(toolResult(t.id, "unknown tool; ignored"));
  }

  await say(client, state.channel, state.threadTs, "Let me regroup — try `/workflow-ideas` again.");
  state.phase = "done";
  saveState(state);
}

/**
 * Resume a suspended ask_user: feed the user's answer back as the tool result, so the
 * agent OBSERVES it and decides the next move. Call before re-entering runLoop.
 */
export function answerPending(state: ConvState, text: string): void {
  if (state.pending?.kind !== "ask_user") return;
  const { toolCallId, otherIds } = state.pending;
  state.history.push(toolResult(toolCallId, text));
  for (const id of otherIds) state.history.push(toolResult(id, "skipped"));
  state.pending = undefined;
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

export { validateIdeas, getBlock };
