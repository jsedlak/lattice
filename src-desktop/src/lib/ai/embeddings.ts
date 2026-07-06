/** Embedding helpers — mirrors packages/ai/src/embeddings.ts over the
 *  settings-driven provider factory. Throws when no embedding model is
 *  configured; callers gate on getEmbeddingKit() for graceful paths. */
import { embed, embedMany } from "ai";

import { embeddingModelFor } from "./providers";
import { getEmbeddingKit } from "./settings";

async function model() {
  const kit = await getEmbeddingKit();
  if (!kit) throw new Error("No embedding model configured — set one in Settings.");
  return { model: embeddingModelFor(kit.config, kit.apiKey), dimensions: kit.dimensions };
}

/** Batch-embed chunk texts. Returns one vector per input, in order. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const m = await model();
  const { embeddings } = await embedMany({ model: m.model, values: texts });
  return embeddings;
}

/** Embed a single string (queries, entity names). */
export async function embedOne(text: string): Promise<number[]> {
  const m = await model();
  const { embedding } = await embed({ model: m.model, value: text });
  return embedding;
}
