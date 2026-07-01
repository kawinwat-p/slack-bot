import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importJsonStateIfEmpty } from "./src/repositories/state.importer.js";
import { getStateDbForTests, initStateStore, loadState, saveState, closeStateStore, deleteState } from "./src/repositories/state.repository.js";
import type { ConvState } from "./src/shared/types.js";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  c ? pass++ : (fail++, console.log("FAIL:", m));
};

function baseState(overrides: Partial<ConvState> = {}): ConvState {
  return {
    threadTs: "1782717729.379459",
    channel: "C123",
    user: "U456",
    phase: "interview",
    history: [{ role: "user", content: "Begin." }],
    questionsAsked: 1,
    pains: [],
    currentPainIndex: 0,
    forceProposed: false,
    ...overrides,
  };
}

function withTempStore(run: (legacyDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "state-test-"));
  const dbPath = join(root, "test.db");
  const legacyDir = join(root, "legacy");
  mkdirSync(legacyDir, { recursive: true });
  try {
    initStateStore(dbPath, legacyDir);
    run(legacyDir);
  } finally {
    closeStateStore();
    rmSync(root, { recursive: true, force: true });
  }
}

// --- round-trip ---

withTempStore(() => {
  const state = baseState({ pending: { kind: "ask_user", toolCallId: "tc1", otherIds: [] } });
  saveState(state);
  const loaded = loadState(state.threadTs);
  ok(loaded !== undefined, "loadState returns saved state");
  ok(loaded!.threadTs === state.threadTs, "round-trip threadTs");
  ok(loaded!.phase === state.phase, "round-trip phase");
  ok(loaded!.questionsAsked === state.questionsAsked, "round-trip questionsAsked");
  ok(loaded!.pending?.kind === "ask_user", "round-trip pending");
});

withTempStore(() => {
  ok(loadState("9999999999.000000") === undefined, "loadState missing returns undefined");
});

// --- normalize on load ---

withTempStore(() => {
  const raw = { threadTs: "1.0", channel: "C", user: "U", phase: "interview", history: [] };
  saveState(raw as ConvState);
  const loaded = loadState("1.0");
  ok(Array.isArray(loaded!.pains), "normalizeState adds pains on load");
  ok(loaded!.forceProposed === false, "normalizeState adds forceProposed on load");
});

// --- importer: empty DB imports legacy JSON ---

withTempStore((legacyDir) => {
  const threadTs = "1782705942.203549";
  const sanitized = threadTs.replace(/[^\d.]/g, "_");
  writeFileSync(join(legacyDir, `${sanitized}.json`), JSON.stringify(baseState({ threadTs }), null, 2));
  writeFileSync(join(legacyDir, "raw-C123.txt"), "debug dump");

  const root2 = mkdtempSync(join(tmpdir(), "state-import-"));
  const dbPath2 = join(root2, "fresh.db");
  try {
    initStateStore(dbPath2, legacyDir);
    ok(loadState(threadTs)?.threadTs === threadTs, "importer loads legacy JSON on first init");
    ok(loadState("raw-C123.txt") === undefined, "importer skips raw- files");
  } finally {
    closeStateStore();
    rmSync(root2, { recursive: true, force: true });
  }
});

// --- importer: idempotent when DB already has rows ---

withTempStore((legacyDir) => {
  saveState(baseState());
  writeFileSync(
    join(legacyDir, "9999999999.000001.json"),
    JSON.stringify(baseState({ threadTs: "9999999999.000001" }), null, 2),
  );
  const imported = importJsonStateIfEmpty(getStateDbForTests(), legacyDir);
  ok(imported === 0, "importer skips when DB non-empty");
  ok(loadState("9999999999.000001") === undefined, "legacy file not imported into non-empty DB");
});

// --- deleteState ---

withTempStore(() => {
  const state = baseState();
  saveState(state);
  ok(loadState(state.threadTs) !== undefined, "deleteState: row exists before delete");
  deleteState(state.threadTs);
  ok(loadState(state.threadTs) === undefined, "deleteState: row removed after delete");
});

console.log(`\nstate.repository: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
