import { open } from "@tauri-apps/plugin-dialog";

import { loadSettings } from "@/lib/ai/settings";
import { enqueueIngest } from "@/lib/ingest/pipeline";
import {
  importUpload,
  importUploadBytes,
  listDocuments,
  listFolders,
  type UploadTarget,
} from "@/lib/ipc";
import type { Doc, Folder, PasteImageSettings } from "@/lib/types";

/**
 * Importing files as uploads. Shared by the Import button, the folder context
 * menu, the OS drag & drop handler and paste-into-the-editor so all of them
 * file into a folder, queue ingestion and report partial failures the same
 * way.
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
      const doc = await importUpload(path, { folderId });
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

// ── Clipboard ────────────────────────────────────────────────────────────────

/** What a paste carries that we can turn into uploads. */
export interface PastedFiles {
  /** File objects — a screenshot, an image copied from a browser, a file
   *  copied in Finder/Explorer on platforms that expose it as a File. */
  files: File[];
  /** Filesystem paths from a `text/uri-list` of file:// URLs — how some
   *  platforms hand over a file copied in the file manager. */
  paths: string[];
}

/** The files on a paste, or null when it's an ordinary text/html paste. */
export function pastedFiles(dt: DataTransfer | null): PastedFiles | null {
  if (!dt) return null;
  const files = Array.from(dt.files);
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (f && !files.includes(f)) files.push(f);
  }
  const paths: string[] = [];
  if (files.length === 0) {
    for (const line of dt.getData("text/uri-list").split(/\r?\n/)) {
      if (!line.startsWith("file://")) continue;
      try {
        paths.push(decodeURIComponent(new URL(line).pathname));
      } catch {
        // Not a parseable URL — skip it.
      }
    }
  }
  if (files.length === 0 && paths.length === 0) return null;
  return { files, paths };
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "text/csv": "csv",
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Renders a pasted-image name from the user's format (Settings → General).
 * Date tokens are local time — the moment the user pasted, as they'd read it
 * on their own clock — and `{filename}` is the clipboard's stem (browsers
 * hand a screenshot over as "image.png", so it's often just "image").
 */
export function formatPastedName(
  format: string,
  stem: string,
  extension: string,
  at = new Date(),
): string {
  const dates: Record<string, string> = {
    YYYY: pad(at.getFullYear(), 4),
    YY: pad(at.getFullYear() % 100),
    MM: pad(at.getMonth() + 1),
    dd: pad(at.getDate()),
    HH: pad(at.getHours()),
    mm: pad(at.getMinutes()),
    ss: pad(at.getSeconds()),
  };
  const out = format
    .replace(/YYYY|YY|MM|dd|HH|mm|ss/g, (t) => dates[t] ?? t)
    .replaceAll("{filename}", stem)
    .replaceAll("{extension}", extension);
  // A format that drops the extension would make the upload unreadable
  // (mime comes from it) — put it back.
  return out.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? out
    : `${out}.${extension}`;
}

/** The name a pasted File is stored under. Images follow the paste-naming
 *  setting; other files keep their name. A File without an extension gets
 *  one from its MIME type, since that's what the Rust side types it by. */
export function uploadFileName(file: File, pasteImages: PasteImageSettings): string {
  const fromMime = file.name.includes(".") ? "" : MIME_EXT[file.type];
  const name = fromMime ? `${file.name}.${fromMime}` : file.name;
  if (!file.type.startsWith("image/") || pasteImages.naming === "keep") return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : (MIME_EXT[file.type] ?? "");
  return formatPastedName(pasteImages.format, stem, extension);
}

// ── Duplicate names ──────────────────────────────────────────────────────────

/** What to do when a paste's name is already taken in the folder. */
export type ConflictChoice = "replace" | "keep-both";

/** Asks the user; null cancels that file (the rest of the paste continues). */
export type ResolveConflict = (fileName: string) => Promise<ConflictChoice | null>;

const baseName = (doc: Doc) => doc.filePath?.split("/").pop() ?? "";

/** The upload in `folderId` already stored under `fileName`, if any — the one
 *  case where Replace makes sense: the same file pasted twice. */
function duplicateOf(siblings: Doc[], folderId: string | null, fileName: string): Doc | undefined {
  const want = fileName.toLowerCase();
  return siblings.find(
    (d) =>
      d.kind === "upload" && (d.folderId ?? null) === folderId && baseName(d).toLowerCase() === want,
  );
}

const splitName = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0
    ? { stem: fileName.slice(0, dot), ext: fileName.slice(dot) }
    : { stem: fileName, ext: "" };
};

const nameKey = (name: string) => name.trim().toLowerCase();

/** Names in use directly inside `folderId`, as keys. Names are unique per
 *  folder across folders, notes and uploads (an upload's name is its title,
 *  the stem) — mirrors ensure_name_free in src-tauri/src/commands/docs.rs. */
function namesIn(docs: Doc[], folders: Folder[], folderId: string | null): Set<string> {
  return new Set([
    ...docs.filter((d) => (d.folderId ?? null) === folderId).map((d) => nameKey(d.title)),
    ...folders.filter((f) => (f.parentId ?? null) === folderId).map((f) => nameKey(f.name)),
  ]);
}

/**
 * "Keep both": `image.png` next to an existing `image.png` becomes
 * `image 2.png`; next to `image 2.png` and `image 3.png` it becomes
 * `image 4.png` — one past the highest number the folder already holds.
 * Any item counts: a note "image 2" takes that number too.
 */
export function nextAvailableName(taken: Set<string>, fileName: string): string {
  const { stem, ext } = splitName(fileName);
  const key = nameKey(stem);
  let last = 0;
  for (const name of taken) {
    if (name === key) last = Math.max(last, 1);
    else if (name.startsWith(`${key} `)) {
      const n = name.slice(key.length + 1);
      if (/^\d+$/.test(n)) last = Math.max(last, Number(n));
    }
  }
  return `${stem} ${last + 1}${ext}`;
}

/**
 * Uploads a paste into `folderId`: File bytes go over IPC as raw bodies,
 * paths are copied like a picker/drop import. A name the folder already
 * holds — the same file pasted twice, or the naming format producing the
 * same stamp — goes through `resolve`: Replace overwrites the existing
 * upload's file (its id and every link to it survive), Keep both numbers the
 * newcomer, cancel skips it.
 */
export async function importPasted(
  pasted: PastedFiles,
  folderId: string | null,
  resolve: ResolveConflict,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { docs: [], errors: [] };
  const { pasteImages } = await loadSettings();
  // Fetched once; docs this paste creates are appended so two files in one
  // paste with the same name collide with each other too.
  const [siblings, folders] = await Promise.all([listDocuments(), listFolders()]);
  const taken = namesIn(siblings, folders, folderId);

  const incoming: { name: string; store: (target: UploadTarget) => Promise<Doc> }[] = [
    ...pasted.paths.map((path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      store: (target: UploadTarget) => importUpload(path, target),
    })),
    ...pasted.files.map((file) => ({
      name: uploadFileName(file, pasteImages),
      store: async (target: UploadTarget) =>
        importUploadBytes(target.fileName ?? uploadFileName(file, pasteImages), await file.arrayBuffer(), target),
    })),
  ];

  for (const { name, store } of incoming) {
    try {
      let target: UploadTarget = { folderId };
      const existing = duplicateOf(siblings, folderId, name);
      if (existing) {
        const choice = await resolve(name);
        if (choice === null) continue;
        target =
          choice === "replace"
            ? { replaceId: existing.id }
            : { folderId, fileName: nextAvailableName(taken, name) };
      } else if (taken.has(nameKey(splitName(name).stem))) {
        // The name is held by something Replace can't overwrite — a note, a
        // folder, or an upload of another type ("report.pdf" vs "report.docx"
        // are both "report"). Keep both is the only option, so don't ask.
        target = { folderId, fileName: nextAvailableName(taken, name) };
      }
      const doc = await store(target);
      taken.add(nameKey(doc.title));
      enqueueIngest(doc.id);
      out.docs.push(doc);
      if (existing && "replaceId" in target) {
        siblings.splice(siblings.indexOf(existing), 1, doc);
      } else {
        siblings.push(doc);
      }
    } catch (e) {
      out.errors.push({ path: name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The markdown that references an upload from a note: images embed, so the
 *  preview shows them (`files/…` is served by the lattice-file scheme);
 *  everything else is a wiki-link, which resolves to the upload by title and
 *  becomes a graph edge like any other link. */
export function markdownForUpload(doc: Doc): string {
  if (doc.mimeType?.startsWith("image/") && doc.filePath) {
    return `![${doc.title}](${doc.filePath})`;
  }
  return `[[${doc.title}]]`;
}
