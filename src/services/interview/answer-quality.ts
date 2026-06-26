// Answer-quality helpers — impact signal and answer-quality parsing.

import type { AnswerQuality, ChatMsg, Pain } from "../../shared/types.js";

const ANSWER_QUALITIES: AnswerQuality[] = ["substantive", "thin", "dont_know"];

export function parseAnswerQuality(raw: unknown): AnswerQuality | undefined {
  if (typeof raw !== "string") return undefined;
  return ANSWER_QUALITIES.includes(raw as AnswerQuality) ? (raw as AnswerQuality) : undefined;
}

/** Most recent user answer from tool results (skips "skipped" and the latest assistant message). */
export function getLastUserAnswer(history: ChatMsg[]): string {
  let i = history.length - 1;
  if (i >= 0) {
    const last = history[i];
    if (last && "role" in last && last.role === "assistant") i--;
  }

  for (; i >= 0; i--) {
    const msg = history[i];
    if (!msg || !("role" in msg) || msg.role !== "tool") continue;
    if (!("content" in msg) || typeof msg.content !== "string") continue;
    if (msg.content === "skipped") continue;
    return msg.content;
  }

  return "";
}

export function hasImpactSignal(pain: Pain): boolean {
  return Boolean(pain.friction?.trim() || pain.who?.trim());
}
