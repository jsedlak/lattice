import type { Conversation, Document, Folder } from "@lattice/db";

/** A selectable chat model with input/output price ($ per 1M tokens). */
export interface AssistantModel {
  name: string;
  input: string;
  output: string;
}

export function setConversationModel(conversationId: string, model: string) {
  return fetch(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  }).then(json<{ conversation: Conversation }>);
}

export function renameConversation(conversationId: string, title: string) {
  return fetch(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then(json<{ conversation: Conversation }>);
}

export function deleteConversation(conversationId: string) {
  return fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).then(
    json<{ ok: boolean }>,
  );
}

/** Browser-side typed fetchers. All endpoints are session-checked server-side. */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function listDocuments() {
  return fetch("/api/documents").then(json<{ documents: Document[] }>);
}

export function createNote(title?: string) {
  return fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then(json<{ document: Document }>);
}

export function getDocument(id: string) {
  return fetch(`/api/documents/${id}`).then(json<{ document: Document }>);
}

export function updateDocument(
  id: string,
  patch: { title?: string; content?: string; folderId?: string | null },
) {
  return fetch(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json<{ document: Document }>);
}

export function deleteDocument(id: string) {
  return fetch(`/api/documents/${id}`, { method: "DELETE" }).then(json<{ ok: boolean }>);
}

export function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  return fetch("/api/upload", { method: "POST", body: form }).then(json<{ document: Document }>);
}

export interface GraphResponse {
  nodes: { id: string; type: "document" | "tag" | "entity"; label: string; documentId: string | null; degree: number }[];
  edges: { id: string; source: string; target: string; relation: string; origin: string }[];
  counts: { documents: number; tags: number; entities: number; edges: number };
}

export function fetchGraph(params?: { types?: string[]; origin?: string }) {
  const q = new URLSearchParams();
  if (params?.types?.length) q.set("types", params.types.join(","));
  if (params?.origin) q.set("origin", params.origin);
  const qs = q.toString();
  return fetch(`/api/graph${qs ? `?${qs}` : ""}`).then(json<GraphResponse>);
}

/** Authenticated URL for an uploaded document's file (served by document id). */
export function blobUrl(documentId: string) {
  return `/api/blob/${documentId}`;
}

// ── Folders ───────────────────────────────────────────────────────────────

export function listFolders() {
  return fetch("/api/folders").then(json<{ folders: Folder[] }>);
}

export function createFolder(name: string, parentId?: string | null) {
  return fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId: parentId ?? null }),
  }).then(json<{ folder: Folder }>);
}

export function renameFolder(id: string, name: string) {
  return fetch(`/api/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(json<{ folder: Folder }>);
}

export function deleteFolder(id: string) {
  return fetch(`/api/folders/${id}`, { method: "DELETE" }).then(json<{ ok: boolean }>);
}

/** Move a document into a folder (null = root). */
export function moveDocument(documentId: string, folderId: string | null) {
  return updateDocument(documentId, { folderId });
}
