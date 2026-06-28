import { getDocument } from "@lattice/db";
import { getUserBlobResponse } from "@/lib/blob";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Serve an uploaded (private) file by document id. Ownership is enforced by the
 * user-scoped getDocument lookup; the file is streamed from the private store.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const doc = await getDocument(user.id, id);
  if (!doc || !doc.blobPathname) return new Response("Not found", { status: 404 });

  try {
    return await getUserBlobResponse(doc.blobPathname, doc.mimeType);
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
