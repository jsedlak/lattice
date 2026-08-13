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
        // Event coordinates are physical pixels; the DOM wants logical ones.
        const scale = window.devicePixelRatio || 1;
        ref.current({
          type: payload.type === "drop" ? "drop" : "over",
          x: payload.position.x / scale,
          y: payload.position.y / scale,
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
