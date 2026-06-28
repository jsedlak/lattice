import { createNote, listDocuments } from "@lattice/db";
import { NextResponse } from "next/server";
import { onDocumentSaved } from "@/lib/documents";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const docs = await listDocuments(user.id);
  return NextResponse.json({ documents: docs });
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const body = (await req.json().catch(() => ({}))) as { title?: string; content?: string };
  const title = body.title?.trim() || "Untitled note";
  const doc = await createNote(user.id, title, body.content ?? "");

  // Build the deterministic graph node immediately + enqueue ingestion.
  await onDocumentSaved(user.id, doc.id, doc.title, doc.content);

  return NextResponse.json({ document: doc }, { status: 201 });
}
