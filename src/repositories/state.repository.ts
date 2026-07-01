// State repository — persist/resume conversation state, keyed by thread_ts.
// SQLite backing (sync DatabaseSync). Swap internals without touching callers.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeState } from "../services/interview/pain.js";
import { log, tid } from "../shared/logger.js";
import type { ConvState } from "../shared/types.js";
import { importJsonStateIfEmpty } from "./state.importer.js";

let db: DatabaseSync | undefined;

export function initStateStore(dbPath: string, legacyDir?: string): void {
  closeStateStore();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      thread_ts TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      phase TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  importJsonStateIfEmpty(db, legacyDir ?? join(process.cwd(), ".state"));
  log("state.init", { path: dbPath });
}

function getDb(): DatabaseSync {
  if (!db) throw new Error("State store not initialized — call initStateStore() first");
  return db;
}

export function loadState(threadTs: string): ConvState | undefined {
  const row = getDb().prepare("SELECT state FROM conversations WHERE thread_ts = ?").get(threadTs) as
    | { state: string }
    | undefined;
  if (!row) {
    log("state.load", { thread: tid(threadTs), found: false });
    return undefined;
  }
  log("state.load", { thread: tid(threadTs), found: true });
  return normalizeState(JSON.parse(row.state) as ConvState);
}

export function saveState(state: ConvState): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO conversations (thread_ts, state, phase, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_ts) DO UPDATE SET
         state = excluded.state,
         phase = excluded.phase,
         updated_at = excluded.updated_at`,
    )
    .run(state.threadTs, JSON.stringify(state), state.phase, now);
  log("state.save", { thread: tid(state.threadTs), phase: state.phase });
}

export function deleteState(threadTs: string): void {
  getDb().prepare("DELETE FROM conversations WHERE thread_ts = ?").run(threadTs);
  log("state.delete", { thread: tid(threadTs) });
}

/** Test-only: expose DB for importer assertions. */
export function getStateDbForTests(): DatabaseSync {
  return getDb();
}

export function closeStateStore(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
