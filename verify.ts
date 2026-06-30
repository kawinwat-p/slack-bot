import { validateIdeas } from "./src/services/ideas/ideas.service.js";
import {
  getLastUserAnswer,
  hasImpactSignal,
} from "./src/services/interview/answer-quality.js";
import { validateAskUser } from "./src/services/interview/ask-validation.js";
import {
  autoDeadendIncompletePains,
  normalizeState,
  upsertPain,
} from "./src/services/interview/pain.js";
import { MAX_QUESTIONS } from "./src/services/interview/interview.prompts.js";
import { validateProposeGate } from "./src/services/interview/propose-validation.js";
import { checkInput } from "./src/shared/input.js";
import { cosineTopK } from "./src/services/context/rag.js";
import type { ConvState } from "./src/shared/types.js";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => {
  c ? pass++ : (fail++, console.log("FAIL:", m));
};

function baseState(overrides: Partial<ConvState> = {}): ConvState {
  return {
    threadTs: "1.0",
    channel: "C",
    user: "U",
    phase: "interview",
    history: [],
    questionsAsked: 0,
    proposedIdeas: [],
    pains: [],
    currentPainIndex: 0,
    forceProposed: false,
    ...overrides,
  };
}

// --- input ---

const okText = (r: ReturnType<typeof checkInput>) => (r.ok ? r.text : null);
ok(
  okText(checkInput("  add a deploy alert  ")) === "add a deploy alert",
  "clean input trimmed + allowed",
);
ok(
  okText(checkInput(undefined)) === "" && okText(checkInput("")) === "",
  "empty allowed (text='')",
);
ok(!checkInput("x".repeat(1001)).ok, "over 1000 blocked");
ok(!checkInput("the api_key=ABC123secret").ok, "credentials blocked");
ok(!checkInput("my id is 1234567890123").ok, "PII (national id) blocked");
ok(!checkInput("email me at a@b.com").ok, "PII (email) blocked");
ok(!checkInput("this is shit").ok, "abuse blocked");
ok(
  checkInput("deploys announced by hand, painful").ok,
  "normal pain text passes",
);

// --- cosineTopK (RAG retrieval) ---
ok(
  cosineTopK(
    [1, 0],
    [
      [1, 0],
      [0, 1],
      [0.9, 0.1],
    ],
    2,
  ).join(",") === "0,2",
  "cosineTopK picks the two nearest",
);
ok(
  cosineTopK(
    [1, 0],
    [
      [0, 1],
      [1, 0],
    ],
    1,
  )[0] === 1,
  "cosineTopK returns best index",
);

// --- validateIdeas ---
const good = [
  {
    title: "t",
    problem: "p",
    triggeringEvidence: "saw 15 msgs",
    trigger: "tr",
    steps: ["s"],
    effort: "S",
  },
];
ok(validateIdeas(good).valid.length === 1, "complete idea passes");

const noEvidence = [
  {
    title: "t",
    problem: "p",
    triggeringEvidence: "",
    trigger: "tr",
    steps: ["s"],
    effort: "S",
  },
];
ok(validateIdeas(noEvidence).valid.length === 0, "empty evidence rejected");

const noSteps = [
  {
    title: "t",
    problem: "p",
    triggeringEvidence: "x",
    trigger: "tr",
    steps: [],
    effort: "S",
  },
];
ok(validateIdeas(noSteps).valid.length === 0, "no steps rejected");

const missing = [{ title: "t", steps: ["s"], effort: "S" }];
ok(validateIdeas(missing).valid.length === 0, "missing fields rejected");

function upsertFlags(notesAdvanced: boolean, newSlotFilled = notesAdvanced) {
  return { notesAdvanced, newSlotFilled };
}

// --- validateAskUser ---
{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "resolved",
        drillCount: 1,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { status: "resolved" } },
    state,
    upsertFlags(true),
    "",
  );
  ok(
    !v.ok && v.reason.includes("only 1 drill"),
    "validateAskUser: rejects 1 drill resolve",
  );
}

{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: "b",
        who: "c",
        howOften: "d",
        connectors: null,
        status: "resolved",
        drillCount: 2,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { status: "resolved" } },
    state,
    upsertFlags(false),
    "still drilling",
  );
  ok(
    !v.ok && v.reason.includes("didn't add new detail"),
    "validateAskUser: rejects unchanged notes without quality label",
  );
}

{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: "b",
        who: "c",
        howOften: null,
        connectors: null,
        status: "resolved",
        drillCount: 4,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { status: "resolved", lastAnswerQuality: "substantive" } },
    state,
    upsertFlags(false),
    "Yes, that's exactly it",
  );
  ok(
    v.ok,
    "validateAskUser: resolve after substantive confirmation without note change",
  );
}

{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: "b",
        who: "c",
        howOften: "d",
        connectors: null,
        status: "resolved",
        drillCount: 2,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { status: "resolved" } },
    state,
    upsertFlags(true),
    "weekly",
  );
  ok(v.ok, "validateAskUser: accepts 2 drills + notes advanced");
}

// --- validateAskUser Check 3 ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "daily",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 1,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { lastAnswerQuality: "thin", who: "POs" } },
    state,
    upsertFlags(true),
    "PO maybe",
  );
  ok(
    !v.ok && v.reason.includes("'thin'"),
    "validateAskUser Check 3: thin + newSlotFilled",
  );
}

{
  const state = baseState({
    pains: [
      {
        topic: "decisions",
        trigger: "meeting ends",
        friction: "no summary",
        who: "lead",
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 3,
      },
    ],
  });
  const v = validateAskUser(
    {
      pain: { lastAnswerQuality: "thin", friction: "no summary; team re-asks" },
    },
    state,
    upsertFlags(true, false),
    "hope everyone remembers lol",
  );
  ok(v.ok, "validateAskUser Check 3: thin + refine existing slot passes");
}

{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 2,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { lastAnswerQuality: "thin", status: "resolved" } },
    state,
    upsertFlags(false),
    "maybe",
  );
  ok(
    !v.ok && v.reason.includes("'thin'"),
    "validateAskUser Check 3: thin + resolved",
  );
}

{
  const state = baseState({
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 1,
      },
    ],
  });
  const v = validateAskUser(
    { pain: { lastAnswerQuality: "dont_know", howOften: "unknown" } },
    state,
    upsertFlags(true),
    "not sure",
  );
  ok(v.ok, "validateAskUser: dont_know + advance passes");
}

// --- getLastUserAnswer ---
{
  const history = [
    { role: "user" as const, content: "Begin." },
    { role: "tool" as const, tool_call_id: "a", content: "skipped" },
    { role: "tool" as const, tool_call_id: "b", content: "real answer" },
    { role: "assistant" as const, content: null },
  ];
  ok(
    getLastUserAnswer(history) === "real answer",
    "getLastUserAnswer: skips skipped + assistant",
  );
}

// --- validateProposeGate ---
{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "push",
        friction: "manual announce",
        who: null,
        howOften: null,
        connectors: null,
        status: "resolved",
        drillCount: 2,
      },
    ],
  });
  ok(validateProposeGate(state).ok, "propose gate: resolved + friction passes");
}

{
  const state = baseState({
    pains: [
      {
        topic: "deploys",
        trigger: "push",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 2,
      },
    ],
  });
  ok(!validateProposeGate(state).ok, "propose gate: all drilling fails");
}

{
  const state = baseState({
    forceProposed: true,
    pains: [
      {
        topic: "x",
        trigger: null,
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 0,
      },
    ],
  });
  ok(validateProposeGate(state).ok, "propose gate: forceProposed bypass");
}

{
  const state = baseState({
    pains: [
      {
        topic: "x",
        trigger: null,
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "deadend",
        drillCount: 1,
      },
    ],
  });
  ok(!validateProposeGate(state).ok, "propose gate: deadend no impact fails");
}

{
  ok(
    hasImpactSignal({
      topic: "t",
      trigger: null,
      friction: "",
      who: "eng",
      howOften: null,
      connectors: null,
      status: "drilling",
      drillCount: 0,
    }),
    "hasImpactSignal: who counts",
  );
}

// --- pain: overwrite same topic ---
{
  const state = baseState();
  upsertPain(state, { topic: "deploys", trigger: "push to main" });
  upsertPain(state, { topic: "deploys", friction: "manual announce" });
  ok(state.pains.length === 1, "overwrite: single pain");
  ok(state.pains[0].trigger === "push to main", "overwrite: keeps trigger");
  ok(
    state.pains[0].friction === "manual announce",
    "overwrite: updates friction",
  );
  ok(state.pains[0].drillCount === 0, "overwrite: drillCount defaults 0");
}

// --- pain: notesAdvanced on upsert ---
{
  const state = baseState();
  upsertPain(state, { topic: "deploys", trigger: "push" });
  const advanced = upsertPain(state, { topic: "deploys", friction: "manual" });
  ok(advanced.notesAdvanced, "notesAdvanced: true when friction added");
  ok(advanced.newSlotFilled, "newSlotFilled: true when friction first filled");
  const same = upsertPain(state, { topic: "deploys", friction: "manual" });
  ok(!same.notesAdvanced, "notesAdvanced: false when notes unchanged");
  const refined = upsertPain(state, {
    topic: "deploys",
    friction: "manual announce",
  });
  ok(refined.notesAdvanced, "notesAdvanced: true when friction text refined");
  ok(!refined.newSlotFilled, "newSlotFilled: false when refining filled slot");
}

// --- pain: connectors merge (memory only, not notesAdvanced) ---
{
  const state = baseState();
  upsertPain(state, { topic: "billing", trigger: "tokens low" });
  upsertPain(state, { topic: "billing", connectors: "Slack DM to HR" });
  ok(
    state.pains[0].connectors === "Slack DM to HR",
    "connectors: persists on same topic",
  );
  upsertPain(state, { topic: "billing", friction: "manual outreach" });
  ok(
    state.pains[0].connectors === "Slack DM to HR",
    "connectors: preserved when omitted on re-upsert",
  );
  const onlyConnectors = upsertPain(state, {
    topic: "billing",
    connectors: "email to HR",
  });
  ok(
    !onlyConnectors.notesAdvanced,
    "connectors: change alone does not advance notes",
  );
}

// --- pain: append after resolved ---
{
  const state = baseState();
  upsertPain(state, {
    topic: "deploys",
    trigger: "a",
    friction: "b",
    who: "c",
    howOften: "d",
    status: "resolved",
  });
  ok(state.pains[0].status === "resolved", "append: first pain resolved");
  upsertPain(state, { topic: "staging", trigger: "daily check" });
  ok(state.pains.length === 2, "append: second pain added");
  ok(state.currentPainIndex === 1, "append: index advanced");
}

// --- pain: cap at 2 overwrites index 1 ---
{
  const state = baseState({
    pains: [
      {
        topic: "a",
        trigger: "1",
        friction: "2",
        who: "3",
        howOften: "4",
        connectors: null,
        status: "resolved",
        drillCount: 0,
      },
      {
        topic: "b",
        trigger: "x",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 0,
      },
    ],
    currentPainIndex: 1,
  });
  upsertPain(state, { topic: "c", trigger: "new" });
  ok(state.pains.length === 2, "cap: still 2 pains");
  ok(state.pains[1].topic === "c", "cap: overwrites index 1");
  ok(state.currentPainIndex === 1, "cap: index stays 1");
}

// --- pain: auto-deadend on ceiling ---
{
  const state = baseState({
    questionsAsked: MAX_QUESTIONS,
    pains: [
      {
        topic: "t",
        trigger: "a",
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 0,
      },
    ],
  });
  autoDeadendIncompletePains(state);
  ok(state.pains[0].status === "deadend", "auto-deadend on ceiling");
}

// --- pain: auto-deadend on forceProposed ---
{
  const state = baseState({
    forceProposed: true,
    pains: [
      {
        topic: "t",
        trigger: null,
        friction: null,
        who: null,
        howOften: null,
        connectors: null,
        status: "drilling",
        drillCount: 0,
      },
    ],
  });
  autoDeadendIncompletePains(state);
  ok(state.pains[0].status === "deadend", "auto-deadend on forceProposed");
}

// --- pain: model-declared deadend ---
{
  const state = baseState();
  upsertPain(state, { topic: "irrelevant", status: "deadend" });
  ok(state.pains[0].status === "deadend", "model deadend preserved");
}

// --- normalizeState backward compat ---
{
  const legacy = {
    threadTs: "1",
    channel: "C",
    user: "U",
    phase: "interview",
    history: [],
    questionsAsked: 0,
    proposedIdeas: [],
  } as ConvState;
  legacy.pains = [
    {
      topic: "t",
      trigger: null,
      friction: null,
      who: null,
      howOften: null,
      connectors: null,
      status: "drilling",
    } as ConvState["pains"][0],
  ];
  normalizeState(legacy);
  ok(
    Array.isArray(legacy.pains) && legacy.forceProposed === false,
    "normalizeState defaults",
  );
  ok(legacy.pains[0].drillCount === 0, "normalizeState drillCount default");
}

console.log(`PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
