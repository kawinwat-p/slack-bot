// One-shot import of legacy JSON state files into SQLite when the DB is empty.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeState } from "../services/interview/pain.js";
import { log } from "../shared/logger.js";
import type { ConvState } from "../shared/types.js";

/** Map sanitized filename back to thread_ts (inverse of fileFor sanitization). */
function threadTsFromFilename(filename: string): string {
  const base = filename.replace(/\.json$/, "");
  return base.replace(/_/g, ".");
}

export function importJsonStateIfEmpty(db: DatabaseSync, legacyDir: string): number {
  const count = db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number };
  if (count.n > 0) return 0;
  if (!existsSync(legacyDir)) return 0;

  const insert = db.prepare(
    "INSERT INTO conversations (thread_ts, state, phase, updated_at) VALUES (?, ?, ?, ?)",
  );
  let imported = 0;

  for (const name of readdirSync(legacyDir)) {
    if (!name.endsWith(".json") || name.startsWith("raw-")) continue;
    const threadTs = threadTsFromFilename(name);
    try {
      const raw = JSON.parse(readFileSync(join(legacyDir, name), "utf8")) as ConvState;
      const state = normalizeState({ ...raw, threadTs });
      insert.run(state.threadTs, JSON.stringify(state), state.phase, Date.now());
      imported++;
    } catch (err) {
      log("state.import.error", { file: name, err: String(err) });
    }
  }

  if (imported > 0) {
    log("state.import", { count: imported, dir: legacyDir });
  }
  return imported;
}
