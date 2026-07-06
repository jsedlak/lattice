/**
 * Shared row/DTO types for the desktop app. Shapes mirror the web app's
 * Drizzle schema (packages/db/src/schema.ts) so behavior and the Postgres
 * importer line up; storage here is SQLite via the Rust core.
 * Timestamps are ISO-8601 strings (UTC).
 */

export type DocumentKind = "note" | "upload";
export type IngestStatus = "idle" | "queued" | "processing" | "ready" | "error";

export interface Doc {
  id: string;
  kind: DocumentKind;
  title: string;
  /** markdown body (notes) or extracted text (uploads). */
  content: string;
  folderId: string | null;
  /** relative path under the app data dir's files/ — set for kind=upload. */
  filePath: string | null;
  mimeType: string | null;
  byteSize: number | null;
  pageCount: number | null;
  ingestStatus: IngestStatus;
  ingestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export type NodeType = "document" | "tag" | "entity";
export type RelationType = "wikilink" | "tag" | "mentions" | "related";
export type EdgeOrigin = "deterministic" | "llm";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  documentId: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: RelationType;
  origin: EdgeOrigin;
  label: string | null;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NeighborEdge {
  node: GraphNode;
  relation: RelationType;
  origin: EdgeOrigin;
  label: string | null;
  direction: "out" | "in";
}

export interface Neighborhood {
  center: GraphNode;
  neighbors: NeighborEdge[];
}

export interface TraversalResult {
  found: boolean;
  /** Node path from → to, inclusive, when found. */
  path: GraphNode[];
}

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  /** cosine similarity in [0,1] — higher is closer. */
  score: number;
}

export interface SimilarEntity {
  id: string;
  name: string;
  score: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  label: string;
  documentId?: string;
  chunkId?: string;
  nodeId?: string;
  snippet?: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  createdAt: string;
}

export type JobStatus = "queued" | "processing" | "ready" | "error";
export type JobStep = "parse" | "chunk" | "embed" | "extract" | "resolve";

export interface IngestJobRow {
  id: string;
  documentId: string;
  status: JobStatus;
  step: JobStep | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export type ProviderKind = "gateway" | "openai" | "anthropic" | "openai-compatible";

export interface EndpointConfig {
  kind: ProviderKind;
  /** provider model id — e.g. "anthropic/claude-opus-4-8" (gateway) or "llama3.1" (local). */
  model: string;
  /** required for kind="openai-compatible" (e.g. http://localhost:11434/v1). */
  baseUrl?: string;
}

export interface AppSettings {
  chat: EndpointConfig;
  embedding: EndpointConfig & {
    /** vector dimension of the embedding model; changing it requires re-embedding. */
    dimensions: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  chat: { kind: "gateway", model: "anthropic/claude-opus-4-8" },
  embedding: { kind: "gateway", model: "openai/text-embedding-3-small", dimensions: 1536 },
};

/** Keychain entry names (per role). */
export type SecretName = "chat-api-key" | "embedding-api-key";
