import { MessageSquare } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fileSize, fileTypeLabel, relativeTime } from "@/lib/format";
import { readUploadBytes } from "@/lib/ipc";
import type { Doc, IngestStatus } from "@/lib/types";

const STATUS_LABEL: Record<
  IngestStatus,
  { label: string; concept: "tag" | "entity" | "citation" | "neutral" }
> = {
  idle: { label: "Idle", concept: "neutral" },
  queued: { label: "Queued", concept: "entity" },
  processing: { label: "Processing…", concept: "entity" },
  ready: { label: "Ready", concept: "tag" },
  error: { label: "Error", concept: "citation" },
};

/** Same shell as the web button `size="sm"` primary (buttonVariants). */
const primarySmLink =
  "inline-flex items-center justify-center gap-2 rounded-md  font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background select-none bg-accent text-accent-foreground hover:bg-accent-active h-8 px-3";

/**
 * Detail pane for an upload document (the web app's BlobDetail). Instead of
 * streaming from /api/blob/:id, we read the raw bytes over IPC and preview
 * PDFs/images via an object URL; everything else falls back to the extracted
 * text stored on the document.
 */
export function UploadDetail({ doc }: { doc: Doc }) {
  const status = STATUS_LABEL[doc.ingestStatus];
  const isPreviewable = doc.mimeType?.includes("pdf") || doc.mimeType?.startsWith("image/");
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = React.useState(false);

  React.useEffect(() => {
    if (!isPreviewable) return;
    let cancelled = false;
    let url: string | null = null;
    setObjectUrl(null);
    setPreviewFailed(false);
    readUploadBytes(doc.id)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], {
          type: doc.mimeType ?? "application/octet-stream",
        });
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Re-read only when the underlying file identity changes, not on
    // ingest-status poll updates of the same doc.
  }, [doc.id, doc.mimeType, isPreviewable]);

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-8 py-8">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-raised  font-semibold text-muted">
          {fileTypeLabel(doc.mimeType, doc.kind)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-1  text-muted">
            {fileTypeLabel(doc.mimeType, doc.kind)} · {fileSize(doc.byteSize)}
            {doc.pageCount ? ` · ${doc.pageCount} pages` : ""} · uploaded{" "}
            {relativeTime(doc.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge concept={status.concept}>{status.label}</Badge>
          <Link to={`/assistant?doc=${doc.id}`} className={cn(primarySmLink, "gap-1.5")}>
            <MessageSquare className="h-3.5 w-3.5" /> Ask
          </Link>
        </div>
      </div>

      <p className="mt-5  text-muted">
        {doc.ingestStatus === "ready"
          ? "Ingested, chunked and entity-extracted into your knowledge graph."
          : doc.ingestStatus === "error"
            ? (doc.ingestError ?? "Something went wrong during ingestion.")
            : "Being ingested into your knowledge graph…"}
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-surface-raised px-4 py-2  font-medium text-muted">
          Preview · {fileTypeLabel(doc.mimeType, doc.kind)}
        </div>
        {isPreviewable && !previewFailed ? (
          objectUrl ? (
            doc.mimeType?.startsWith("image/") ? (
              <img src={objectUrl} alt={doc.title} className="max-h-[60vh] w-full object-contain" />
            ) : (
              <iframe title={doc.title} src={objectUrl} className="h-[60vh] w-full" />
            )
          ) : (
            <div className="flex h-[20vh] items-center justify-center  text-faint">
              Loading preview…
            </div>
          )
        ) : (
          <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono  text-muted">
            {doc.content.slice(0, 4000) || "No extracted text yet."}
          </div>
        )}
      </div>
    </div>
  );
}
