/**
 * Deterministic graph backbone — mirrors the web monorepo's
 * packages/graph/src/build.ts semantics, but runs over Tauri IPC against the
 * local SQLite core (and drops the web's userId scoping — the desktop DB is
 * single-user). Runs whenever a document is saved (notes) or parsed (uploads).
 * Cheap, reliable, instant — the trustworthy skeleton the LLM ingest layer
 * enriches. Idempotent: replaces this document's deterministic edges each run.
 */
import {
  ensureDocumentNode,
  ensureTagNode,
  findDocumentByTitle,
  replaceDeterministicEdges,
} from "@/lib/ipc";
import { parseLinks } from "@/lib/parse";

type DeterministicEdgeInput = Parameters<typeof replaceDeterministicEdges>[1][number];

export interface DeterministicResult {
  nodeId: string;
  tags: string[];
  resolvedLinks: string[];
  unresolvedLinks: string[];
}

export async function buildDeterministic(
  documentId: string,
  title: string,
  markdown: string,
): Promise<DeterministicResult> {
  const sourceNode = await ensureDocumentNode(documentId, title);
  const { tags, wikiLinks } = parseLinks(markdown);

  const edges: DeterministicEdgeInput[] = [];
  const resolvedLinks: string[] = [];
  const unresolvedLinks: string[] = [];

  for (const tag of tags) {
    const tagNode = await ensureTagNode(tag);
    edges.push({ targetNodeId: tagNode.id, relation: "tag" });
  }

  for (const target of wikiLinks) {
    const targetDoc = await findDocumentByTitle(target);
    if (targetDoc && targetDoc.id !== documentId) {
      const targetNode = await ensureDocumentNode(targetDoc.id, targetDoc.title);
      edges.push({ targetNodeId: targetNode.id, relation: "wikilink" });
      resolvedLinks.push(target);
    } else if (!targetDoc) {
      // Same as web build.ts: links to not-yet-created notes produce no edge
      // (a self-link to the current doc is silently dropped, not "unresolved").
      unresolvedLinks.push(target);
    }
  }

  await replaceDeterministicEdges(sourceNode.id, edges);

  return { nodeId: sourceNode.id, tags, resolvedLinks, unresolvedLinks };
}
