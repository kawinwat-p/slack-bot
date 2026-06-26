// Pain slot logic — pure functions for upsert, resolution, and auto-deadend.
// Written from ask_user.pain each turn; capped at 2 pains per session.

import { log } from "../../shared/logger.js";
import type { AnswerQuality, ConvState, Pain } from "../../shared/types.js";
import { parseAnswerQuality } from "./answer-quality.js";
import { MAX_QUESTIONS } from "./interview.prompts.js";

const MAX_PAINS = 2;

export type RawPainInput = {
  topic?: string;
  trigger?: string | null;
  friction?: string | null;
  who?: string | null;
  howOften?: string | null;
  status?: "drilling" | "resolved" | "deadend";
  lastAnswerQuality?: AnswerQuality;
};

function coerceRawPain(raw: RawPainInput | undefined | null): RawPainInput {
  if (!raw || typeof raw !== "object") {
    log("pain.coerce", { reason: "missing pain object" });
    return { topic: "(unspecified)" };
  }
  return raw;
}

type NoteSnapshot = Pick<Pain, "trigger" | "friction" | "who" | "howOften">;

function notesChanged(before: NoteSnapshot | undefined, after: Pain): boolean {
  if (!before) {
    return [after.trigger, after.friction, after.who, after.howOften].some((v) => v != null);
  }
  return (
    before.trigger !== after.trigger ||
    before.friction !== after.friction ||
    before.who !== after.who ||
    before.howOften !== after.howOften
  );
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
    drillCount: existing?.drillCount ?? 0,
  };
  // Resolution is the agent's call (shared understanding), not slot-count.
  // An explicit status from the agent always wins; otherwise keep existing or default to drilling.
  if (raw.status === "resolved" || raw.status === "deadend" || raw.status === "drilling") {
    merged.status = raw.status;
  } else {
    merged.status = existing?.status ?? "drilling";
  }
  const quality = parseAnswerQuality(raw.lastAnswerQuality);
  if (quality) {
    merged.lastAnswerQuality = quality;
  } else if (existing?.lastAnswerQuality) {
    merged.lastAnswerQuality = existing.lastAnswerQuality;
  }
  return merged;
}

/** Write pain slots from ask_user args into state.pains (spec §3.1). Returns whether note fields advanced. */
export function upsertPain(state: ConvState, rawInput: RawPainInput | undefined | null): boolean {
  const raw = coerceRawPain(rawInput);

  if (state.pains.length === 0) {
    const merged = mergeSlots(undefined, raw);
    state.pains.push(merged);
    state.currentPainIndex = 0;
    return notesChanged(undefined, merged);
  }

  const current = state.pains[state.currentPainIndex];
  const rawTopic = typeof raw.topic === "string" && raw.topic.trim() ? raw.topic.trim() : current?.topic ?? "(unspecified)";

  if (!current || sameTopic(rawTopic, current.topic)) {
    const before: NoteSnapshot = {
      trigger: current?.trigger ?? null,
      friction: current?.friction ?? null,
      who: current?.who ?? null,
      howOften: current?.howOften ?? null,
    };
    const merged = mergeSlots(current, raw);
    state.pains[state.currentPainIndex] = merged;
    return notesChanged(before, merged);
  }

  // New topic — append if current is done and under cap
  if ((current.status === "resolved" || current.status === "deadend") && state.pains.length < MAX_PAINS) {
    const merged = mergeSlots(undefined, raw);
    state.pains.push(merged);
    state.currentPainIndex = state.pains.length - 1;
    return notesChanged(undefined, merged);
  }

  // Cap reached — overwrite pain at index 1
  if (state.pains.length >= MAX_PAINS) {
    const existing = state.pains[1];
    const before: NoteSnapshot = {
      trigger: existing.trigger,
      friction: existing.friction,
      who: existing.who,
      howOften: existing.howOften,
    };
    const merged = mergeSlots(existing, raw);
    state.pains[1] = merged;
    state.currentPainIndex = 1;
    return notesChanged(before, merged);
  }

  // Current still drilling but model changed topic — overwrite current
  const before: NoteSnapshot = {
    trigger: current.trigger,
    friction: current.friction,
    who: current.who,
    howOften: current.howOften,
  };
  const merged = mergeSlots(current, { ...raw, topic: rawTopic });
  state.pains[state.currentPainIndex] = merged;
  return notesChanged(before, merged);
}

function sameTopic(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
  for (const pain of state.pains) {
    pain.drillCount ??= 0;
  }
  return state;
}
