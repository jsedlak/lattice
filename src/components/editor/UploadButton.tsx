import { Upload } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeImportErrors, importUploads, pickUploadPaths } from "@/lib/uploads";

/**
 * Desktop replacement for the web UploadButton: instead of a hidden
 * <input type="file"> + POST /api/upload, we open the native file picker and
 * let the Rust core copy the files into the app data dir, then kick ingestion.
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
    const paths = await pickUploadPaths();
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { docs, errors } = await importUploads(paths);
      setError(errors.length > 0 ? describeImportErrors(errors) : null);
      // Land on the first import; the rest ingest in the background.
      if (docs[0]) navigate(`/editor/${docs[0].id}?tab=uploads`);
      onRefresh();
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
        Import files
      </button>
      {error && <p className="mt-1 whitespace-pre-wrap  text-graph-citation">{error}</p>}
    </div>
  );
}
