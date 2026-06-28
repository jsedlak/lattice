import "server-only";
import { buildDeterministic } from "@lattice/graph";
import { inngest } from "@lattice/ingest";

/**
 * Shared "a document was authored/changed" hook. Runs the cheap deterministic
 * graph build synchronously (instant tags/links) and enqueues the background
 * ingest job (chunk → embed → extract). Coalesced by the function's debounce.
 */
export async function onDocumentSaved(
  userId: string,
  documentId: string,
  title: string,
  content: string,
) {
  try {
    await buildDeterministic(userId, documentId, title, content);
  } catch (err) {
    console.error("[onDocumentSaved] deterministic build failed", err);
  }
  await inngest.send({ name: "doc/saved", data: { userId, documentId } });
}
