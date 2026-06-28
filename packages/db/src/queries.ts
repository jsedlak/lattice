import { and, cosineDistance, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import {
  chunk,
  conversation,
  document,
  edge,
  entity,
  folder,
  ingestJob,
  message,
  node,
  type Citation,
  type NewDocument,
  type NewEdge,
  type NodeType,
  type RelationType,
} from "./schema";

/**
 * User-scoped data access. EVERY function takes `userId` and filters by it — the
 * single chokepoint that enforces per-user isolation. Route handlers and AI
 * tools call these; they never hand-roll cross-user queries.
 */

// ── Documents ───────────────────────────────────────────────────────────────

export function listDocuments(userId: string) {
  return db
    .select()
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.updatedAt));
}

export async function getDocument(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getDocumentByTitle(userId: string, title: string) {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), ilike(document.title, title)))
    .limit(1);
  return row ?? null;
}

export async function createNote(userId: string, title: string, content = "") {
  const [row] = await db
    .insert(document)
    .values({ userId, kind: "note", title, content })
    .returning();
  return row!;
}

export async function createUploadDocument(values: NewDocument) {
  const [row] = await db.insert(document).values(values).returning();
  return row!;
}

export async function updateDocument(
  userId: string,
  id: string,
  patch: Partial<
    Pick<
      NewDocument,
      "title" | "content" | "folderId" | "ingestStatus" | "ingestError" | "pageCount"
    >
  >,
) {
  const [row] = await db
    .update(document)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(document.userId, userId), eq(document.id, id)))
    .returning();
  return row ?? null;
}

// ── Folders ─────────────────────────────────────────────────────────────────

export function listFolders(userId: string) {
  return db.select().from(folder).where(eq(folder.userId, userId)).orderBy(folder.name);
}

export async function createFolder(userId: string, name: string, parentId?: string | null) {
  const [row] = await db
    .insert(folder)
    .values({ userId, name: name.trim() || "New folder", parentId: parentId ?? null })
    .returning();
  return row!;
}

export async function renameFolder(userId: string, id: string, name: string) {
  const [row] = await db
    .update(folder)
    .set({ name: name.trim() || "Untitled", updatedAt: new Date() })
    .where(and(eq(folder.userId, userId), eq(folder.id, id)))
    .returning();
  return row ?? null;
}

/** Delete a folder; reparent its child folders and documents to the deleted
 *  folder's parent (root if none) so nothing is orphaned. */
export async function deleteFolder(userId: string, id: string) {
  const [target] = await db
    .select()
    .from(folder)
    .where(and(eq(folder.userId, userId), eq(folder.id, id)))
    .limit(1);
  if (!target) return false;
  const newParent = target.parentId ?? null;
  await db
    .update(folder)
    .set({ parentId: newParent })
    .where(and(eq(folder.userId, userId), eq(folder.parentId, id)));
  await db
    .update(document)
    .set({ folderId: newParent })
    .where(and(eq(document.userId, userId), eq(document.folderId, id)));
  await db.delete(folder).where(and(eq(folder.userId, userId), eq(folder.id, id)));
  return true;
}

export async function moveDocument(userId: string, docId: string, folderId: string | null) {
  const [row] = await db
    .update(document)
    .set({ folderId, updatedAt: new Date() })
    .where(and(eq(document.userId, userId), eq(document.id, docId)))
    .returning();
  return row ?? null;
}

export async function deleteDocument(userId: string, id: string) {
  // chunk/node/edge/ingestJob cascade via FK onDelete.
  const [row] = await db
    .delete(document)
    .where(and(eq(document.userId, userId), eq(document.id, id)))
    .returning();
  return row ?? null;
}

// ── Chunks + semantic search ────────────────────────────────────────────────

export async function replaceDocumentChunks(
  userId: string,
  documentId: string,
  rows: { ordinal: number; content: string; tokenCount?: number; embedding: number[] }[],
) {
  await db.delete(chunk).where(and(eq(chunk.userId, userId), eq(chunk.documentId, documentId)));
  if (rows.length === 0) return;
  await db.insert(chunk).values(
    rows.map((r) => ({
      userId,
      documentId,
      ordinal: r.ordinal,
      content: r.content,
      tokenCount: r.tokenCount,
      embedding: r.embedding,
    })),
  );
}

/** Chunk contents for a document, ordered, optionally capped (extraction). */
export async function getChunkContents(userId: string, documentId: string, limit = 24) {
  return db
    .select({ id: chunk.id, ordinal: chunk.ordinal, content: chunk.content })
    .from(chunk)
    .where(and(eq(chunk.userId, userId), eq(chunk.documentId, documentId)))
    .orderBy(chunk.ordinal)
    .limit(limit);
}

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  title: string;
  snippet: string;
  similarity: number;
}

export async function cosineSearchChunks(
  userId: string,
  embedding: number[],
  k = 6,
): Promise<ChunkHit[]> {
  const similarity = sql<number>`1 - (${cosineDistance(chunk.embedding, embedding)})`;
  const rows = await db
    .select({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      title: document.title,
      content: chunk.content,
      similarity,
    })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(eq(chunk.userId, userId))
    .orderBy(desc(similarity))
    .limit(k);
  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    title: r.title,
    snippet: r.content.slice(0, 280),
    similarity: Number(r.similarity),
  }));
}

// ── Entities (resolution / dedupe) ──────────────────────────────────────────

/** Exact (case-insensitive) entity name match for a user — the reliable
 *  primary dedup key, run before embedding similarity. */
export async function findEntityByName(userId: string, name: string) {
  const [row] = await db
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.userId, userId), ilike(entity.name, name.trim())))
    .limit(1);
  return row ?? null;
}

export async function findSimilarEntity(userId: string, embedding: number[]) {
  const similarity = sql<number>`1 - (${cosineDistance(entity.embedding, embedding)})`;
  const [row] = await db
    .select({ id: entity.id, name: entity.name, similarity })
    .from(entity)
    .where(eq(entity.userId, userId))
    .orderBy(desc(similarity))
    .limit(1);
  return row ? { id: row.id, name: row.name, similarity: Number(row.similarity) } : null;
}

export async function createEntity(
  userId: string,
  values: { name: string; type?: string; description?: string; embedding: number[] },
) {
  const [row] = await db
    .insert(entity)
    .values({ userId, ...values })
    .returning();
  return row!;
}

// ── Graph nodes / edges ─────────────────────────────────────────────────────

export async function ensureDocumentNode(userId: string, documentId: string, label: string) {
  const [existing] = await db
    .select()
    .from(node)
    .where(and(eq(node.userId, userId), eq(node.type, "document"), eq(node.documentId, documentId)))
    .limit(1);
  if (existing) {
    if (existing.label !== label) {
      await db.update(node).set({ label }).where(eq(node.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db
    .insert(node)
    .values({ userId, type: "document", label, documentId })
    .returning();
  return row!.id;
}

export async function ensureTagNode(userId: string, tag: string) {
  const label = tag.replace(/^#/, "");
  const [existing] = await db
    .select()
    .from(node)
    .where(and(eq(node.userId, userId), eq(node.type, "tag"), eq(node.label, label)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(node).values({ userId, type: "tag", label }).returning();
  return row!.id;
}

export async function ensureEntityNode(userId: string, entityId: string, label: string) {
  const [existing] = await db
    .select()
    .from(node)
    .where(and(eq(node.userId, userId), eq(node.type, "entity"), eq(node.entityId, entityId)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(node)
    .values({ userId, type: "entity", label, entityId })
    .returning();
  return row!.id;
}

/** Replace all edges originating from a document's node for a given origin
 *  (deterministic | llm). Makes re-ingest idempotent. */
export async function replaceEdgesFromNode(
  userId: string,
  sourceNodeId: string,
  origin: "deterministic" | "llm",
  edges: { targetId: string; relation: RelationType; label?: string; weight?: number }[],
) {
  await db
    .delete(edge)
    .where(
      and(eq(edge.userId, userId), eq(edge.sourceId, sourceNodeId), eq(edge.origin, origin)),
    );
  if (edges.length === 0) return;
  const values: NewEdge[] = edges.map((e) => ({
    userId,
    sourceId: sourceNodeId,
    targetId: e.targetId,
    relation: e.relation,
    origin,
    label: e.label,
    weight: e.weight ?? 1,
  }));
  await db.insert(edge).values(values);
}

/** Insert an edge only if an identical (source,target,relation) edge doesn't
 *  already exist. Used for entity↔entity 'related' edges which, unlike a
 *  document's outgoing edges, are not replaced per-document. */
export async function ensureEdge(
  userId: string,
  sourceId: string,
  targetId: string,
  relation: RelationType,
  origin: "deterministic" | "llm",
  label?: string,
) {
  if (sourceId === targetId) return null;
  const [existing] = await db
    .select({ id: edge.id })
    .from(edge)
    .where(
      and(
        eq(edge.userId, userId),
        eq(edge.sourceId, sourceId),
        eq(edge.targetId, targetId),
        eq(edge.relation, relation),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(edge)
    .values({ userId, sourceId, targetId, relation, origin, label })
    .returning();
  return row!.id;
}

export async function searchNodes(userId: string, q: string, type?: NodeType) {
  const conditions = [eq(node.userId, userId), ilike(node.label, `%${q}%`)];
  if (type) conditions.push(eq(node.type, type));
  return db.select().from(node).where(and(...conditions)).limit(20);
}

export interface Neighbor {
  edgeId: string;
  relation: RelationType;
  origin: string;
  direction: "out" | "in";
  node: { id: string; type: NodeType; label: string; documentId: string | null };
}

export async function getNeighbors(userId: string, nodeId: string): Promise<Neighbor[]> {
  const rows = await db
    .select({
      edgeId: edge.id,
      relation: edge.relation,
      origin: edge.origin,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      nId: node.id,
      nType: node.type,
      nLabel: node.label,
      nDoc: node.documentId,
    })
    .from(edge)
    .innerJoin(
      node,
      or(
        and(eq(edge.sourceId, nodeId), eq(node.id, edge.targetId)),
        and(eq(edge.targetId, nodeId), eq(node.id, edge.sourceId)),
      ),
    )
    .where(
      and(eq(edge.userId, userId), or(eq(edge.sourceId, nodeId), eq(edge.targetId, nodeId))),
    );

  return rows.map((r) => ({
    edgeId: r.edgeId,
    relation: r.relation,
    origin: r.origin,
    direction: r.sourceId === nodeId ? ("out" as const) : ("in" as const),
    node: { id: r.nId, type: r.nType, label: r.nLabel, documentId: r.nDoc },
  }));
}

/** Breadth-first path search between two nodes, app-side, capped at maxHops. */
export async function traverse(
  userId: string,
  fromNodeId: string,
  toNodeId: string,
  maxHops = 3,
): Promise<{ path: string[]; labels: string[] } | null> {
  if (fromNodeId === toNodeId) return { path: [fromNodeId], labels: [] };
  const visited = new Set<string>([fromNodeId]);
  let frontier: { id: string; path: string[] }[] = [{ id: fromNodeId, path: [fromNodeId] }];

  for (let hop = 0; hop < maxHops; hop++) {
    const next: { id: string; path: string[] }[] = [];
    for (const cur of frontier) {
      const neighbors = await getNeighbors(userId, cur.id);
      for (const n of neighbors) {
        if (n.node.id === toNodeId) return { path: [...cur.path, toNodeId], labels: [] };
        if (!visited.has(n.node.id)) {
          visited.add(n.node.id);
          next.push({ id: n.node.id, path: [...cur.path, n.node.id] });
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}

export interface GraphData {
  nodes: { id: string; type: NodeType; label: string; documentId: string | null; degree: number }[];
  edges: { id: string; source: string; target: string; relation: RelationType; origin: string }[];
  counts: { documents: number; tags: number; entities: number; edges: number };
}

export async function getGraph(
  userId: string,
  filters?: { types?: NodeType[]; origin?: "deterministic" | "llm" },
): Promise<GraphData> {
  const nodeConditions = [eq(node.userId, userId)];
  if (filters?.types && filters.types.length > 0) {
    nodeConditions.push(inArray(node.type, filters.types));
  }
  const nodeRows = await db.select().from(node).where(and(...nodeConditions));
  const nodeIds = new Set(nodeRows.map((n) => n.id));

  const edgeConditions = [eq(edge.userId, userId)];
  if (filters?.origin) edgeConditions.push(eq(edge.origin, filters.origin));
  const edgeRows = await db.select().from(edge).where(and(...edgeConditions));

  const degree = new Map<string, number>();
  const visibleEdges = edgeRows.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
  for (const e of visibleEdges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }

  return {
    nodes: nodeRows.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      documentId: n.documentId,
      degree: degree.get(n.id) ?? 0,
    })),
    edges: visibleEdges.map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      relation: e.relation,
      origin: e.origin,
    })),
    counts: {
      documents: nodeRows.filter((n) => n.type === "document").length,
      tags: nodeRows.filter((n) => n.type === "tag").length,
      entities: nodeRows.filter((n) => n.type === "entity").length,
      edges: visibleEdges.length,
    },
  };
}

export async function countNodes(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(node)
    .where(eq(node.userId, userId));
  return row?.count ?? 0;
}

// ── Conversations / messages ────────────────────────────────────────────────

export function listConversations(userId: string) {
  return db
    .select()
    .from(conversation)
    .where(eq(conversation.userId, userId))
    .orderBy(desc(conversation.updatedAt));
}

export async function createConversation(
  userId: string,
  title = "New conversation",
  model?: string | null,
) {
  const [row] = await db
    .insert(conversation)
    .values({ userId, title, model: model ?? null })
    .returning();
  return row!;
}

export async function setConversationModel(userId: string, id: string, model: string) {
  const [row] = await db
    .update(conversation)
    .set({ model, updatedAt: new Date() })
    .where(and(eq(conversation.userId, userId), eq(conversation.id, id)))
    .returning();
  return row ?? null;
}

export async function getConversation(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.id, id)))
    .limit(1);
  return row ?? null;
}

export function getMessages(userId: string, conversationId: string) {
  return db
    .select()
    .from(message)
    .where(and(eq(message.userId, userId), eq(message.conversationId, conversationId)))
    .orderBy(message.createdAt);
}

export async function addMessage(
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  citations?: Citation[],
) {
  const [row] = await db
    .insert(message)
    .values({ userId, conversationId, role, content, citations: citations ?? null })
    .returning();
  await db
    .update(conversation)
    .set({ updatedAt: new Date() })
    .where(and(eq(conversation.userId, userId), eq(conversation.id, conversationId)));
  return row!;
}

export async function renameConversation(userId: string, id: string, title: string) {
  const [row] = await db
    .update(conversation)
    .set({ title: title.trim() || "Untitled", updatedAt: new Date() })
    .where(and(eq(conversation.userId, userId), eq(conversation.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteConversation(userId: string, id: string) {
  // messages cascade via FK onDelete.
  const [row] = await db
    .delete(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.id, id)))
    .returning();
  return row ?? null;
}

// ── Ingest jobs ─────────────────────────────────────────────────────────────

export async function createIngestJob(userId: string, documentId: string) {
  const [row] = await db
    .insert(ingestJob)
    .values({ userId, documentId, status: "queued" })
    .returning();
  return row!;
}

export async function setIngestState(
  userId: string,
  documentId: string,
  status: "queued" | "processing" | "ready" | "error",
  step?: string,
  error?: string,
) {
  await db
    .update(document)
    .set({
      ingestStatus: status,
      ingestError: error ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(document.userId, userId), eq(document.id, documentId)));
  await db
    .update(ingestJob)
    .set({ status, step: step ?? null, error: error ?? null, updatedAt: new Date() })
    .where(and(eq(ingestJob.userId, userId), eq(ingestJob.documentId, documentId)));
}

// Re-export a couple of operators consumers occasionally need for ad-hoc work.
export { and, eq, desc, gt, sql };
