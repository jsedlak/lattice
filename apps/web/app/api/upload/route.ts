import { createIngestJob, createUploadDocument } from "@lattice/db";
import { inngest } from "@lattice/ingest";
import { NextResponse } from "next/server";
import { putUserBlob } from "@/lib/blob";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("No file", { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new Response("File too large (max 25 MB)", { status: 413 });
  }
  // Some browsers send an empty/odd type for .md etc. — allow by extension too.
  const byExt = /\.(pdf|docx|xlsx|xls|txt|md|png|jpe?g)$/i.test(file.name);
  if (file.type && !ALLOWED.includes(file.type) && !byExt) {
    return new Response(`Unsupported type: ${file.type}`, { status: 415 });
  }

  const docId = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const pathname = `users/${user.id}/${docId}/${safeName}`;

  let blob: Awaited<ReturnType<typeof putUserBlob>>;
  try {
    blob = await putUserBlob(pathname, file);
  } catch (err) {
    console.error("[upload] blob put failed", err);
    return new Response("Storage upload failed", { status: 502 });
  }

  const doc = await createUploadDocument({
    id: docId,
    userId: user.id,
    kind: "upload",
    title: file.name,
    content: "",
    blobPathname: blob.pathname,
    blobUrl: blob.url,
    mimeType: file.type || null,
    byteSize: file.size,
    ingestStatus: "queued",
  });

  // Enqueue ingestion — but a missing Inngest dev server must not fail the
  // upload (the file is already stored; ingestion can be retried).
  try {
    await createIngestJob(user.id, doc.id);
    await inngest.send({ name: "doc/uploaded", data: { userId: user.id, documentId: doc.id } });
  } catch (err) {
    console.error("[upload] enqueue failed (file stored, ingestion deferred)", err);
  }

  return NextResponse.json({ document: doc }, { status: 201 });
}
