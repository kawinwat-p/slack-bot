// Persist-and-resume state store (§4 / Q5).
//
// The agent loop is RE-ENTRANT, not a long-running function: when it needs a user
// reply (ask_user) or an approval click, it serializes state keyed by thread_ts and
// returns. The next inbound Slack event loads state, appends the answer, and re-enters
// the loop. This survives restarts and makes Socket Mode safe.
//
// Backing store is a JSON file per thread — plenty for a prototype. Swap for SQLite/
// Redis in production without touching callers.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ConvState } from "./types.js";

const DIR = join(process.cwd(), ".state");
mkdirSync(DIR, { recursive: true });

const fileFor = (threadTs: string) => join(DIR, `${threadTs.replace(/[^\d.]/g, "_")}.json`);

export function loadState(threadTs: string): ConvState | undefined {
  const f = fileFor(threadTs);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, "utf8")) as ConvState;
}

export function saveState(state: ConvState): void {
  writeFileSync(fileFor(state.threadTs), JSON.stringify(state, null, 2));
}
