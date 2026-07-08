/**
 * Typed client for the Rust core. Every data access in the app goes through
 * these wrappers — the desktop analogue of the web app's API route handlers.
 * Command names are snake_case (Rust); argument keys are camelCase (Tauri
 * maps them onto snake_case Rust parameters).
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  AppSettings,
  ChunkHit,
  Citation,
  Conversation,
  Doc,
  DocumentKind,
  EdgeOrigin,
  Folder,
  GraphData,
  GraphNode,
  IngestJobRow,
  IngestStatus,
  JobStatus,
  JobStep,
  MessageRow,
  Neighborhood,
  NodeType,
  RelationType,
  SecretName,
  SimilarEntity,
  StorageMode,
  SyncReport,
  TraversalResult,
  WorkspaceInfo,
} from "./types";

// ── Documents ────────────────────────────────────────────────────────────────

export const listDocuments = (kind?: DocumentKind) =>
  invoke<Doc[]>("list_documents", { kind: kind ?? null });

export const getDocument = (id: string) => invoke<Doc | null>("get_document", { id });

export const createNote = (title: string, content = "", folderId: string | null = null) =>
  invoke<Doc>("create_note", { title, content, folderId });

export interface DocumentPatch {
  title?: string;
  content?: string;
  folderId?: string | null;
}

export const updateDocument = (id: string, patch: DocumentPatch) =>
  invoke<Doc>("update_document", {
    id,
    title: patch.title ?? null,
    content: patch.content ?? null,
    folderId: patch.folderId === undefined ? null : patch.folderId,
    clearFolder: patch.folderId === null,
  });

export const deleteDocument = (id: string) => invoke<void>("delete_document", { id });

export const setDocumentIngest = (id: string, status: IngestStatus, error: string | null = null) =>
  invoke<void>("set_document_ingest", { id, status, error });

// ── Folders ──────────────────────────────────────────────────────────────────

export const listFolders = () => invoke<Folder[]>("list_folders");
export const createFolder = (name: string, parentId: string | null = null) =>
  invoke<Folder>("create_folder", { name, parentId });
export const renameFolder = (id: string, name: string) =>
  invoke<void>("rename_folder", { id, name });
export const deleteFolder = (id: string) => invoke<void>("delete_folder", { id });

/** Rewrites the manual order of the notes in one folder (drag-reorder). */
export const reorderDocuments = (folderId: string | null, ids: string[]) =>
  invoke<void>("reorder_documents", { folderId, ids });

/** Rewrites the manual order of the folders under one parent (drag-reorder). */
export const reorderFolders = (parentId: string | null, ids: string[]) =>
  invoke<void>("reorder_folders", { parentId, ids });

// ── Graph ────────────────────────────────────────────────────────────────────

export const getGraph = (types?: NodeType[], origin?: EdgeOrigin) =>
  invoke<GraphData>("get_graph", { types: types ?? null, origin: origin ?? null });

export const ensureDocumentNode = (documentId: string, title: string) =>
  invoke<GraphNode>("ensure_document_node", { documentId, title });

export const ensureTagNode = (label: string) => invoke<GraphNode>("ensure_tag_node", { label });

export const findDocumentByTitle = (title: string) =>
  invoke<Doc | null>("find_document_by_title", { title });

export interface EdgeInput {
  targetNodeId: string;
  relation: RelationType;
}

/** Replaces all edges of one origin out of a node (idempotent rebuild). */
export const replaceEdgesFromNode = (
  sourceNodeId: string,
  origin: EdgeOrigin,
  edges: EdgeInput[],
) => invoke<void>("replace_edges_from_node", { sourceNodeId, origin, edges });

/** Replaces all *deterministic* edges out of a node (rebuild-on-save). */
export const replaceDeterministicEdges = (
  sourceNodeId: string,
  edges: { targetNodeId: string; relation: Extract<RelationType, "wikilink" | "tag"> }[],
) => replaceEdgesFromNode(sourceNodeId, "deterministic", edges);

export const searchNodes = (q: string, nodeType?: NodeType) =>
  invoke<GraphNode[]>("search_nodes", { q, nodeType: nodeType ?? null });

export const getNeighbors = (nodeId: string) =>
  invoke<Neighborhood | null>("get_neighbors", { nodeId });

export const traverse = (fromNodeId: string, toNodeId: string, maxHops = 3) =>
  invoke<TraversalResult>("traverse", { fromNodeId, toNodeId, maxHops });

// ── Chunks & vector search ───────────────────────────────────────────────────

export interface ChunkInput {
  ordinal: number;
  content: string;
  tokenCount: number;
  embedding: number[];
}

/** Replaces a document's chunks + vectors atomically. */
export const replaceChunks = (documentId: string, dimensions: number, chunks: ChunkInput[]) =>
  invoke<void>("replace_chunks", { documentId, dimensions, chunks });

export const cosineSearchChunks = (embedding: number[], dimensions: number, k = 6) =>
  invoke<ChunkHit[]>("cosine_search_chunks", { embedding, dimensions, k });

// ── Entities (extraction/resolution) ─────────────────────────────────────────

export const findEntityByName = (name: string) =>
  invoke<{ id: string; name: string } | null>("find_entity_by_name", { name });

export const findSimilarEntity = (embedding: number[], dimensions: number) =>
  invoke<SimilarEntity | null>("find_similar_entity", { embedding, dimensions });

export const createEntity = (
  name: string,
  entityType: string | null,
  description: string | null,
  embedding: number[],
  dimensions: number,
) => invoke<string>("create_entity", { name, entityType, description, embedding, dimensions });

export const ensureEntityNode = (entityId: string, label: string) =>
  invoke<GraphNode>("ensure_entity_node", { entityId, label });

export interface LlmEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  relation: Extract<RelationType, "mentions" | "related">;
  label: string | null;
}

/** Upserts LLM-origin edges (weight bumped on duplicates). */
export const upsertLlmEdges = (edges: LlmEdgeInput[]) =>
  invoke<void>("upsert_llm_edges", { edges });

/** Drops all chunk vectors + entity embeddings (embedding model change → re-embed). */
export const resetEmbeddings = () => invoke<void>("reset_embeddings");

// ── Conversations ────────────────────────────────────────────────────────────

export const listConversations = () => invoke<Conversation[]>("list_conversations");
export const createConversation = (title?: string, model?: string | null) =>
  invoke<Conversation>("create_conversation", { title: title ?? null, model: model ?? null });
export const renameConversation = (id: string, title: string) =>
  invoke<void>("rename_conversation", { id, title });
export const deleteConversation = (id: string) => invoke<void>("delete_conversation", { id });
export const listMessages = (conversationId: string) =>
  invoke<MessageRow[]>("list_messages", { conversationId });
export const appendMessage = (
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  citations: Citation[] | null = null,
) => invoke<MessageRow>("append_message", { conversationId, role, content, citations });

// ── Ingest jobs ──────────────────────────────────────────────────────────────

export const upsertIngestJob = (
  documentId: string,
  status: JobStatus,
  step: JobStep | null = null,
  error: string | null = null,
) => invoke<IngestJobRow>("upsert_ingest_job", { documentId, status, step, error });

export const listIngestJobs = () => invoke<IngestJobRow[]>("list_ingest_jobs");

// ── Uploads / files ──────────────────────────────────────────────────────────

/** Copies a user-picked file into the app data dir and creates an upload doc. */
export const importUpload = (srcPath: string) => invoke<Doc>("import_upload", { srcPath });

/** Raw bytes of an upload (for webview-side parsing / preview). */
export async function readUploadBytes(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_upload_bytes", { documentId });
}

// ── Workspace ────────────────────────────────────────────────────────────────

export const getWorkspaceInfo = () => invoke<WorkspaceInfo>("get_workspace_info");

/** Records the workspace override (null = back to default). Takes effect on restart. */
export const setWorkspacePath = (path: string | null) =>
  invoke<void>("set_workspace_path", { path });

export const restartApp = () => invoke<void>("restart_app");

/** Reconciles on-disk markdown with the index (files mode; no-op otherwise). */
export const syncWorkspace = () => invoke<SyncReport>("sync_workspace");

/** Switches content storage, migrating notes; returns docs needing re-ingest. */
export const setStorageMode = (mode: StorageMode) =>
  invoke<SyncReport>("set_storage_mode", { mode });

// ── Settings & secrets ───────────────────────────────────────────────────────

export const getSettings = () => invoke<AppSettings | null>("get_settings");
export const setSettings = (settings: AppSettings) => invoke<void>("set_settings", { settings });
export const getSecret = (name: SecretName) => invoke<string | null>("get_secret", { name });
export const setSecret = (name: SecretName, value: string) =>
  invoke<void>("set_secret", { name, value });
export const deleteSecret = (name: SecretName) => invoke<void>("delete_secret", { name });
