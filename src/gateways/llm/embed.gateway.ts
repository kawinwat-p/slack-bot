// Embeddings gateway — OpenAI-compatible /embeddings endpoint, used for RAG retrieval.
// OpenRouter does NOT serve embeddings, so this points at a separate provider. Defaults to
// OpenAI text-embedding-3-small; override with EMBEDDING_* env vars. If no key is set the
// call throws and the caller falls back to recent messages (see context.service).

import OpenAI from "openai";
import { log } from "../../shared/logger.js";

const embedClient = new OpenAI({
  apiKey: process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1",
});

const MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const BATCH = Number(process.env.EMBEDDING_BATCH ?? 500); // inputs/request; lower for Gemini (~100 cap)

/** Embed texts in order; batched to stay under per-request input limits. */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  const t0 = Date.now();
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await embedClient.embeddings.create({ model: MODEL, input: texts.slice(i, i + BATCH) });
    for (const d of res.data) out.push(d.embedding as number[]);
  }
  log("embed", { model: MODEL, n: texts.length, ms: Date.now() - t0 });
  return out;
}
