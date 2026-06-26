// System prompt + tool schemas for the interview/propose agent loop (OpenAI format).
// Choosing ask_user continues the interview; choosing propose_ideas IS the "I'm
// confident now" decision (termination = a tool choice).

import type { ChatTool, ContextSummary, Pain } from "../../shared/types.js";

export const MAX_QUESTIONS = 10; // hard ceiling (locked)
export const MAX_PAINS = 2;

export const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask ONE sharp question and keep grilling until you and the user share a real understanding of the pain. " +
        "Every question MUST carry your recommended answer: for closed/small answer spaces put the recommendation " +
        "as quick_replies (2-4 options, best first); for open questions state your recommendation inline in the question text " +
        "(e.g. 'Who owns this — I'd guess the on-call dev?'). " +
        "FIRST TURN (no pains recorded): if context lists pain points, ask which one relates to them most and pass " +
        "those pain points as quick_replies — do NOT pick for them. Set pain.topic from their reply. " +
        "Walk down ONE branch at a time, resolving dependencies between decisions before moving on. Never ask generic " +
        "questions — every question must cite observed context or a prior answer. If the codebase/context already answers " +
        "something, fill it in pain and don't ask. " +
        "Update pain with whatever you've learned (the trigger/friction/who/howOften fields are free-form notes, not a checklist). " +
        "Set pain.status to resolved once understanding is shared, or deadend if the pain is irrelevant.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Single grounded question targeting one empty slot." },
          quick_replies: {
            type: "array",
            items: { type: "string" },
            description: "0-4 short button labels (max 75 chars each). Compress long pain points to a few words.",
          },
          pain: {
            type: "object",
            description: "Pain notes — merge what you know so far; do not drop what you already learned. Fields are optional free-form notes, not required slots.",
            properties: {
              topic: { type: "string", description: "Short label for this pain." },
              trigger: { type: "string", description: "(optional note) What event starts the friction." },
              friction: { type: "string", description: "(optional note) What goes wrong or wastes time." },
              who: { type: "string", description: "(optional note) Who is affected." },
              howOften: { type: "string", description: "(optional note) How often it happens." },
              status: {
                type: "string",
                enum: ["drilling", "resolved", "deadend"],
                description:
                  "drilling = still grilling; resolved = you and the user share a clear understanding of this pain; deadend = irrelevant.",
              },
            },
            required: ["topic"],
          },
        },
        required: ["question", "pain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_ideas",
      description:
        "Stop interviewing and propose 2-4 concrete workflow ideas tied to observed pains. " +
        "Call when you can name a specific pain with enough detail to propose well, " +
        "or when the question budget is exhausted. Every idea needs non-empty triggeringEvidence.",
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
                triggeringEvidence: { type: "string", description: "Observed signal from context or interview. MUST be non-empty." },
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

// --- prompt section builders (static vs dynamic) ---

function sectionRole(): string {
  return [
    "## Role",
    "You are a workflow-ideas agent inside Slack.",
    "Read the channel context, drill into specific pains with short grounded questions, then propose automations the team could actually build.",
  ].join("\n");
}

function sectionConstraints(questionsAsked: number): string {
  return [
    "## Constraints",
    `- Question budget: ${questionsAsked}/${MAX_QUESTIONS} used. Never exceed ${MAX_QUESTIONS} ask_user calls.`,
    "- One tool per turn: ask_user OR propose_ideas — never both, never plain text.",
    "- No generic questions (e.g. 'what does your team do?'). Every question must cite observed context or a prior answer.",
    "- Do not invent tools, teams, or facts absent from context or the user's replies.",
    "- Every proposed idea MUST include non-empty triggeringEvidence from context or interview.",
    "- Prefer ideas that use tools the team already mentions in context.",
  ].join("\n");
}

function sectionInterviewMethod(): string {
  return [
    "## Interview method",
    "Grill the user relentlessly about ONE pain until you and they share a real understanding of it — what",
    "triggers it, what actually goes wrong, who feels it, and how much it costs. This is not a fixed checklist;",
    "think about what you still don't understand and ask that.",
    "",
    "STEP 0 (selection): On your FIRST ask_user, if context lists pain points, ask which one relates to them most",
    "and pass each as a short quick_reply label (≤75 chars; compress, don't paste full sentences). Add 'Something else' if useful. Do NOT choose for them.",
    "Set pain.topic from their answer. If context lists NO pain points, ask one open grounded question to surface a pain.",
    "",
    "How to grill:",
    "- One question per turn, and ALWAYS include your recommended answer (quick_replies for closed questions, inline for open ones).",
    "- Walk down ONE branch of the pain at a time. Resolve a decision before opening the one that depends on it.",
    "- Follow up on vague or surprising answers — don't accept a hand-wave; dig until the branch is actually resolved.",
    "- Never ask a generic question. Every question must cite observed context or something the user just said.",
    "- If context or the codebase already answers something, record it in pain and don't ask.",
    `- Max ${MAX_PAINS} pains per session. Open pain #2 only after pain #1 is resolved or deadend.`,
    "- Mark pain.status resolved the moment understanding is shared; deadend if it turns out irrelevant.",
    "- Call propose_ideas once at least one pain is resolved (or the question budget is nearly exhausted).",
  ].join("\n");
}

function sectionObservedContext(context: ContextSummary): string {
  return [
    "## Observed context (from recent channel messages)",
    `Tools mentioned: ${context.tools.length ? context.tools.join(", ") : "(none detected)"}`,
    `Channel summary: ${context.summary || "(none)"}`,
    `Pain points spotted: ${context.painPoints.length ? context.painPoints.join("; ") : "(none detected)"}`,
  ].join("\n");
}

function slotLabel(value: string | null): string {
  return value != null && value.trim() ? value.trim() : "(empty)";
}

function sectionPainState(pains: Pain[], currentIndex: number): string {
  const lines = ["## Current interview state"];

  if (pains.length === 0) {
    lines.push(
      "No pains recorded yet. If context lists pain points, ask the user which one relates to them most " +
        "(pass short quick_reply labels, ≤75 chars each). Otherwise ask one open grounded question to surface a pain.",
    );
    return lines.join("\n");
  }

  for (let i = 0; i < pains.length; i++) {
    const p = pains[i];
    const marker = i === currentIndex ? " ← CURRENT" : "";
    lines.push(
      `Pain ${i + 1}${marker}: "${p.topic}" [${p.status}]`,
      `  what you know so far — trigger: ${slotLabel(p.trigger)} | friction: ${slotLabel(p.friction)} | who: ${slotLabel(p.who)} | howOften: ${slotLabel(p.howOften)}`,
    );
  }

  return lines.join("\n");
}

function sectionToolChoice(context: ContextSummary, questionsAsked: number, pains: Pain[], currentIndex: number): string {
  const current = pains[currentIndex];
  const remaining = MAX_QUESTIONS - questionsAsked;

  let guidance: string;
  if (remaining <= 0) {
    guidance = "Budget exhausted — call propose_ideas now using what you know.";
  } else if (!current) {
    guidance = context.painPoints.length
      ? "Call ask_user: ask which detected pain point relates to the user most, passing short quick_reply labels (≤75 chars). Don't pick for them."
      : "Call ask_user with one open grounded question to surface a pain (no pain points detected in context).";
  } else if (current.status === "deadend") {
    guidance = pains.length < MAX_PAINS
      ? "Current pain is deadend — start a new pain or call propose_ideas."
      : "Call propose_ideas.";
  } else if (current.status === "resolved") {
    guidance = pains.length < MAX_PAINS
      ? "Current pain resolved — open pain #2 or call propose_ideas."
      : "Call propose_ideas.";
  } else {
    guidance =
      `Keep grilling "${current.topic}": ask the next question that resolves what you still don't understand ` +
      "(include your recommended answer). Mark it resolved once you share a clear understanding, then propose_ideas.";
  }

  return ["## This turn", guidance].join("\n");
}

/** Rebuilt every loop iteration — static rules + live context + pain progress. */
export function systemPrompt(
  context: ContextSummary,
  questionsAsked: number,
  pains: Pain[],
  currentPainIndex: number,
): string {
  return [
    sectionRole(),
    "",
    sectionConstraints(questionsAsked),
    "",
    sectionInterviewMethod(),
    "",
    sectionObservedContext(context),
    "",
    sectionPainState(pains, currentPainIndex),
    "",
    sectionToolChoice(context, questionsAsked, pains, currentPainIndex),
  ].join("\n");
}
