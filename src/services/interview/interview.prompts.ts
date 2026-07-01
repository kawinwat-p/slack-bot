// System prompt + tool schemas for the interview/generate agent loop (OpenAI format).
// Choosing ask_user continues the interview; choosing generate_workflow IS the "I'm
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
        "Update pain with whatever you've learned (the trigger/friction/who/howOften/connectors fields are free-form notes, not a checklist). " +
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
              connectors: {
                type: "string",
                description:
                  "(optional note) Systems this pain touches and HOW — how a signal is detected, and how an action reaches its target. " +
                  "Record what's stated or obvious; leave the unknown half for your next question.",
              },
              status: {
                type: "string",
                enum: ["drilling", "resolved", "deadend"],
                description:
                  "drilling = still grilling; resolved = you and the user share a clear understanding of this pain; deadend = irrelevant.",
              },
              lastAnswerQuality: {
                type: "string",
                enum: ["substantive", "thin", "dont_know"],
                description: "Label the answer you JUST received. Omit on first ask_user.",
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
      name: "generate_workflow",
      description:
        "Stop interviewing and generate ONE complete workflow spec for the pain you now understand. " +
        "Call this once at least one pain is resolved (or the question budget is exhausted). " +
        "Apply the loop-me bar: an implementer could build this WITHOUT asking a single question. " +
        "Use loop-me vocabulary (Trigger, Checkpoint, Push right, Brief) only when the workflow " +
        "calls for them — no AI, no checkpoint, and no schedule are fine if the grilling shows so.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          slug: { type: "string", description: "kebab-case filename stem for the uploaded .md" },
          triggeringEvidence: { type: "string", description: "Observed signal. MUST be non-empty." },
          markdown: {
            type: "string",
            description:
              "The FULL workflow spec in Markdown. Free-form structure; loop-me bar is the only " +
              "hard requirement. Only wire connectors you are confident exist; if an integration's " +
              "access is unclear, encode it as an explicit manual/human step — never assume it works.",
          },
          briefBullets: {
            type: "array",
            items: { type: "string" },
            description: "3–5 condensed, decision-ready step bullets for the Slack brief (loop-me Brief).",
          },
          triggerSummary: { type: "string", description: "One-line trigger summary for the brief, if any." },
          checkpointSummary: {
            type: "string",
            description: "One-line checkpoint summary, or e.g. 'Autonomous — no checkpoint'.",
          },
          connectorsUsed: {
            type: "array",
            items: { type: "string" },
            description: "Connectors this workflow touches (from context or explicit in spec).",
          },
        },
        required: ["title", "slug", "triggeringEvidence", "markdown", "briefBullets", "connectorsUsed"],
      },
    },
  },
];

// --- prompt section builders (static vs dynamic) ---

function sectionRole(): string {
  return [
    "## Role",
    "You are a workflow-spec agent inside Slack.",
    "Read the channel context, drill into specific pains with short grounded questions, then generate ONE workflow spec the team could actually build.",
    "",
    "## Loop-me bar",
    "A workflow spec is done when an implementer could build it without asking a single question.",
    "Find delegatable loops in the user's work. Vocabulary (Trigger, Checkpoint, Push right, Brief) is guidance only —",
    "mandate nothing structural. A workflow needs no AI, no checkpoint, and no schedule unless the grilling shows it does.",
  ].join("\n");
}

function sectionConstraints(questionsAsked: number): string {
  return [
    "## Constraints",
    `- Question budget: ${questionsAsked}/${MAX_QUESTIONS} used. Never exceed ${MAX_QUESTIONS} ask_user calls.`,
    "- One tool per turn: ask_user OR generate_workflow — never both, never plain text.",
    "- No generic questions (e.g. 'what does your team do?'). Every question must cite observed context or a prior answer.",
    "- Do not invent tools, teams, or facts absent from context or the user's replies.",
    "- Before generating: if a connector's access, ownership, or manual steps are unclear, ask about it. Don't assume an integration works.",
    "- Prefer workflows that use tools and connectors the team already mentions in context.",
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
    "- Systems / connectors: when a pain implies a system interaction whose mechanism is still unknown — how a signal is noticed, or how an action reaches its target — ask that as your next grounded question and record what you learn in pain.connectors. Examples: \"Claude tokens running out\" → ask how they know; \"contact HR\" → ask Slack vs email vs form; \"deploy bot already posts to #releases\" → don't ask, record Slack.",
    `- Max ${MAX_PAINS} pains per session. Open pain #2 only after pain #1 is resolved or deadend.`,
    "- Mark pain.status resolved the moment understanding is shared; deadend if it turns out irrelevant.",
    "- Call generate_workflow once at least one pain is resolved (or the question budget is nearly exhausted).",
    "",
    "After each answer, judge it and set pain.lastAnswerQuality:",
    "- substantive — a real answer → drill the next aspect normally.",
    "- thin — vague, off-target, or fragmentary → ask ONE more question on the SAME point.",
    "  Do not jump to a new aspect, and do not resolve, off a thin answer.",
    "- dont_know — the user explicitly can't say (any aspect) → accept it; drill another aspect",
    "  or mark the pain resolved if impact is already clear (friction or who filled).",
    "  Do NOT re-ask the same thing.",
    "",
    "Before generate_workflow (normal path): mark at least one pain resolved with concrete friction",
    "or who. dont_know on some aspects is fine if impact is clear elsewhere. If nothing",
    "substantive was learned, mark deadend — do not generate. Skip means the user wants a workflow",
    "anyway.",
  ].join("\n");
}

function sectionObservedContext(context: ContextSummary): string {
  return [
    "## Observed context (from recent channel messages)",
    `Tools mentioned: ${context.tools.length ? context.tools.join(", ") : "(none detected)"}`,
    `Connectors spotted: ${context.connectors.length ? context.connectors.join(", ") : "(none detected)"}`,
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
      `  what you know so far — trigger: ${slotLabel(p.trigger)} | friction: ${slotLabel(p.friction)} | who: ${slotLabel(p.who)} | howOften: ${slotLabel(p.howOften)} | connectors: ${slotLabel(p.connectors ?? null)}`,
    );
    if (p.lastAnswerQuality && i === currentIndex) {
      lines.push(`  last answer quality: ${p.lastAnswerQuality}`);
    }
  }

  return lines.join("\n");
}

function sectionToolChoice(context: ContextSummary, questionsAsked: number, pains: Pain[], currentIndex: number): string {
  const current = pains[currentIndex];
  const remaining = MAX_QUESTIONS - questionsAsked;

  let guidance: string;
  if (remaining <= 0) {
    guidance = "Budget exhausted — call generate_workflow now using what you know.";
  } else if (!current) {
    guidance = context.painPoints.length
      ? "Call ask_user: ask which detected pain point relates to the user most, passing short quick_reply labels (≤75 chars). Don't pick for them."
      : "Call ask_user with one open grounded question to surface a pain (no pain points detected in context).";
  } else if (current.status === "deadend") {
    guidance = pains.length < MAX_PAINS
      ? "Current pain is deadend — start a new pain or call generate_workflow."
      : "Call generate_workflow.";
  } else if (current.status === "resolved") {
    guidance = pains.length < MAX_PAINS
      ? "Current pain resolved — open pain #2 or call generate_workflow."
      : "Call generate_workflow.";
  } else {
    guidance =
      `Keep grilling "${current.topic}": ask the next question that resolves what you still don't understand ` +
      "(include your recommended answer). Mark it resolved once you share a clear understanding, then generate_workflow.";
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
