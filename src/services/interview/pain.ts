// Pain slot logic — pure functions for upsert, resolution, and auto-deadend.
// Written from ask_user.pain each turn; capped at 2 pains per session.

import { log } from "../../shared/logger.js";
import type { ConvState, Pain } from "../../shared/types.js";
import { MAX_QUESTIONS } from "./interview.prompts.js";

const MAX_PAINS = 2;

export type RawPainInput = {
  topic?: string;
  trigger?: string | null;
  friction?: string | null;
  who?: string | null;
  howOften?: string | null;
  status?: "drilling" | "resolved" | "deadend";
};

function coerceRawPain(raw: RawPainInput | undefined | null): RawPainInput {
  if (!raw || typeof raw !== "object") {
    log("pain.coerce", { reason: "missing pain object" });
    return { topic: "(unspecified)" };
  }
  return raw;
}

function mergeSlots(existing: Pain | undefined, raw: RawPainInput): Pain {
  const topic = typeof raw.topic === "string" && raw.topic.trim() ? raw.topic.trim() : existing?.topic ?? "(unspecified)";
  const merged: Pain = {
    topic,
    trigger: raw.trigger !== undefined ? (raw.trigger != null ? String(raw.trigger) : null) : (existing?.trigger ?? null),
    friction: raw.friction !== undefined ? (raw.friction != null ? String(raw.friction) : null) : (existing?.friction ?? null),
    who: raw.who !== undefined ? (raw.who != null ? String(raw.who) : null) : (existing?.who ?? null),
    howOften: raw.howOften !== undefined ? (raw.howOften != null ? String(raw.howOften) : null) : (existing?.howOften ?? null),
    status: existing?.status ?? "drilling",
  };
  // Resolution is the agent's call (shared understanding), not slot-count.
  // An explicit status from the agent always wins; otherwise keep existing or default to drilling.
  if (raw.status === "resolved" || raw.status === "deadend" || raw.status === "drilling") {
    merged.status = raw.status;
  } else {
    merged.status = existing?.status ?? "drilling";
  }
  return merged;
}

function sameTopic(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Write pain slots from ask_user args into state.pains (spec §3.1). */
export function upsertPain(state: ConvState, rawInput: RawPainInput | undefined | null): void {
  const raw = coerceRawPain(rawInput);

  if (state.pains.length === 0) {
    state.pains.push(mergeSlots(undefined, raw));
    state.currentPainIndex = 0;
    return;
  }

  const current = state.pains[state.currentPainIndex];
  const rawTopic = typeof raw.topic === "string" && raw.topic.trim() ? raw.topic.trim() : current?.topic ?? "(unspecified)";

  if (!current || sameTopic(rawTopic, current.topic)) {
    state.pains[state.currentPainIndex] = mergeSlots(current, raw);
    return;
  }

  // New topic — append if current is done and under cap
  if ((current.status === "resolved" || current.status === "deadend") && state.pains.length < MAX_PAINS) {
    state.pains.push(mergeSlots(undefined, raw));
    state.currentPainIndex = state.pains.length - 1;
    return;
  }

  // Cap reached — overwrite pain at index 1
  if (state.pains.length >= MAX_PAINS) {
    state.pains[1] = mergeSlots(state.pains[1], raw);
    state.currentPainIndex = 1;
    return;
  }

  // Current still drilling but model changed topic — overwrite current
  state.pains[state.currentPainIndex] = mergeSlots(current, { ...raw, topic: rawTopic });
}

/** Before propose: mark incomplete drilling pains as deadend when ceiling or Skip. */
export function autoDeadendIncompletePains(state: ConvState): void {
  const shouldDeadend = state.forceProposed || state.questionsAsked >= MAX_QUESTIONS;
  if (!shouldDeadend) return;

  for (const pain of state.pains) {
    if (pain.status === "drilling") {
      pain.status = "deadend";
    }
  }
}

/** Default missing pain fields for state loaded from older JSON files. */
export function normalizeState(state: ConvState): ConvState {
  state.pains ??= [];
  state.currentPainIndex ??= 0;
  state.forceProposed ??= false;
  return state;
}
