// Idea schema + deterministic validation (§5.2 / §5.3, Q7).
//
// The LLM COMPOSES ideas; these rules GUARANTEE feasibility. We never ask the LLM
// "is this feasible?" — that just re-introduces hallucination. Instead every idea
// must (a) be built only from blocks allowed for this team, and (b) cite a non-empty
// triggering evidence. Anything failing is dropped before the user ever sees it.

import { randomUUID } from "node:crypto";
import type { BlockId, Idea } from "./types.js";
import { getBlock } from "./catalog.js";

export interface ValidationResult {
  valid: Idea[];
  rejected: { idea: Partial<Idea>; reason: string }[];
}

/** Coerce a raw LLM object into an Idea, or return null if structurally unusable. */
function coerce(raw: any): Partial<Idea> | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: randomUUID(),
    title: typeof raw.title === "string" ? raw.title : undefined,
    problem: typeof raw.problem === "string" ? raw.problem : undefined,
    triggeringEvidence:
      typeof raw.triggeringEvidence === "string" ? raw.triggeringEvidence : undefined,
    trigger: typeof raw.trigger === "string" ? raw.trigger : undefined,
    steps: Array.isArray(raw.steps) ? raw.steps.filter((s: unknown) => typeof s === "string") : [],
    blocks: Array.isArray(raw.blocks) ? raw.blocks : [],
    effort: ["S", "M", "L"].includes(raw.effort) ? raw.effort : undefined,
  };
}

export function validateIdeas(rawIdeas: unknown[], allowedBlocks: BlockId[]): ValidationResult {
  const allowed = new Set(allowedBlocks);
  const valid: Idea[] = [];
  const rejected: { idea: Partial<Idea>; reason: string }[] = [];

  for (const raw of rawIdeas) {
    const idea = coerce(raw);
    if (!idea) {
      rejected.push({ idea: {}, reason: "not an object" });
      continue;
    }

    // Schema completeness.
    const missing = (["title", "problem", "triggeringEvidence", "trigger", "effort"] as const).filter(
      (k) => !idea[k],
    );
    if (missing.length) {
      rejected.push({ idea, reason: `missing fields: ${missing.join(", ")}` });
      continue;
    }
    if (!idea.steps || idea.steps.length === 0) {
      rejected.push({ idea, reason: "no steps" });
      continue;
    }

    // Required: non-empty evidence (§5.3).
    if (!idea.triggeringEvidence!.trim()) {
      rejected.push({ idea, reason: "empty triggeringEvidence" });
      continue;
    }

    // Every block must be real AND allowed for this team (§5.1).
    const blocks = idea.blocks as BlockId[];
    if (!blocks.length) {
      rejected.push({ idea, reason: "no blocks" });
      continue;
    }
    const badBlock = blocks.find((b) => !getBlock(b) || !allowed.has(b));
    if (badBlock) {
      rejected.push({ idea, reason: `block not allowed for this team: ${badBlock}` });
      continue;
    }

    valid.push(idea as Idea);
  }

  return { valid, rejected };
}
