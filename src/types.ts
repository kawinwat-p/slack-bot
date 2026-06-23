// Shared types for the workflow-ideas bot.

import type { ChatMsg } from "./llm.js";

/** A building block an idea can be composed from (see catalog.ts). */
export type BlockId =
  | "slack_scheduled_message"
  | "slack_canvas"
  | "slack_workflow_step"
  | "incoming_webhook"
  | "github_action"
  | "cron_script";

/** A single proposed workflow idea. Mirrors the schema in the design spec (§5.2). */
export interface Idea {
  id: string;
  title: string;
  problem: string;
  /** REQUIRED, non-empty: the observed signal that motivates this idea (§5.3). */
  triggeringEvidence: string;
  trigger: string;
  steps: string[];
  blocks: BlockId[];
  effort: "S" | "M" | "L";
}

/** Patterns distilled from channel history by the summarize pre-pass (§3 step 2). */
export interface ContextSummary {
  /** Short human-readable friction patterns, e.g. "manual deploy posts x15". */
  patterns: string[];
  /** Block ids the team shows evidence of being able to use (drives the catalog filter). */
  evidenceSignals: BlockId[];
  /** Raw-ish notes the interviewer can quote back to the user. */
  notes: string;
}

/** Which phase of the scripted skeleton the agent is in (§4.2). */
export type Phase = "interview" | "propose" | "done";

/** Persisted, re-entrant conversation state, keyed by thread_ts (§4 / state.ts). */
export interface ConvState {
  threadTs: string;
  channel: string;
  user: string;
  phase: Phase;
  context?: ContextSummary;
  /** Allowed blocks for THIS team = catalog ∩ evidence (§5.1). */
  allowedBlocks: BlockId[];
  /** Full message log passed to the model each turn (the agent's memory). */
  history: ChatMsg[];
  questionsAsked: number;
  proposedIdeas: Idea[];
  /** Set while we are waiting on a user reply or an approval click. */
  pending?: PendingInterrupt;
}

export type PendingInterrupt =
  | { kind: "ask_user"; toolCallId: string; otherIds: string[] }
  | { kind: "approval"; ideaId: string };
