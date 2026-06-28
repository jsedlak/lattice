# Phase 05 — Private Per-User Blob Storage

Uploaded source files (PDF, docx, images, xlsx) go to Vercel Blob as **private** objects, namespaced per user, served only through authenticated handlers. This phase delivers upload + the Blobs tab + file preview; ingestion of those files happens in `06`.

## Deliverables

1. Private upload handler with `userId`-prefixed pathnames.
2. Authenticated download/preview handler (path-segment authorization).
3. Blobs tab UI (list with type/size, upload control with progress/states).
4. File detail/preview pane (matches `blob-final.png`).
5. On upload: create the `document(kind='upload')` row + enqueue ingestion (`06`).

## Isolation model

- Namespace every object: `users/{userId}/{docId}/{filename}`.
- `access: "private"` — never publicly reachable by URL.
- Serve only via a handler that (a) verifies the session and (b) asserts the requested pathname starts with `users/{session.user.id}/` before streaming bytes or returning a short-lived signed URL. **No raw blob URLs to the client, ever.**

## Upload handler

`app/api/upload/route.ts`
```ts
import { put } from "@vercel/blob";
import { requireUser } from "@lattice/auth/session";
import { db, document, ingestJob } from "@lattice/db";
import { inngest } from "@lattice/ingest/client";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File;
  // validate: mime allowlist (pdf, docx, txt, md, png, jp, xlsx), size cap
  const docId = crypto.randomUUID();
  const pathname = `users/${user.id}/${docId}/${file.name}`;

  const blob = await put(pathname, file, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });

  const [doc] = await db.insert(document).values({
    id: docId, userId: user.id, kind: "upload", title: file.name,
    blobPathname: blob.pathname, mimeType: file.type, byteSize: file.size,
    ingestStatus: "queued",
  }).returning();

  await db.insert(ingestJob).values({ userId: user.id, documentId: doc.id, status: "queued" });
  await inngest.send({ name: "doc/uploaded", data: { userId: user.id, documentId: doc.id } });

  return Response.json({ documentId: doc.id });
}
```

> When you later need large/direct uploads, switch to Blob **client uploads** with `handleUpload`, and run the same `users/{userId}/` authorization check inside `onBeforeGenerateToken`. The enqueue + row-creation move into `onUploadCompleted`.

## Download / preview handler

`app/api/blob/[...path]/route.ts`
```ts
export async function GET(req, { params }) {
  const user = await requireUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const pathname = (await params).path.join("/");
  if (!pathname.startsWith(`users/${user.id}/`)) return new Response("Forbidden", { status: 403 });
  // resolve a short-lived signed URL (or stream bytes) for this private blob
  // return a redirect to the signed URL, or stream with correct Content-Type
}
```

## Blobs tab UI

Within the editor view's middle column, a **Documents | Blobs** tab switch (from `editor-blobs.png`):
- List rows: file-type badge (PDF/DOCX/PNG/XLSX), name, size; selected row highlighted.
- "Upload file" button at the bottom → drag-drop + picker, with progress bar and `queued / processing / ready / error` states driven by `ingestStatus`.
- Selecting a file opens the detail pane.

## File detail pane

Matches `blob-final.png`:
- Header: icon, filename, `PDF · 2.4 MB · 12 pages · uploaded 4 days ago`, **Download** (via the authenticated handler) + **Ask assistant**.
- Description line ("Ingested, chunked and entity-extracted into your knowledge graph.") reflecting real `ingestStatus`.
- Preview region: PDF/image preview via the signed URL; for docx/xlsx show a parsed-text preview once ingestion produces extracted text (`06`).
- A small "processing" indicator while the Inngest job runs; flips to "ready" when chunks/entities exist.

## Done when

- A file uploads to a private, user-namespaced blob; the row + ingest job + Inngest event are created.
- Downloading/previewing works only for the owner; a forged path for another user's file → 403.
- The Blobs tab lists files with correct type/size and live ingest status.
- No private blob URL is ever exposed to the client.

## Notes

- Enforce a mime allowlist + size cap server-side; reject early.
- `addRandomSuffix: false` keeps deterministic pathnames so the `docId` segment is stable for authorization and joins.
- Deleting a `document(kind='upload')` must also delete the blob (and cascade chunks/nodes) — wire this in the DELETE handler.
