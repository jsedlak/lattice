import { extractGraphFromChunks } from "@lattice/ai";
import { getChunkContents, setIngestState } from "@lattice/db";
import { inngest } from "../client";
import { resolveAndWrite } from "../resolve";

/**
 * Stage 2 of ingestion (continuation of doc/chunked): LLM entity/relationship
 * extraction → resolution/dedupe → write entity nodes + edges. Marks the
 * document "ready" at the end of the whole pipeline.
 */
export const extractGraph = inngest.createFunction(
  {
    id: "extract-graph",
    concurrency: { key: "event.data.userId", limit: 2 },
    retries: 2,
    onFailure: async ({ event }) => {
      const { userId, documentId } = event.data.event.data;
      // Embeddings/chunks already exist, so the doc is usable — mark ready but
      // record the extraction error for visibility.
      await setIngestState(userId, documentId, "ready", "extract", "Entity extraction failed");
    },
  },
  { event: "doc/chunked" },
  async ({ event, step }) => {
    const { userId, documentId } = event.data;

    await step.run("status-extract", () =>
      setIngestState(userId, documentId, "processing", "extract"),
    );

    const chunks = await step.run("load-chunks", () => getChunkContents(userId, documentId));

    const extraction = await step.run("llm-extract", () => extractGraphFromChunks(chunks));

    const result = await step.run("resolve", () =>
      resolveAndWrite(userId, documentId, extraction),
    );

    await step.run("status-ready", () =>
      setIngestState(userId, documentId, "ready", "resolve"),
    );

    return result;
  },
);
