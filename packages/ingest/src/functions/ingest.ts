import { embedChunks } from "@lattice/ai";
import { getDocument, replaceDocumentChunks, setIngestState } from "@lattice/db";
import { buildDeterministic, chunkText } from "@lattice/graph";
import { inngest } from "../client";
import { parseToText } from "../parse";

/**
 * Stage 1 of ingestion: parse → chunk → embed → persist chunks → build the
 * deterministic graph backbone → hand off to extraction (doc/chunked). Status
 * stays "processing" until extraction completes (extractGraph sets "ready").
 *
 * Triggered for both uploads and note saves. Re-scopes everything to
 * event.data.userId. Idempotent: replaces chunks + deterministic edges.
 */
export const ingestDocument = inngest.createFunction(
  {
    id: "ingest-document",
    concurrency: { key: "event.data.userId", limit: 3 },
    // Coalesce rapid note autosaves for the same document so we don't re-embed
    // and re-extract on every debounced keystroke.
    debounce: { key: "event.data.documentId", period: "20s" },
    retries: 3,
    onFailure: async ({ event }) => {
      const { userId, documentId } = event.data.event.data;
      await setIngestState(userId, documentId, "error", "ingest", "Ingestion failed");
    },
  },
  [{ event: "doc/uploaded" }, { event: "doc/saved" }],
  async ({ event, step }) => {
    const { userId, documentId } = event.data;

    await step.run("status-parse", () =>
      setIngestState(userId, documentId, "processing", "parse"),
    );

    const { text } = await step.run("parse", () => parseToText(userId, documentId));
    const chunks = await step.run("chunk", () => chunkText(text));

    await step.run("build-deterministic", async () => {
      const doc = await getDocument(userId, documentId);
      if (doc) await buildDeterministic(userId, documentId, doc.title, text);
    });

    await step.run("status-embed", () =>
      setIngestState(userId, documentId, "processing", "embed"),
    );

    const vectors =
      chunks.length > 0
        ? await step.run("embed", () => embedChunks(chunks.map((c) => c.content)))
        : [];

    await step.run("persist-chunks", () =>
      replaceDocumentChunks(
        userId,
        documentId,
        chunks.map((c, i) => ({
          ordinal: c.ordinal,
          content: c.content,
          tokenCount: c.tokenCount,
          embedding: vectors[i]!,
        })),
      ),
    );

    await step.sendEvent("send-extract", {
      name: "doc/chunked",
      data: { userId, documentId },
    });

    return { chunks: chunks.length };
  },
);
