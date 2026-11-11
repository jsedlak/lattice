/**
 * Which folders in the document tree are expanded.
 *
 * Same arrangement as open-tabs.ts: a module-level store, because the tree
 * unmounts whenever the user leaves the editor screen, mirrored into layout
 * prefs so it also survives a relaunch.
 *
 * Folders start collapsed: only the *expanded* set is stored, so a folder the
 * user never opened — including one synced from disk or made by an MCP agent —
 * stays closed. The tree opens folders itself where hiding the result would
 * be confusing: around something just created or dropped, and along the path
 * to the selected document.
 */
import * as React from "react";

import { layoutBootCache, loadLayoutPrefs, saveLayoutPrefs } from "@/lib/layout-prefs";

let expanded: ReadonlySet<string> = new Set(layoutBootCache().expandedFolderIds);
let touched = false;
const listeners = new Set<() => void>();

function emit(next: Set<string>): void {
  expanded = next;
  touched = true;
  saveLayoutPrefs({ expandedFolderIds: [...next] });
  for (const l of listeners) l();
}

/** Adopt the persisted state once the real prefs land (boot cache may be cold). */
void loadLayoutPrefs().then((p) => {
  // Merge rather than pick: the tree may already have opened folders during
  // the IPC round-trip (revealing the selected note), and saving just those
  // would overwrite everything the user had open.
  const merged = new Set([...p.expandedFolderIds, ...expanded]);
  if (touched) emit(merged);
  else {
    expanded = merged;
    for (const l of listeners) l();
  }
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toggleFolder(id: string): void {
  const next = new Set(expanded);
  if (!next.delete(id)) next.add(id);
  emit(next);
}

/** Open folders — e.g. so something just created or dropped inside is visible. */
export function expandFolders(...ids: string[]): void {
  const missing = ids.filter((id) => !expanded.has(id));
  if (missing.length === 0) return;
  emit(new Set([...expanded, ...missing]));
}

/** Drop ids of folders that no longer exist (deleted, or removed by sync). */
export function pruneExpandedFolders(existing: Set<string>): void {
  const next = new Set([...expanded].filter((id) => existing.has(id)));
  if (next.size !== expanded.size) emit(next);
}

export function useExpandedFolders(): ReadonlySet<string> {
  return React.useSyncExternalStore(subscribe, () => expanded);
}
