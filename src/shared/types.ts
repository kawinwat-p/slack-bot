// Shared domain types (dependency-free w.r.t. our layers).

import type OpenAI from "openai";

/** OpenAI/OpenRouter chat message + tool types (used by the LLM gateway + agent memory). */
export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** A building block an idea can be composed from (see services/catalog). */
export type BlockId =
  | "slack_scheduled_message"
  | "slack_canvas"
  | "slack_workflow_step"
  | "incoming_webhook"
  | "github_action"
  | "cron_script";

/** A single proposed workflow idea. */
export interface Idea {
  id: string;
  title: string;
  problem: string;
  /** REQUIRED, non-empty: the observed signal that motivates this idea. */
  triggeringEvidence: string;
  trigger: string;
  steps: string[];
  blocks: BlockId[];
  effort: "S" | "M" | "L";
}

/** Patterns distilled from channel history by the summarize pre-pass. */
export interface ContextSummary {
  patterns: string[];
  evidenceSignals: BlockId[];
  notes: string;
}

export type Phase = "interview" | "propose" | "done";

/** Persisted, re-entrant conversation state, keyed by thread_ts. */
export interface ConvState {
  threadTs: string;
  channel: string;
  user: string;
  phase: Phase;
  context?: ContextSummary;
  allowedBlocks: BlockId[];
  history: ChatMsg[];
  questionsAsked: number;
  proposedIdeas: Idea[];
  pending?: PendingInterrupt;
}

export type PendingInterrupt =
  | { kind: "ask_user"; toolCallId: string; otherIds: string[] }
  | { kind: "approval"; ideaId: string };
