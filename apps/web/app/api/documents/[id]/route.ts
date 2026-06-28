import { deleteDocument, getDocument, updateDocument } from "@lattice/db";
import { NextResponse } from "next/server";
import { delUserBlob } from "@/lib/blob";
import { onDocumentSaved } from "@/lib/documents";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const doc = await getDocument(user.id, id);
  if (!doc) return new Response("Not found", { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
    folderId?: string | null;
  };

  // Only set keys actually present so a folder move (folderId: null) is
  // distinguishable from an autosave that shouldn't touch the folder.
  const patch: { title?: string; content?: string; folderId?: string | null } = {};
  if ("title" in body) patch.title = body.title;
  if ("content" in body) patch.content = body.content;
  if ("folderId" in body) patch.folderId = body.folderId ?? null;

  const updated = await updateDocument(user.id, id, patch);
  if (!updated) return new Response("Not found", { status: 404 });

  // Re-run graph build + enqueue re-ingest only for authored notes when content
  // is present (uploads are ingested via their own pipeline).
  if (updated.kind === "note" && (body.content !== undefined || body.title !== undefined)) {
    await onDocumentSaved(user.id, updated.id, updated.title, updated.content);
  }

  return NextResponse.json({ document: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const deleted = await deleteDocument(user.id, id);
  if (!deleted) return new Response("Not found", { status: 404 });
  // Best-effort: remove the blob bytes for uploads (DB rows already cascaded).
  if (deleted.kind === "upload" && (deleted.blobUrl || deleted.blobPathname)) {
    try {
      await delUserBlob(deleted.blobUrl ?? deleted.blobPathname!);
    } catch (err) {
      console.error("[documents] blob cleanup failed", err);
    }
  }
  return NextResponse.json({ ok: true });
}
