import { open } from "@tauri-apps/plugin-dialog";
import { Upload } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { enqueueIngest } from "@/lib/ingest/pipeline";
import { importUpload } from "@/lib/ipc";

/**
 * Desktop replacement for the web UploadButton: instead of a hidden
 * <input type="file"> + POST /api/upload, we open the native file picker and
 * let the Rust core copy the file into the app data dir, then kick ingestion.
 */
export function UploadButton({
  className,
  onRefresh,
}: {
  className?: string;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onImport() {
    const path = await open({
      multiple: false,
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "docx", "xlsx", "xls", "txt", "md", "png", "jpg", "jpeg"],
        },
      ],
    });
    if (typeof path !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const document = await importUpload(path);
      enqueueIngest(document.id);
      navigate(`/editor/${document.id}?tab=uploads`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err ?? "Import failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onImport}
        disabled={busy}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-2  text-muted hover:bg-surface-raised hover:text-foreground",
        )}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        Import file
      </button>
      {error && <p className="mt-1  text-graph-citation">{error}</p>}
    </div>
  );
}
