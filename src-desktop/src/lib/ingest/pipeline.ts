/**
 * The ingest pipeline — the desktop replacement for Inngest. Same steps as
 * packages/ingest: parse → chunk → build-deterministic → embed → persist →
 * extract → resolve, with per-document debounce (coalesces autosaves), retry
 * with backoff, and job status persisted through the Rust core (so pending
 * work resumes on next launch).
 *
 * Orchestration runs in the webview because the steps are the already-proven
 * TS logic (parsers, chunker, AI SDK calls); persistence and vector indexing
 * are Rust. LLM/embedding steps degrade gracefully when no provider is
 * configured: content, deterministic graph, and job state still land.
 */
import { generateObject } from "ai";

import { chunkText } from "@/lib/chunk";
import { buildDeterministic } from "@/lib/graph-build";
import * as ipc from "@/lib/ipc";
import type { JobStep } from "@/lib/types";
import { embedChunks } from "@/lib/ai/embeddings";
import { ExtractionSchema, type Extraction } from "@/lib/ai/extraction-schema";
import { extractionSystemPrompt } from "@/lib/ai/prompts";
import { languageModelFor } from "@/lib/ai/providers";
import { getChatKit, getEmbeddingKit } from "@/lib/ai/settings";
import { parseFileToText } from "./parse-file";

const DEBOUNCE_MS = 5_000;
const MAX_ATTEMPTS = 3;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();

/** Debounced ingest trigger — call after any save/upload. */
export function enqueueIngest(documentId: string): void {
  clearTimeout(timers.get(documentId));
  void ipc.upsertIngestJob(documentId, "queued");
  timers.set(
    documentId,
    setTimeout(() => {
      timers.delete(documentId);
      void runWithRetry(documentId);
    }, DEBOUNCE_MS),
  );
}

/** Resume anything left queued/processing by a previous session. Call once at startup. */
export async function resumePendingIngest(): Promise<void> {
  const jobs = await ipc.listIngestJobs();
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "processing") {
      enqueueIngest(job.documentId);
    }
  }
}

async function runWithRetry(documentId: string, attempt = 1): Promise<void> {
  if (running.has(documentId)) {
    // A run is in flight; re-debounce so the newest content wins.
    enqueueIngest(documentId);
    return;
  }
  running.add(documentId);
  try {
    await runIngest(documentId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (attempt < MAX_ATTEMPTS) {
      running.delete(documentId);
      setTimeout(() => void runWithRetry(documentId, attempt + 1), 2 ** attempt * 2_000);
      return;
    }
    await ipc.upsertIngestJob(documentId, "error", null, message);
  } finally {
    running.delete(documentId);
  }
}

async function step(documentId: string, s: JobStep): Promise<void> {
  await ipc.upsertIngestJob(documentId, "processing", s);
}

async function runIngest(documentId: string): Promise<void> {
  const doc = await ipc.getDocument(documentId);
  if (!doc) return; // deleted while queued

  // ── parse ──────────────────────────────────────────────────────────────────
  await step(documentId, "parse");
  let text = doc.content;
  if (doc.kind === "upload" && doc.filePath) {
    const bytes = await ipc.readUploadBytes(documentId);
    const parsed = await parseFileToText(doc, bytes);
    text = parsed.text;
    // Uploads share the notes' preview/search/chunk path via document.content.
    await ipc.updateDocument(documentId, { content: text });
  }

  // ── deterministic graph (tags / wiki-links) ────────────────────────────────
  await buildDeterministic(documentId, doc.title, text);

  // ── chunk ──────────────────────────────────────────────────────────────────
  await step(documentId, "chunk");
  const chunks = chunkText(text);

  // ── embed + persist ────────────────────────────────────────────────────────
  const embeddingKit = await getEmbeddingKit();
  if (embeddingKit && chunks.length > 0) {
    await step(documentId, "embed");
    const embeddings = await embedChunks(chunks.map((c) => c.content));
    await ipc.replaceChunks(
      documentId,
      embeddingKit.dimensions,
      chunks.map((c, i) => ({
        ordinal: c.ordinal,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: embeddings[i]!,
      })),
    );
  }

  // ── extract + resolve (LLM enrichment) ─────────────────────────────────────
  const chatKit = await getChatKit();
  if (chatKit && embeddingKit && chunks.length > 0) {
    await step(documentId, "extract");
    const extraction = await extractGraphFromChunks(chunks);
    await step(documentId, "resolve");
    await resolveAndWrite(documentId, extraction);
  }

  await ipc.upsertIngestJob(documentId, "ready");
}

// ── extraction ────────────────────────────────────────────────────────────────

/** PARITY: prompt construction copied from packages/ai/src/extract.ts. */
function buildExtractPrompt(chunks: { content: string }[]): string {
  const body = chunks.map((c, i) => `--- chunk ${i + 1} ---\n${c.content}`).join("\n\n");
  return `Extract the salient entities and the relationships explicitly stated in the following text.\n\n${body}`;
}

async function extractGraphFromChunks(chunks: { content: string }[]): Promise<Extraction> {
  if (chunks.length === 0) return { entities: [], relationships: [] };
  const kit = await getChatKit();
  if (!kit) return { entities: [], relationships: [] };
  const { object } = await generateObject({
    model: languageModelFor(kit.config, kit.apiKey),
    schema: ExtractionSchema,
    system: extractionSystemPrompt(),
    prompt: buildExtractPrompt(chunks),
  });
  return object;
}

// ── entity resolution ─────────────────────────────────────────────────────────

/**
 * Mirrors packages/ingest/src/resolve.ts over IPC: exact-name match first,
 * then embedding similarity (threshold enforced Rust-side), else create.
 * document→entity "mentions" edges are replaced per doc; entity→entity
 * "related" edges are upserted (relations span documents).
 */
async function resolveAndWrite(documentId: string, extraction: Extraction): Promise<void> {
  const doc = await ipc.getDocument(documentId);
  if (!doc) return;

  const sourceNode = await ipc.ensureDocumentNode(documentId, doc.title);

  if (extraction.entities.length === 0) {
    await ipc.replaceEdgesFromNode(sourceNode.id, "llm", []);
    return;
  }

  const embeddingKit = await getEmbeddingKit();
  if (!embeddingKit) return;

  const texts = extraction.entities.map((e) =>
    e.description ? `${e.name}: ${e.description}` : e.name,
  );
  const embeddings = await embedChunks(texts);

  const nameToNode = new Map<string, string>();
  const mentionEdges: ipc.EdgeInput[] = [];

  for (let i = 0; i < extraction.entities.length; i++) {
    const e = extraction.entities[i]!;
    const emb = embeddings[i]!;
    const norm = e.name.trim().toLowerCase();
    if (nameToNode.has(norm)) continue; // intra-batch dedupe

    const byName = await ipc.findEntityByName(e.name);
    let entityId: string;
    if (byName) {
      entityId = byName.id;
    } else {
      const similar = await ipc.findSimilarEntity(emb, embeddingKit.dimensions);
      entityId =
        similar?.id ??
        (await ipc.createEntity(
          e.name,
          e.type,
          e.description ?? null,
          emb,
          embeddingKit.dimensions,
        ));
    }

    const node = await ipc.ensureEntityNode(entityId, e.name);
    nameToNode.set(norm, node.id);
    mentionEdges.push({ targetNodeId: node.id, relation: "mentions" });
  }

  await ipc.replaceEdgesFromNode(sourceNode.id, "llm", mentionEdges);

  const relatedEdges = extraction.relationships.flatMap((rel) => {
    const from = nameToNode.get(rel.from.trim().toLowerCase());
    const to = nameToNode.get(rel.to.trim().toLowerCase());
    return from && to && from !== to
      ? [{ sourceNodeId: from, targetNodeId: to, relation: "related" as const, label: rel.relation }]
      : [];
  });
  if (relatedEdges.length > 0) {
    await ipc.upsertLlmEdges(relatedEdges);
  }
}

/** Re-embed everything (embedding model/dimension change). */
export async function reingestAll(): Promise<void> {
  await ipc.resetEmbeddings();
  const docs = await ipc.listDocuments();
  for (const d of docs) {
    enqueueIngest(d.id);
  }
}
