// Propose gate — normal path requires resolved pain with impact; Skip/ceiling bypass.

import type { ConvState } from "../../shared/types.js";
import { hasImpactSignal } from "./answer-quality.js";
import { MAX_QUESTIONS } from "./interview.prompts.js";

export type ProposeValidation = { ok: true } | { ok: false; reason: string };

export function validateProposeGate(state: ConvState): ProposeValidation {
  if (state.forceProposed || state.questionsAsked >= MAX_QUESTIONS) {
    return { ok: true };
  }

  const resolvedWithImpact = state.pains.some(
    (p) => p.status === "resolved" && p.topic.trim() && hasImpactSignal(p),
  );
  if (resolvedWithImpact) {
    return { ok: true };
  }

  if (
    state.pains.length > 0 &&
    state.pains.every((p) => p.status === "deadend") &&
    !state.pains.some(hasImpactSignal)
  ) {
    return {
      ok: false,
      reason: "No pain worth solving — need friction or who from a substantive answer, or use Skip.",
    };
  }

  return {
    ok: false,
    reason:
      "Need at least one resolved pain with concrete friction or who before proposing. Mark the pain resolved or ask the user to Skip.",
  };
}
