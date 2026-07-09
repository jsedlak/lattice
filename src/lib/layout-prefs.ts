/**
 * Persistent UI layout preferences: sidebar collapse and pane widths.
 * Source of truth is the Rust-owned settings.json — set_settings merges
 * shallowly, so writing the `layout` key never disturbs other settings (and
 * vice versa). localStorage is only a synchronous boot cache so panes render
 * at their remembered size on first paint, before the IPC round-trip.
 */
import type { AppSettings } from "@/lib/types";
import * as ipc from "@/lib/ipc";

export interface LayoutPrefs {
  sidebarCollapsed: boolean;
  /** Main nav sidebar width when expanded, px. */
  sidebarWidth: number;
  /** Document tree width in the editor screen, px. */
  treeWidth: number;
  /** Editor's share of the editor/preview split, 0..1. */
  editorSplit: number;
}

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  sidebarCollapsed: false,
  sidebarWidth: 224,
  treeWidth: 288,
  editorSplit: 0.5,
};

const CACHE_KEY = "lattice.layout";
let loaded: LayoutPrefs | null = null;

/** Best-effort prefs for first paint (no IPC). */
export function layoutBootCache(): LayoutPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    return { ...LAYOUT_DEFAULTS, ...(raw as Partial<LayoutPrefs>) };
  } catch {
    return LAYOUT_DEFAULTS;
  }
}

/** The persisted prefs from settings.json (cached after the first call). */
export async function loadLayoutPrefs(): Promise<LayoutPrefs> {
  if (loaded) return loaded;
  const raw = (await ipc.getSettings()) as { layout?: Partial<LayoutPrefs> } | null;
  loaded = { ...LAYOUT_DEFAULTS, ...raw?.layout };
  localStorage.setItem(CACHE_KEY, JSON.stringify(loaded));
  return loaded;
}

export function saveLayoutPrefs(patch: Partial<LayoutPrefs>): void {
  loaded = { ...(loaded ?? layoutBootCache()), ...patch };
  localStorage.setItem(CACHE_KEY, JSON.stringify(loaded));
  // Only the `layout` key reaches disk — Rust-side shallow merge.
  void ipc.setSettings({ layout: loaded } as unknown as AppSettings);
}
