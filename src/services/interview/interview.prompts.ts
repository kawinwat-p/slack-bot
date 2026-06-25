// System prompt + tool schemas for the interview/propose agent loop (OpenAI format).
// Choosing ask_user continues the interview; choosing propose_ideas IS the "I'm
// confident now" decision (termination = a tool choice).

import type { ChatTool, ContextSummary } from "../../shared/types.js";

export const MAX_QUESTIONS = 4; // hard ceiling

export const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user ONE sharp, context-grounded question to close a specific gap. " +
        "Only ask when the answer will materially change which ideas you propose. " +
        "Prefer quick-reply options when the answer space is small.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          quick_replies: { type: "array", items: { type: "string" }, description: "0-4 short button options. Omit for open-ended questions." },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_ideas",
      description:
        "Stop interviewing and propose 2-4 concrete workflow ideas. Call this the MOMENT " +
        "you can name a specific, observed pain and tie ideas to it. Every idea must cite " +
        "triggeringEvidence.",
      parameters: {
        type: "object",
        properties: {
          ideas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                problem: { type: "string" },
                triggeringEvidence: { type: "string", description: "The observed signal that motivates this. MUST be non-empty." },
                trigger: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                effort: { type: "string", enum: ["S", "M", "L"] },
              },
              required: ["title", "problem", "triggeringEvidence", "trigger", "steps", "effort"],
            },
          },
        },
        required: ["ideas"],
      },
    },
  },
];

export function systemPrompt(context: ContextSummary, questionsAsked: number): string {
  return [
    "You are an agent inside Slack that helps a user find workflow automations worth building.",
    "Your job: a SHORT, sharp interview grounded in what you already observed, then concrete proposals.",
    "",
    "Hard rules:",
    `- You have asked ${questionsAsked}/${MAX_QUESTIONS} questions. Never exceed ${MAX_QUESTIONS}.`,
    "- Do NOT ask generic questions ('what does your team do?'). Every question must build on the observed context below.",
    "- Stop interviewing and call propose_ideas the instant you can name a specific observed pain.",
    "- Always act by calling exactly one tool (ask_user or propose_ideas).",
    "- Prefer ideas that build on tools the team already uses (listed below). Don't assume tools not mentioned.",
    "- Every idea MUST cite a non-empty triggeringEvidence taken from the observed context.",
    "",
    "Observed context (distilled from recent channel messages):",
    `- Tools the team uses: ${context.tools.length ? context.tools.join(", ") : "(none detected)"}`,
    `- Summary: ${context.summary || "(none)"}`,
    `- Pain points: ${context.painPoints.length ? context.painPoints.join("; ") : "(none detected)"}`,
  ].join("\n");
}
