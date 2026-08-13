import { open } from "@tauri-apps/plugin-dialog";

import { enqueueIngest } from "@/lib/ingest/pipeline";
import { importUpload } from "@/lib/ipc";
import type { Doc } from "@/lib/types";

/**
 * Importing files as uploads. Shared by the Import button, the folder context
 * menu and the OS drag & drop handler so all three file into a folder, queue
 * ingestion and report partial failures the same way.
 */

/** Picker filter — mirrors mime_for() in src-tauri/src/commands/docs.rs. */
export const UPLOAD_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "csv",
  "md",
  "markdown",
  "html",
  "htm",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
];

export interface ImportOutcome {
  docs: Doc[];
  errors: { path: string; message: string }[];
}

/** Native multi-file picker; [] when the user cancels. */
export async function pickUploadPaths(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: "Documents", extensions: UPLOAD_EXTENSIONS }],
  });
  if (picked === null) return [];
  return (Array.isArray(picked) ? picked : [picked]).filter(
    (p): p is string => typeof p === "string",
  );
}

/**
 * Copies each path into the workspace under `folderId` and queues it for
 * ingestion. One rejected file (unsupported type, unreadable) doesn't sink the
 * rest of the batch — the caller decides how loudly to report the failures.
 */
export async function importUploads(
  paths: string[],
  folderId: string | null = null,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { docs: [], errors: [] };
  for (const path of paths) {
    try {
      const doc = await importUpload(path, folderId);
      enqueueIngest(doc.id);
      out.docs.push(doc);
    } catch (e) {
      out.errors.push({ path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** "file.pdf: unsupported file type" — one line per failure, for the UI. */
export function describeImportErrors(errors: ImportOutcome["errors"]): string {
  return errors
    .map(({ path, message }) => `${path.split(/[\\/]/).pop() ?? path}: ${message}`)
    .join("\n");
}
