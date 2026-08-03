/**
 * Folder structure as graph context.
 *
 * A note's location is meaning the user already expressed: a note at
 * `lattice/documentation/readme.md` is *about* lattice and documentation
 * without saying so in its body. Each ancestor folder name becomes a tag —
 * the same tag nodes inline `#tags` produce — so folder context flows into
 * the graph screen, `searchNodes`, and the assistant's graph tools with no
 * new node type and no schema migration.
 *
 * Deliberately flat: a document links to every ancestor's tag, but tags carry
 * no parent→child edges between themselves. A tag can sit at different depths
 * under different paths, and deterministic edges are replaced per source node,
 * so a chain written from a tag node would flap between documents that share
 * it. The ordered path survives as text in the extraction prompt instead.
 */
import type { Folder } from "@/lib/types";

/** Ancestor chain for a folder, outermost first (the folder itself is last). */
export function folderChain(folderId: string | null, folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let cur = folderId;
  while (cur) {
    if (seen.has(cur)) break; // defensive: a cycle would otherwise hang the save
    seen.add(cur);
    const folder = byId.get(cur);
    if (!folder) break;
    chain.unshift(folder);
    cur = folder.parentId;
  }
  return chain;
}

/**
 * Folder name → tag label. Lower-cased, non-alphanumerics collapsed to
 * hyphens (`My Notes` → `my-notes`), matching how `parseLinks` lower-cases
 * inline tags. Labels that can't be written inline (a leading digit, say) are
 * still kept — `ensure_tag_node` accepts any label, and dropping them would
 * silently lose folders like `2024`.
 */
export function folderTag(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/** De-duplicated tag labels derived from a document's folder path. */
export function folderTags(folderId: string | null, folders: Folder[]): string[] {
  const tags = new Set<string>();
  for (const f of folderChain(folderId, folders)) {
    const tag = folderTag(f.name);
    if (tag) tags.add(tag);
  }
  return [...tags];
}

/** Human-readable path for prompts — `lattice/documentation`, or null at root. */
export function folderPathLabel(folderId: string | null, folders: Folder[]): string | null {
  const chain = folderChain(folderId, folders);
  return chain.length ? chain.map((f) => f.name).join("/") : null;
}

/** Every folder id in a subtree, including the root of it. */
export function folderSubtreeIds(folderId: string, folders: Folder[]): Set<string> {
  const ids = new Set([folderId]);
  // Folders arrive parent-before-child from list_folders, but don't rely on it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}
