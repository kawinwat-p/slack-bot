// Idea schema + deterministic validation. The LLM COMPOSES ideas; these rules
// GUARANTEE feasibility. Every idea must (a) be built only from blocks allowed for the
// team, and (b) cite a non-empty triggering evidence. Failures are dropped.

import { randomUUID } from "node:crypto";
import { getBlock } from "../catalog/catalog.js";
import type { BlockId, Idea } from "../../shared/types.js";

export interface ValidationResult {
  valid: Idea[];
  rejected: { idea: Partial<Idea>; reason: string }[];
}

function coerce(raw: any): Partial<Idea> | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: randomUUID(),
    title: typeof raw.title === "string" ? raw.title : undefined,
    problem: typeof raw.problem === "string" ? raw.problem : undefined,
    triggeringEvidence: typeof raw.triggeringEvidence === "string" ? raw.triggeringEvidence : undefined,
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

    const missing = (["title", "problem", "triggeringEvidence", "trigger", "effort"] as const).filter((k) => !idea[k]);
    if (missing.length) {
      rejected.push({ idea, reason: `missing fields: ${missing.join(", ")}` });
      continue;
    }
    if (!idea.steps || idea.steps.length === 0) {
      rejected.push({ idea, reason: "no steps" });
      continue;
    }
    if (!idea.triggeringEvidence!.trim()) {
      rejected.push({ idea, reason: "empty triggeringEvidence" });
      continue;
    }

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
