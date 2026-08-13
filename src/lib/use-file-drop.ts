import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

/** An OS file drag over the webview, in CSS pixels relative to the page. */
export interface FileDragEvent {
  type: "over" | "drop" | "leave";
  x: number;
  y: number;
  /** The dragged files — populated on "drop"; empty while hovering. */
  paths: string[];
}

/**
 * Subscribes to files dragged in from the OS. Tauri owns these events
 * (`dragDropEnabled` in tauri.conf.json) rather than the webview, because an
 * HTML5 drop hands over File objects with no filesystem path and import_upload
 * needs a real path — the cost is that callers hit-test the drop themselves.
 *
 * `handler` is kept in a ref, so the subscription survives its identity
 * changing across renders.
 */
export function useFileDrop(handler: (event: FileDragEvent) => void): void {
  const ref = React.useRef(handler);
  ref.current = handler;

  React.useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    // Page origin on the desktop, physical px. Cached for the drag: the window
    // can't move while a file drag is in flight.
    let origin: { x: number; y: number } | null = null;
    // An "over" lookup is out for IPC / the drag already landed.
    let inFlight = false;
    let dropped = false;

    /**
     * Top-left of the page on the desktop, in physical pixels: the window's
     * client area (which excludes the title bar) plus the webview's offset
     * inside it. `Webview.position()` is documented as desktop-relative but is
     * really parent-relative — hence both halves.
     */
    async function pageOrigin(): Promise<{ x: number; y: number }> {
      const [client, webview] = await Promise.all([
        getCurrentWindow().innerPosition(),
        getCurrentWebview().position(),
      ]);
      return { x: client.x + webview.x, y: client.y + webview.y };
    }

    /**
     * Where the cursor is inside the page, in CSS pixels.
     *
     * The event payload can't be trusted for this: Tauri types every platform's
     * position as PhysicalPosition, but wry forwards each platform's native
     * coordinates unscaled — AppKit points on macOS, GTK coordinates on Linux,
     * physical device pixels on Windows — and macOS flips y against the webview
     * frame rather than the visible viewport. Asking the OS where the cursor is
     * and where the page starts sidesteps the guesswork: both are physical and
     * desktop-relative, so their difference over the device pixel ratio is the
     * page coordinate.
     */
    async function pagePoint(): Promise<{ x: number; y: number }> {
      origin ??= await pageOrigin();
      const cursor = await cursorPosition();
      const dpr = window.devicePixelRatio || 1;
      return { x: (cursor.x - origin.x) / dpr, y: (cursor.y - origin.y) / dpr };
    }

    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          origin = null;
          ref.current({ type: "leave", x: 0, y: 0, paths: [] });
          return;
        }
        // A fresh drag: re-read the origin in case the window moved.
        if (payload.type === "enter") {
          origin = null;
          dropped = false;
        }
        const isDrop = payload.type === "drop";
        // Hover events outrun the IPC round trip; coalesce them rather than
        // queue up stale positions. A drop always goes through.
        if (!isDrop && (inFlight || dropped)) return;
        if (isDrop) dropped = true;
        inFlight = true;

        const paths = isDrop ? payload.paths : [];
        void pagePoint()
          .then(({ x, y }) => {
            // A hover that resolved after the drop would revive the highlight.
            if (disposed || (!isDrop && dropped)) return;
            ref.current({ type: isDrop ? "drop" : "over", x, y, paths });
          })
          .catch((e: unknown) => console.error("file drop: locating the cursor failed", e))
          .finally(() => {
            inFlight = false;
            if (isDrop) origin = null;
          });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
