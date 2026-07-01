// Deterministic validation for generate_workflow tool output.

import { randomUUID } from "node:crypto";
import type { WorkflowSpec } from "../../shared/types.js";

export class SpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecValidationError";
  }
}

export function coerceSpec(args: Record<string, unknown>, id?: string): WorkflowSpec {
  const title = String(args.title ?? "").trim();
  const slug = String(args.slug ?? "").trim();
  const triggeringEvidence = String(args.triggeringEvidence ?? "").trim();
  const markdown = String(args.markdown ?? "").trim();
  const briefBullets = Array.isArray(args.briefBullets)
    ? args.briefBullets.map(String).filter((b) => b.trim())
    : [];
  const connectorsUsed = Array.isArray(args.connectorsUsed)
    ? args.connectorsUsed.map(String).filter((c) => c.trim())
    : [];

  if (!title) throw new SpecValidationError("title is required");
  if (!slug) throw new SpecValidationError("slug is required");
  if (!triggeringEvidence) throw new SpecValidationError("triggeringEvidence is required");
  if (!markdown) throw new SpecValidationError("markdown is required");
  if (briefBullets.length === 0) throw new SpecValidationError("briefBullets must be non-empty");

  return {
    id: id ?? randomUUID(),
    title,
    slug,
    triggeringEvidence,
    markdown,
    briefBullets,
    triggerSummary: args.triggerSummary != null ? String(args.triggerSummary) : undefined,
    checkpointSummary: args.checkpointSummary != null ? String(args.checkpointSummary) : undefined,
    connectorsUsed,
  };
}
