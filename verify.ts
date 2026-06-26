import { validateIdeas } from "./src/services/ideas/ideas.service.js";
import {
  autoDeadendIncompletePains,
  isPainResolved,
  normalizeState,
  upsertPain,
} from "./src/services/interview/pain.js";
import { checkInput } from "./src/shared/input.js";
import type { ConvState, Pain } from "./src/shared/types.js";

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


const okText = (r: ReturnType<typeof checkInput>) => r.ok ? r.text : null;
ok(okText(checkInput("  add a deploy alert  ")) === "add a deploy alert", "clean input trimmed + allowed");
ok(okText(checkInput(undefined)) === "" && okText(checkInput("")) === "", "empty allowed (text='')");
ok(!checkInput("x".repeat(1001)).ok, "over 1000 blocked");
ok(!checkInput("the api_key=ABC123secret").ok, "credentials blocked");
ok(!checkInput("my id is 1234567890123").ok, "PII (national id) blocked");
ok(!checkInput("email me at a@b.com").ok, "PII (email) blocked");
ok(!checkInput("this is shit").ok, "abuse blocked");
ok(checkInput("deploys announced by hand, painful").ok, "normal pain text passes");

// --- validateIdeas ---
const good = [{ title: "t", problem: "p", triggeringEvidence: "saw 15 msgs", trigger: "tr", steps: ["s"], effort: "S" }];
ok(validateIdeas(good).valid.length === 1, "complete idea passes");

const noEvidence = [{ title: "t", problem: "p", triggeringEvidence: "", trigger: "tr", steps: ["s"], effort: "S" }];
ok(validateIdeas(noEvidence).valid.length === 0, "empty evidence rejected");

const noSteps = [{ title: "t", problem: "p", triggeringEvidence: "x", trigger: "tr", steps: [], effort: "S" }];
ok(validateIdeas(noSteps).valid.length === 0, "no steps rejected");

const missing = [{ title: "t", steps: ["s"], effort: "S" }];
ok(validateIdeas(missing).valid.length === 0, "missing fields rejected");

// --- pain: overwrite same topic ---
{
  const state = baseState();
  upsertPain(state, { topic: "deploys", trigger: "push to main" });
  upsertPain(state, { topic: "deploys", friction: "manual announce" });
  ok(state.pains.length === 1, "overwrite: single pain");
  ok(state.pains[0].trigger === "push to main", "overwrite: keeps trigger");
  ok(state.pains[0].friction === "manual announce", "overwrite: updates friction");
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
      { topic: "a", trigger: "1", friction: "2", who: "3", howOften: "4", status: "resolved" },
      { topic: "b", trigger: "x", friction: null, who: null, howOften: null, status: "drilling" },
    ],
    currentPainIndex: 1,
  });
  upsertPain(state, { topic: "c", trigger: "new" });
  ok(state.pains.length === 2, "cap: still 2 pains");
  ok(state.pains[1].topic === "c", "cap: overwrites index 1");
  ok(state.currentPainIndex === 1, "cap: index stays 1");
}

// --- pain: four slots -> resolved ---
{
  const pain: Pain = {
    topic: "t",
    trigger: "a",
    friction: "b",
    who: "c",
    howOften: "d",
    status: "drilling",
  };
  ok(isPainResolved(pain), "four slots resolved");
}

// --- pain: auto-deadend on ceiling ---
{
  const state = baseState({
    questionsAsked: 4,
    pains: [{ topic: "t", trigger: "a", friction: null, who: null, howOften: null, status: "drilling" }],
  });
  autoDeadendIncompletePains(state);
  ok(state.pains[0].status === "deadend", "auto-deadend on ceiling");
}

// --- pain: auto-deadend on forceProposed ---
{
  const state = baseState({
    forceProposed: true,
    pains: [{ topic: "t", trigger: null, friction: null, who: null, howOften: null, status: "drilling" }],
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
  const legacy = { threadTs: "1", channel: "C", user: "U", phase: "interview", history: [], questionsAsked: 0, proposedIdeas: [] } as ConvState;
  normalizeState(legacy);
  ok(Array.isArray(legacy.pains) && legacy.forceProposed === false, "normalizeState defaults");
}

console.log(`PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
