// Shared domain types (dependency-free w.r.t. our layers).

import type OpenAI from "openai";

/** OpenAI/OpenRouter chat message + tool types (used by the LLM gateway + agent memory). */
export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** A single proposed workflow idea. Free-form — no fixed building-block catalog. */
export interface Idea {
  id: string;
  title: string;
  problem: string;
  /** REQUIRED, non-empty: the observed signal that motivates this idea. */
  triggeringEvidence: string;
  trigger: string;
  steps: string[];
  effort: "S" | "M" | "L";
}

/** Three-part distillation of channel history by the summarize pre-pass. */
export interface ContextSummary {
  tools: string[]; // tools/services the company uses, as named in chat
  summary: string; // what the channel is about
  painPoints: string[]; // recurring friction the team hits
}

export type Phase = "interview" | "propose" | "done";

/** Persisted, re-entrant conversation state, keyed by thread_ts. */
export interface ConvState {
  threadTs: string;
  channel: string;
  user: string;
  phase: Phase;
  context?: ContextSummary;
  history: ChatMsg[];
  questionsAsked: number;
  proposedIdeas: Idea[];
  pending?: PendingInterrupt;
}

export type PendingInterrupt = { kind: "ask_user"; toolCallId: string; otherIds: string[] };
