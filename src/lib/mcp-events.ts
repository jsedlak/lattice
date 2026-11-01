import { listen } from "@tauri-apps/api/event";
import * as React from "react";

/** Mirrors `CHANGED_EVENT` in src-tauri/src/mcp/tools.rs. */
const MCP_DOCUMENTS_CHANGED = "mcp-documents-changed";

export interface McpDocumentsChanged {
  /** New or edited text: needs the full ingest pipeline. */
  ingest: string[];
  /** Text changed underneath the editor: an open pane must reload it. */
  edited: string[];
  /** Title or folder path changed, content didn't: deterministic graph only. */
  rebuild: string[];
}

/**
 * Runs `handler` whenever an MCP client creates, edits, or renames a note or
 * folder. Writes from MCP bypass the webview, so this is how the tree, the
 * Recent list, open editors, and the ingest queue hear about them.
 */
export function useMcpDocumentsChanged(handler: (e: McpDocumentsChanged) => void): void {
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<McpDocumentsChanged>(MCP_DOCUMENTS_CHANGED, (e) => handlerRef.current(e.payload)).then(
      (fn) => {
        // Unmounted before listen resolved — don't leak the subscription.
        if (cancelled) fn();
        else unlisten = fn;
      },
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
