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
  /**
   * workspace-relative path — files/… for kind=upload, notes/….md for notes
   * when the workspace stores content as markdown files.
   */
  filePath: string | null;
  mimeType: string | null;
  byteSize: number | null;
  pageCount: number | null;
  ingestStatus: IngestStatus;
  ingestError: string | null;
  /** manual position within its folder (drag-reorder); null = unordered. */
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  /** manual position within its parent (drag-reorder); null = unordered. */
  sortOrder: number | null;
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

// ── Workspace ────────────────────────────────────────────────────────────────

/** Where note content is canonical: the SQLite db, or markdown files under notes/. */
export type StorageMode = "database" | "files";

export interface WorkspaceInfo {
  /** absolute path of the open workspace directory. */
  path: string;
  mode: StorageMode;
  /** true when this is the platform app-data dir (no override set). */
  isDefault: boolean;
  /** workspacePath recorded for the next launch — differs from path while a switch awaits restart. */
  overridePath: string | null;
}

/** Result of reconciling on-disk markdown with the index (files mode). */
export interface SyncReport {
  added: string[];
  changed: string[];
  removed: string[];
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

/** Markdown editor engine for the note editor. */
export type EditorChoice = "monaco" | "codemirror";

export interface AppSettings {
  chat: EndpointConfig;
  embedding: EndpointConfig & {
    /** vector dimension of the embedding model; changing it requires re-embedding. */
    dimensions: number;
  };
  editor: EditorChoice;
}

export const DEFAULT_SETTINGS: AppSettings = {
  chat: { kind: "gateway", model: "anthropic/claude-opus-4-8" },
  embedding: { kind: "gateway", model: "openai/text-embedding-3-small", dimensions: 1536 },
  editor: "monaco",
};

/** Keychain entry names (per role). */
export type SecretName = "chat-api-key" | "embedding-api-key";
