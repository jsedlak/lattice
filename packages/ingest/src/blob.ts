import { get } from "@vercel/blob";

/**
 * Read an uploaded (private) blob's bytes server-side, by pathname. The store is
 * private, so reads go through the authenticated `get()` with the RW token.
 */
export async function getBlobBytes(pathname: string): Promise<Buffer> {
  const result = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result || !result.stream) {
    throw new Error(`Blob not found: ${pathname}`);
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
