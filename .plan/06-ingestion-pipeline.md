# Phase 06 — Ingestion Pipeline (Background Jobs)

Turn an uploaded file (or a saved note) into retrievable, embedded chunks via a durable Inngest workflow: **parse → chunk → embed → persist**. Entity/graph extraction is the next step (`07`) and runs as a continuation of the same flow. UI surfaces job state from `ingestJob` / `document.ingestStatus`.

## Deliverables

1. Inngest client + the ingestion function in `packages/ingest`, registered at `/api/inngest`.
2. File parsing for the supported mime types → plain text.
3. Chunking strategy in `@lattice/graph` (shared, deterministic).
4. Embedding generation via the provider factory in `@lattice/ai`.
5. `chunk` rows written with `vector(1536)` embeddings; status transitions tracked.

## Provider factory (`@lattice/ai`)

Provider-configurable per `00-overview.md`:
```ts
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";

export const EMBEDDING_DIM = 1536; // single source of truth (matches table + ANN index)

export function embeddingModel() {
  switch (process.env.EMBEDDING_PROVIDER) {
    case "openai": return openai.embedding(process.env.EMBEDDING_MODEL ?? "text-embedding-3-small");
    default: throw new Error(`Unknown EMBEDDING_PROVIDER`);
  }
}

export async function embedChunks(texts: string[]) {
  const { embeddings } = await embedMany({ model: embeddingModel(), values: texts });
  return embeddings; // number[][]
}
```

## The Inngest function

`packages/ingest/src/functions/ingest.ts`
```ts
import { inngest } from "../client";
import { db, document, chunk, ingestJob } from "@lattice/db";
import { parseToText } from "../parse";
import { chunkText } from "@lattice/graph";
import { embedChunks } from "@lattice/ai";

export const ingestDocument = inngest.createFunction(
  { id: "ingest-document", concurrency: { key: "event.data.userId", limit: 3 }, retries: 3 },
  { event: "doc/uploaded" },               // notes use "doc/saved"
  async ({ event, step }) => {
    const { userId, documentId } = event.data;
    const setStatus = (status, stepName, error) =>
      step.run(`status-${stepName}`, () => updateStatus(userId, documentId, status, stepName, error));

    await setStatus("processing", "parse");
    const text = await step.run("parse", () => parseToText(userId, documentId));

    const chunks = await step.run("chunk", () => chunkText(text));   // [{ ordinal, content, tokenCount }]

    await setStatus("processing", "embed");
    const vectors = await step.run("embed", () => embedChunks(chunks.map(c => c.content)));

    await step.run("persist-chunks", () =>
      db.insert(chunk).values(chunks.map((c, i) => ({
        userId, documentId, ordinal: c.ordinal, content: c.content,
        tokenCount: c.tokenCount, embedding: vectors[i],
      })))
    );

    // continuation → graph/entity extraction (Phase 07)
    await step.sendEvent("extract", { name: "doc/chunked", data: { userId, documentId } });

    await setStatus("ready", "embed");
  }
);
```

Register it in `apps/web/app/api/inngest/route.ts`'s `functions` array.

## Parsing

`packages/ingest/src/parse.ts` — fetch the private blob (server-side, with the RW token), branch on mime:
- **PDF:** `pdf-parse` / `unpdf` → text (+ page count for the detail pane).
- **docx:** `mammoth` → text.
- **xlsx:** `xlsx` (SheetJS) → flattened sheet text.
- **txt/md:** decode directly.
- **images:** skip text; optionally OCR later (out of MVP) — store a placeholder so the graph still references the file node.

Write the extracted text back to `document.content` (so uploads get the same preview/search path as notes) and return it for chunking.

## Chunking

`@lattice/graph/chunk.ts` — token-aware splitter (~500–800 tokens, ~15% overlap), prefer paragraph/heading boundaries. Deterministic so re-ingest is stable. Returns `{ ordinal, content, tokenCount }[]`. Keep it shared so notes and uploads chunk identically.

## Notes path

When a **note** is saved (`onDocumentSaved` hook from `04`), debounce and send `doc/saved`; the same function (or a sibling keyed on `doc/saved`) re-chunks + re-embeds the note. Delete prior chunks for that document before re-inserting (idempotent re-ingest). Keep deterministic graph links updating immediately on save (`07`) — embeddings can lag a beat without hurting authoring.

## Status & UI

- `ingestJob.step` + `document.ingestStatus` drive the Blobs tab and file detail "processing/ready/error" states.
- On any thrown step after retries, Inngest marks failure → set `ingestStatus='error'`, store the message; UI shows a retry affordance that re-sends the event.

## Done when

- Uploading a PDF produces parsed text, chunks, and 1536-dim embeddings in `chunk`, with status → `ready`.
- A cosine search over `chunk.embedding` returns sensible neighbors for a query embedding.
- docx/xlsx/txt/md all parse; unsupported types fail gracefully with a clear status.
- Re-saving a note re-embeds without duplicating chunks.
- Job state is visible and accurate in the UI.

## Notes

- Keep embedding batches within provider limits; `embedMany` batches, but chunk the chunks if a doc is huge.
- All Inngest steps re-scope to `event.data.userId` — never widen a query.
- Cost control: only embed changed chunks on note re-save if you add content hashing (optional optimization; fine to re-embed whole note in MVP).
