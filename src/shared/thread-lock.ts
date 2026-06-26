// Per-thread mutex for single-instance deploy — serializes load→runLoop→save per thread_ts.

import { Mutex } from "async-mutex";

const locks = new Map<string, Mutex>();

function mutexFor(threadTs: string): Mutex {
  let m = locks.get(threadTs);
  if (!m) {
    m = new Mutex();
    locks.set(threadTs, m);
  }
  return m;
}

export async function withThreadLock<T>(threadTs: string, fn: () => Promise<T>): Promise<T> {
  return mutexFor(threadTs).runExclusive(fn);
}
