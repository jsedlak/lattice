/** Embedding helpers — mirrors packages/ai/src/embeddings.ts over the
 *  settings-driven provider factory. Throws when no embedding model is
 *  configured; callers gate on getEmbeddingKit() for graceful paths. */
import { embed, embedMany } from "ai";

import { localEmbedTexts } from "@/lib/ipc";
import { embeddingModelFor } from "./providers";
import { getEmbeddingKit } from "./settings";

async function kit() {
  const k = await getEmbeddingKit();
  if (!k) throw new Error("No embedding model configured — set one in Settings.");
  return k;
}

/** Batch-embed chunk texts. Returns one vector per input, in order. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const k = await kit();
  if (k.config.kind === "local") return localEmbedTexts(texts);
  const { embeddings } = await embedMany({
    model: embeddingModelFor(k.config, k.apiKey),
    values: texts,
  });
  return embeddings;
}

/** Embed a single string (queries, entity names). */
export async function embedOne(text: string): Promise<number[]> {
  const k = await kit();
  if (k.config.kind === "local") {
    const [vector] = await localEmbedTexts([text]);
    if (!vector) throw new Error("local embedding returned nothing");
    return vector;
  }
  const { embedding } = await embed({
    model: embeddingModelFor(k.config, k.apiKey),
    value: text,
  });
  return embedding;
}
