/**
 * Data behind the editor's completions, with the caching the editors need.
 *
 * Completion runs on keystrokes, so every source is cached: tag lookups hit
 * `search_nodes` (which filters and LIMITs SQL-side, so it stays a per-prefix
 * query), while document titles and workspace file paths are small enough to
 * fetch whole and filter in memory. TTLs are short — a note created seconds
 * ago should be linkable — and `invalidateCompletionCaches()` exists for the
 * cases we know about (a save, a new note).
 */
import * as ipc from "@/lib/ipc";

const TTL_MS = 15_000;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

let docsCache: Cached<string[]> | null = null;
let filesCache: Cached<string[]> | null = null;
const tagCache = new Map<string, Cached<string[]>>();

function fresh<T>(c: Cached<T> | null | undefined): c is Cached<T> {
  return !!c && performance.now() - c.at < TTL_MS;
}

/** Titles of every document, newest cache within TTL_MS. */
export function documentTitles(): Promise<string[]> {
  if (fresh(docsCache)) return docsCache.value;
  const value = ipc
    .listDocuments()
    .then((docs) => docs.map((d) => d.title).filter(Boolean))
    .catch(() => []);
  docsCache = { at: performance.now(), value };
  return value;
}

/** Workspace-relative paths under files/, for link/image completion. */
export function workspaceFiles(): Promise<string[]> {
  if (fresh(filesCache)) return filesCache.value;
  const value = ipc.listWorkspaceFiles().catch(() => []);
  filesCache = { at: performance.now(), value };
  return value;
}

/** Existing tag labels matching a prefix (SQL LIKE + LIMIT 20, Rust-side). */
export function tagLabels(prefix: string): Promise<string[]> {
  const key = prefix.toLowerCase();
  const hit = tagCache.get(key);
  if (fresh(hit)) return hit.value;
  const value = ipc
    .searchNodes(key, "tag")
    .then((nodes) => nodes.map((n) => n.label))
    .catch(() => []);
  tagCache.set(key, { at: performance.now(), value });
  return value;
}

/** Drop cached lookups — call after creating/renaming/deleting documents. */
export function invalidateCompletionCaches(): void {
  docsCache = null;
  filesCache = null;
  tagCache.clear();
}
