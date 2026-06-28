import {
  ensureDocumentNode,
  ensureTagNode,
  getDocumentByTitle,
  replaceEdgesFromNode,
  type RelationType,
} from "@lattice/db";
import { parseLinks } from "./parse";

/**
 * Deterministic graph backbone. Runs synchronously whenever a document is saved
 * (notes) or parsed (uploads). Cheap, reliable, instant — the trustworthy
 * skeleton the LLM layer (Phase 07, in @lattice/ingest) enriches. Idempotent:
 * replaces this document's deterministic edges each run.
 */
export interface DeterministicResult {
  nodeId: string;
  tags: string[];
  resolvedLinks: string[];
  unresolvedLinks: string[];
}

export async function buildDeterministic(
  userId: string,
  documentId: string,
  title: string,
  markdown: string,
): Promise<DeterministicResult> {
  const sourceNodeId = await ensureDocumentNode(userId, documentId, title);
  const { tags, wikiLinks } = parseLinks(markdown);

  const edges: { targetId: string; relation: RelationType }[] = [];
  const resolvedLinks: string[] = [];
  const unresolvedLinks: string[] = [];

  for (const tag of tags) {
    const tagNodeId = await ensureTagNode(userId, tag);
    edges.push({ targetId: tagNodeId, relation: "tag" });
  }

  for (const target of wikiLinks) {
    const targetDoc = await getDocumentByTitle(userId, target);
    if (targetDoc && targetDoc.id !== documentId) {
      const targetNodeId = await ensureDocumentNode(userId, targetDoc.id, targetDoc.title);
      edges.push({ targetId: targetNodeId, relation: "wikilink" });
      resolvedLinks.push(target);
    } else if (!targetDoc) {
      unresolvedLinks.push(target);
    }
  }

  await replaceEdgesFromNode(userId, sourceNodeId, "deterministic", edges);

  return { nodeId: sourceNodeId, tags, resolvedLinks, unresolvedLinks };
}
