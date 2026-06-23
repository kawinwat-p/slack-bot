// Tiny ESM resolver so `npm test` can run TypeScript with ZERO installed deps:
// node strips types natively but doesn't rewrite ".js" import specifiers to ".ts".
// This maps ./foo.js -> ./foo.ts when the .ts file exists. Dev/test only.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && spec.endsWith(".js")) {
    const ts = spec.replace(/\.js$/, ".ts");
    try {
      const r = await next(ts, ctx);
      if (existsSync(fileURLToPath(r.url))) return r;
    } catch {}
  }
  return next(spec, ctx);
}
