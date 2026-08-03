/**
 * Deterministic graph backbone — mirrors the web monorepo's
 * packages/graph/src/build.ts semantics, but runs over Tauri IPC against the
 * local SQLite core (and drops the web's userId scoping — the desktop DB is
 * single-user). Runs whenever a document is saved (notes) or parsed (uploads).
 * Cheap, reliable, instant — the trustworthy skeleton the LLM ingest layer
 * enriches. Idempotent: replaces this document's deterministic edges each run.
 */
import { folderTags } from "@/lib/folder-context";
import {
  ensureDocumentNode,
  ensureTagNode,
  findDocumentByTitle,
  getDocument,
  listFolders,
  replaceDeterministicEdges,
} from "@/lib/ipc";
import { parseLinks } from "@/lib/parse";

type DeterministicEdgeInput = Parameters<typeof replaceDeterministicEdges>[1][number];

export interface DeterministicResult {
  nodeId: string;
  /** Inline `#tags` plus the document's folder-path tags, de-duplicated. */
  tags: string[];
  /** The subset of `tags` that came from the folder path. */
  folderTags: string[];
  resolvedLinks: string[];
  unresolvedLinks: string[];
}

export async function buildDeterministic(
  documentId: string,
  title: string,
  markdown: string,
  folderId: string | null = null,
): Promise<DeterministicResult> {
  const sourceNode = await ensureDocumentNode(documentId, title);
  const { tags: inlineTags, wikiLinks } = parseLinks(markdown);

  // Folder structure is context: a note under lattice/documentation is tagged
  // #lattice and #documentation without having to say so.
  const fromFolders = folderId ? folderTags(folderId, await listFolders()) : [];
  const tags = [...new Set([...inlineTags, ...fromFolders])];

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

  return { nodeId: sourceNode.id, tags, folderTags: fromFolders, resolvedLinks, unresolvedLinks };
}

/**
 * Rebuild the deterministic edges of documents whose folder path changed —
 * a move, a folder rename, or a folder delete. Content is unchanged, so this
 * deliberately does *not* enqueue ingest: it refreshes the cheap skeleton
 * (which is where folder tags live) and leaves embeddings and LLM enrichment
 * alone. Best-effort per document: one failure doesn't abort the rest.
 */
export async function rebuildFolderContext(documentIds: Iterable<string>): Promise<void> {
  for (const id of documentIds) {
    try {
      const doc = await getDocument(id);
      if (doc) await buildDeterministic(doc.id, doc.title, doc.content, doc.folderId);
    } catch {
      // A stale id (deleted mid-drag) or a transient IPC error shouldn't
      // strand the rest of the batch; the next save rebuilds this document.
    }
  }
}
