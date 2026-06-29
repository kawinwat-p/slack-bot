// Cosine-similarity top-K — pure, in-memory retrieval (no vector store).
// ponytail: re-embeds the whole channel per call; add a persistent index if it gets slow.

/** Return the indices of the k docs most similar to query, best first. */
export function cosineTopK(query: number[], docs: number[][], k: number): number[] {
  const qn = Math.hypot(...query) || 1;
  const scored = docs.map((d, i) => {
    let dot = 0;
    for (let j = 0; j < query.length; j++) dot += query[j] * (d[j] ?? 0);
    return { i, score: dot / (qn * (Math.hypot(...d) || 1)) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.i);
}
