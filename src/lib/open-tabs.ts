/**
 * Open-editor-tab state.
 *
 * Lives in a module-level store rather than component state because the editor
 * screen unmounts whenever the user visits Graph/Assistant/Settings, and tabs
 * must survive that. It's mirrored into layout prefs (settings.json under the
 * `layout` key, shallow-merged Rust-side) so the set of open documents also
 * survives a relaunch.
 *
 * Only the *order* of open ids lives here. The active tab is the `/editor/:id`
 * route param — one source of truth, so wiki-links and assistant citations
 * navigating into a document put its tab in the right state for free.
 */
import * as React from "react";

import { layoutBootCache, loadLayoutPrefs, saveLayoutPrefs } from "@/lib/layout-prefs";

let openIds: string[] = layoutBootCache().openTabIds;
const listeners = new Set<() => void>();

function emit(next: string[]): void {
  openIds = next;
  saveLayoutPrefs({ openTabIds: next });
  for (const l of listeners) l();
}

/** Adopt the persisted tabs once the real prefs land (boot cache may be cold). */
void loadLayoutPrefs().then((p) => {
  // Anything opened during the IPC round-trip wins over the stored list.
  if (openIds.length === 0 && p.openTabIds.length > 0) {
    openIds = p.openTabIds;
    for (const l of listeners) l();
  }
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Append an id if it isn't already open. Idempotent — activating is separate. */
export function openTab(id: string): void {
  if (openIds.includes(id)) return;
  emit([...openIds, id]);
}

/**
 * Close a tab and report which document should take over: the tab to the
 * right, else the one to the left, else null when nothing is left open.
 * The caller decides whether to navigate (only needed if the closed tab was
 * the active one).
 */
export function closeTab(id: string): string | null {
  const at = openIds.indexOf(id);
  if (at === -1) return openIds[0] ?? null;
  const next = openIds.filter((x) => x !== id);
  emit(next);
  return next[at] ?? next[at - 1] ?? null;
}

/** Drop ids that no longer resolve to a document (deleted elsewhere). */
export function pruneTabs(existing: Set<string>): void {
  const next = openIds.filter((id) => existing.has(id));
  if (next.length !== openIds.length) emit(next);
}

export function useOpenTabIds(): string[] {
  return React.useSyncExternalStore(subscribe, () => openIds);
}
