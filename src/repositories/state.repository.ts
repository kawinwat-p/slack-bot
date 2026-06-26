// State repository — persist/resume conversation state, keyed by thread_ts.
// JSON file per thread (prototype). Swap for SQLite/Redis without touching callers.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeState } from "../services/interview/pain.js";
import { log, tid } from "../shared/logger.js";
import type { ConvState } from "../shared/types.js";

const DIR = join(process.cwd(), ".state");
mkdirSync(DIR, { recursive: true });

const fileFor = (threadTs: string) => join(DIR, `${threadTs.replace(/[^\d.]/g, "_")}.json`);

export function loadState(threadTs: string): ConvState | undefined {
  const f = fileFor(threadTs);
  if (!existsSync(f)) {
    log("state.load", { thread: tid(threadTs), found: false });
    return undefined;
  }
  log("state.load", { thread: tid(threadTs), found: true });
  return normalizeState(JSON.parse(readFileSync(f, "utf8")) as ConvState);
}

export function saveState(state: ConvState): void {
  writeFileSync(fileFor(state.threadTs), JSON.stringify(state, null, 2));
  log("state.save", { thread: tid(state.threadTs), phase: state.phase });
}
