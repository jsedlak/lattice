# Phase 07 — Graph Extraction

Turn content into the graph: nodes (`document`, `tag`, `entity`) and typed edges. Two layers:

1. **Deterministic backbone** — `#tag` / `[[wiki-link]]` parsing on every save. Reliable, instant, cheap.
2. **LLM entity extraction** — `generateObject` over chunks → candidate entities + relationships, then **embedding-based resolution/dedupe** into canonical `entity` rows.

The deterministic layer is the trustworthy skeleton; the LLM layer enriches it. When they disagree, deterministic wins.

## Deliverables

1. Deterministic edge builder run synchronously on note save + on upload ingest.
2. LLM extraction step (Inngest continuation of `doc/chunked`).
3. Entity resolution/dedupe via cosine similarity against existing `entity` embeddings.
4. `node` + `edge` population with `origin` provenance (`deterministic` | `llm`).
5. Graph count surfaced in the sidebar badge.

## Deterministic layer

On `onDocumentSaved` (notes) and after upload parse (uploads):

```ts
// @lattice/graph/build.ts
export async function buildDeterministic(userId, documentId, markdown) {
  const { tags, wikiLinks } = parseLinks(markdown);     // shared parser from Phase 04
  // 1. ensure a node(type=document) exists for this doc
  // 2. upsert node(type=tag) per tag; edge(document -> tag, relation='tag', origin='deterministic')
  // 3. for each [[wikilink]], resolve to a document by title (user-scoped);
  //    if found: edge(document -> document, relation='wikilink', origin='deterministic')
  //    if not:   keep an unresolved marker; resolve lazily when the target note is created
  // Replace this doc's deterministic edges transactionally (idempotent re-run).
}
```

Runs inline (fast) so links/tags appear in the graph the instant you save — no waiting on the LLM.

## LLM extraction layer

Inngest function on `doc/chunked` (continuation from `06`):

```ts
import { generateObject } from "ai";
import { chatModel } from "@lattice/ai";        // provider factory (Anthropic default)
import { z } from "zod";

const Extraction = z.object({
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(["person", "organization", "concept", "place", "event", "other"]),
    description: z.string().optional(),
  })),
  relationships: z.array(z.object({
    from: z.string(), to: z.string(),           // entity names
    relation: z.string(),                       // free-form, normalized to 'mentions'/'related'
  })),
});

export const extractGraph = inngest.createFunction(
  { id: "extract-graph", concurrency: { key: "event.data.userId", limit: 2 }, retries: 2 },
  { event: "doc/chunked" },
  async ({ event, step }) => {
    const { userId, documentId } = event.data;
    const chunks = await step.run("load-chunks", () => getChunks(userId, documentId));

    // batch chunks to stay within context; extract per batch
    const extraction = await step.run("llm-extract", () =>
      generateObject({ model: chatModel(), schema: Extraction, prompt: buildExtractPrompt(chunks) })
    );

    await step.run("resolve-and-write", () =>
      resolveAndWrite(userId, documentId, extraction.object)
    );
  }
);
```

### Extraction prompt
Feed batched chunk text; instruct the model to extract salient entities and the relationships *stated in the text* (not world knowledge). Ask for concise canonical names. Keep it grounded — this is for a personal knowledge base, precision over recall.

## Entity resolution / dedupe (the hard part)

`resolveAndWrite`:
1. **Embed** each extracted entity (name + description) via `@lattice/ai` (same 1536-dim space).
2. For each candidate, **cosine-search existing `entity` rows** for this user (`<=>`, top-1):
   - similarity ≥ **0.86** (tune): treat as the same entity → reuse its `id`, optionally enrich description.
   - else: insert a new `entity` row (+ its embedding) and a `node(type=entity)`.
3. Also dedupe **within** the current extraction batch (canonical-name normalize + intra-batch similarity) before hitting the DB, to avoid inserting near-duplicates from one document.
4. Write edges:
   - `edge(document -> entity, relation='mentions', origin='llm')` for each entity found in the doc.
   - `edge(entity -> entity, relation='related', origin='llm')` for extracted relationships (map free-form relation onto the enum; keep the raw label in `edge` meta if useful).
5. Replace this document's `origin='llm'` edges transactionally on re-run (idempotent).

> Resolution is genuinely the risky part. Keep deterministic links as the reliable backbone, set the similarity threshold conservatively (prefer false *splits* over false *merges* — a wrong merge corrupts the graph and is hard to undo), and log merge decisions for tuning. Consider a lightweight "merge candidates" review later (out of MVP) rather than auto-merging borderline cases.

## Re-ingest & deletion

- Re-saving a note re-runs both layers idempotently (replace this doc's edges; entities persist and get re-matched).
- Deleting a document cascades its chunks + `node(type=document)` + its edges. Orphaned entities (no remaining edges) can be swept lazily or left; decide during build (a periodic cleanup is fine post-MVP).

## Sidebar badge

The Graph nav badge = count of the user's nodes (or edges). Cheap `count(*)` query, revalidated on save/ingest.

## Done when

- Saving a note with `#tags` and `[[wiki-links]]` immediately yields tag nodes + link edges in the DB.
- Uploading a PDF yields entity nodes + `mentions` edges after the job completes.
- The same entity referenced across two documents resolves to **one** `entity` row (verified with a deliberate test pair).
- Re-saving doesn't duplicate edges; deleting a doc cleans up its graph contribution.
- `origin` distinguishes deterministic vs LLM edges (the graph view can filter on it).

## Notes

- Everything re-scopes to `userId`; entity resolution searches only the user's own entities (isolation + correctness).
- Tune the threshold with real data; expose it as a constant, not a magic number.
- Keep the LLM extraction provider-swappable via the same `chatModel()` factory used by chat (`09`).
