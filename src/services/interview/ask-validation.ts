// Deterministic ask_user validation — mirrors validateIdeas discipline on the interview path.

import type { ConvState } from "../../shared/types.js";
import { parseAnswerQuality } from "./answer-quality.js";

export type AskValidation = { ok: true } | { ok: false; reason: string };

export function validateAskUser(
  args: {
    question?: unknown;
    quick_replies?: unknown;
    pain?: { lastAnswerQuality?: unknown; status?: unknown };
  },
  state: ConvState,
  notesAdvanced: boolean,
  lastUserAnswer: string,
): AskValidation {
  // Check 1 — recommendation present (pass-through for now; open questions trusted to prompt)
  const quick = args.quick_replies;
  if (Array.isArray(quick) && quick.length > 0) {
    // pass
  }

  const reportedQuality = parseAnswerQuality(args.pain?.lastAnswerQuality);
  const hasPriorAnswer = lastUserAnswer.trim().length > 0;

  // Check 3 — thin may not advance or resolve
  if (hasPriorAnswer && reportedQuality === "thin") {
    const resolving = args.pain?.status === "resolved" || state.pains[state.currentPainIndex]?.status === "resolved";
    if (resolving || notesAdvanced) {
      return {
        ok: false,
        reason:
          "You marked the last answer 'thin'. Ask one more question on the same point before moving on or resolving.",
      };
    }
  }

  // Check 2 — resolution gate (only when current pain is resolved)
  const currentPain = state.pains[state.currentPainIndex];
  if (!currentPain || currentPain.status !== "resolved") {
    return { ok: true };
  }

  if (currentPain.drillCount < 2) {
    return {
      ok: false,
      reason: `Don't resolve yet: only ${currentPain.drillCount} drill(s) on this pain`,
    };
  }

  if (!notesAdvanced) {
    return {
      ok: false,
      reason: "Don't resolve yet: the last answer didn't add new detail — press once more before resolving.",
    };
  }

  return { ok: true };
}
