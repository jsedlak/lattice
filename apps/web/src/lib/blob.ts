import "server-only";
import { del, get, put } from "@vercel/blob";

/**
 * Private Vercel Blob storage. The store is configured for PRIVATE access, so
 * blobs require authentication to read — they're served only through the
 * authenticated /api/blob/[id] route (which checks document ownership), never
 * by raw URL.
 */
const token = process.env.BLOB_READ_WRITE_TOKEN;

export async function putUserBlob(pathname: string, file: File) {
  return put(pathname, file, {
    access: "private",
    addRandomSuffix: true,
    token,
  });
}

/** Delete a blob's bytes (best-effort; caller should not fail on error). */
export async function delUserBlob(urlOrPathname: string) {
  await del(urlOrPathname, { token });
}

/** Read a private blob as a streaming Response (for the download route). */
export async function getUserBlobResponse(
  pathname: string,
  contentType?: string | null,
): Promise<Response> {
  const result = await get(pathname, { access: "private", token });
  if (!result || !result.stream) return new Response("Not found", { status: 404 });
  return new Response(result.stream, {
    headers: {
      "Content-Type": contentType ?? result.blob.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}
