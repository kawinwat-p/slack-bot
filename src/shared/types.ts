// Shared domain types (dependency-free w.r.t. our layers).

import type OpenAI from "openai";

/** OpenAI/OpenRouter chat message + tool types (used by the LLM gateway + agent memory). */
export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** Three-part distillation of channel history by the summarize pre-pass. */
export interface ContextSummary {
  tools: string[]; // tools/services the company uses, as named in chat
  summary: string; // what the channel is about
  painPoints: string[]; // recurring friction the team hits
  connectors: string[]; // flat list of integration points a workflow might touch
}

/** Generated workflow spec — deliverable is markdown uploaded to Slack. */
export interface WorkflowSpec {
  id: string;
  slug: string; // kebab-case, used for uploaded filename {slug}.md
  title: string;
  markdown: string; // full spec — free-form, loop-me bar; source of truth
  triggeringEvidence: string; // grounding, non-empty
  briefBullets: string[]; // 3–5 decision-ready bullets for Block Kit brief
  triggerSummary?: string;
  checkpointSummary?: string;
  connectorsUsed: string[];
}

export type Phase = "interview" | "generate" | "review" | "done";

export type AnswerQuality = "substantive" | "thin" | "dont_know";

/** Four-slot pain tracker for structured interview + model metrics. */
export interface Pain {
  topic: string;
  trigger: string | null;
  friction: string | null;
  who: string | null;
  howOften: string | null;
  connectors: string | null;
  status: "drilling" | "resolved" | "deadend";
  /** # of ask_user turns actually posted against this pain. */
  drillCount: number;
  /** Model's label for the answer received on the prior turn. */
  lastAnswerQuality?: AnswerQuality;
}

export type PendingInterrupt =
  | { kind: "ask_user"; toolCallId: string; otherIds: string[] }
  | { kind: "review_workflow"; specId: string }
  | { kind: "refine"; specId: string };

/** Persisted, re-entrant conversation state, keyed by thread_ts. */
export interface ConvState {
  threadTs: string;
  channel: string;
  user: string;
  phase: Phase;
  context?: ContextSummary;
  history: ChatMsg[];
  questionsAsked: number;
  pending?: PendingInterrupt;
  /** Accumulated pains as the agent drills (max 2 per session). */
  pains: Pain[];
  /** Index into `pains` for the pain currently being drilled. */
  currentPainIndex: number;
  /** Set by Skip — next ask_user gets a soft nudge instead of posting a question. */
  forceProposed: boolean;
  /** Latest user reply from answerPending (for answer-quality validation). */
  lastUserAnswer?: string;
  /** Latest generated workflow draft. */
  currentSpec?: WorkflowSpec;
  /** ts of the in-place progress status message. */
  statusTs?: string;
}
