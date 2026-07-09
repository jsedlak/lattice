import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import * as ipc from "@/lib/ipc";

export type LocalModelStatus = "checking" | "absent" | "downloading" | "ready" | "error";

/**
 * State machine around the built-in embedding model: presence check, download
 * with live progress (Rust emits `local-embedding-progress`), and the smoke
 * test that runs as part of the download command — "ready" means an embedding
 * has actually been produced on this machine.
 */
export function useLocalEmbedding() {
  const [status, setStatus] = React.useState<LocalModelStatus>("checking");
  const [progress, setProgress] = React.useState<{ downloaded: number; total: number } | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void ipc
      .localEmbeddingStatus()
      .then((info) => {
        if (!cancelled) setStatus((s) => (s === "downloading" ? s : info.ready ? "ready" : "absent"));
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const download = React.useCallback(async (): Promise<boolean> => {
    setStatus("downloading");
    setError(null);
    setProgress(null);
    const unlisten = await listen<{ downloaded: number; total: number }>(
      "local-embedding-progress",
      (e) => setProgress(e.payload),
    );
    try {
      await ipc.downloadLocalEmbeddingModel();
      setStatus("ready");
      return true;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      unlisten();
    }
  }, []);

  return { status, progress, error, download };
}
