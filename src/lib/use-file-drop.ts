import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as React from "react";

/** An OS file drag over the webview, in logical (CSS) pixels. */
export interface FileDragEvent {
  type: "over" | "drop" | "leave";
  x: number;
  y: number;
  /** The dragged files — populated on "drop"; empty while hovering. */
  paths: string[];
}

const inViewport = (p: { x: number; y: number }) =>
  p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;

/**
 * Drop point in CSS pixels, which is what the DOM (elementFromPoint) wants.
 *
 * Tauri types every platform's drop position as `PhysicalPosition`, but wry
 * passes each platform's native coordinates through unscaled: AppKit points on
 * macOS (wkwebview/drag_drop.rs) and GTK coordinates on Linux are already
 * logical, while the Win32 drop target reports physical device pixels. So the
 * devicePixelRatio divide applies on Windows only — doing it on a Retina Mac
 * halves the point and the drop lands up and to the left of the cursor.
 *
 * The other reading is used as a fallback when the preferred one lands outside
 * the viewport, so a future change to wry's contract degrades instead of
 * breaking.
 */
function toCssPixels(x: number, y: number): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  const scaled = { x: x / dpr, y: y / dpr };
  const candidates = navigator.userAgent.includes("Windows")
    ? [scaled, { x, y }]
    : [{ x, y }, scaled];
  return candidates.find(inViewport) ?? candidates[0]!;
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

    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          ref.current({ type: "leave", x: 0, y: 0, paths: [] });
          return;
        }
        const { x, y } = toCssPixels(payload.position.x, payload.position.y);
        ref.current({
          type: payload.type === "drop" ? "drop" : "over",
          x,
          y,
          paths: payload.type === "drop" ? payload.paths : [],
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
