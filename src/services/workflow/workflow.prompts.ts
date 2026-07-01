// Prompts for workflow regeneration (Refine path).

import type { ConvState, WorkflowSpec } from "../../shared/types.js";

const LOOP_ME_BAR = [
  "Apply the loop-me bar: an implementer could build this WITHOUT asking a single question.",
  "Use loop-me vocabulary (Trigger, Checkpoint, Push right, Brief) only when the workflow calls for them.",
  "Mandate nothing structural — free-form markdown is fine.",
].join(" ");

export function regenerateMessages(state: ConvState, feedback: string): { role: "system" | "user"; content: string }[] {
  const spec = state.currentSpec!;
  const contextBlock = state.context
    ? [
        `Tools: ${state.context.tools.join(", ") || "(none)"}`,
        `Connectors: ${state.context.connectors.join(", ") || "(none)"}`,
        `Summary: ${state.context.summary}`,
      ].join("\n")
    : "(no context)";

  return [
    {
      role: "system",
      content: [
        "You revise workflow specs based on user feedback.",
        LOOP_ME_BAR,
        "",
        "Reply ONLY as JSON with these fields:",
        '{"title","slug","triggeringEvidence","markdown","briefBullets","triggerSummary","checkpointSummary","connectorsUsed"}',
        "briefBullets: 3-5 decision-ready strings. connectorsUsed: string array.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## Channel context",
        contextBlock,
        "",
        "## Current spec",
        JSON.stringify(specToPayload(spec), null, 2),
        "",
        "## User feedback — revise the spec to address:",
        feedback,
      ].join("\n"),
    },
  ];
}

function specToPayload(spec: WorkflowSpec): Record<string, unknown> {
  return {
    title: spec.title,
    slug: spec.slug,
    triggeringEvidence: spec.triggeringEvidence,
    markdown: spec.markdown,
    briefBullets: spec.briefBullets,
    triggerSummary: spec.triggerSummary,
    checkpointSummary: spec.checkpointSummary,
    connectorsUsed: spec.connectorsUsed,
  };
}

export function parseRegenerateResponse(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
