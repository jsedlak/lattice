import { embed, embedMany } from "ai";
import { embeddingModel } from "./providers";

/** Batch-embed chunk texts. Returns one vector per input, in order. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model: embeddingModel(), values: texts });
  return embeddings;
}

/** Embed a single string (queries, entity names). */
export async function embedOne(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}
