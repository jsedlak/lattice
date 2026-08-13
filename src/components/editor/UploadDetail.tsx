import { MessageSquare } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fileSize, fileTypeLabel, relativeTime } from "@/lib/format";
import { readUploadBytes } from "@/lib/ipc";
import type { Doc, IngestStatus } from "@/lib/types";

import { MarkdownPreview } from "./MarkdownPreview";

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
        <UploadPreview doc={doc} />
      </div>
    </div>
  );
}

/** How the file itself renders. `extracted` (docx, xlsx, anything unknown)
 *  falls back to the text ingestion pulled out of it. */
type PreviewKind = "pdf" | "image" | "html" | "markdown" | "text" | "extracted";

function previewKind(mime: string | null): PreviewKind {
  if (!mime) return "extracted";
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("html")) return "html";
  if (mime.includes("markdown")) return "markdown";
  if (mime.startsWith("text/")) return "text";
  return "extracted";
}

/**
 * Renders the upload's own bytes where we can: PDFs and images through an
 * object URL, markdown through the note renderer, text/CSV verbatim, and HTML
 * inside a sandboxed iframe — the webview holds IPC access, so an uploaded page
 * never gets scripts, forms or same-origin rights (which also means its
 * relative images and stylesheets don't load).
 */
function UploadPreview({ doc }: { doc: Doc }) {
  const kind = previewKind(doc.mimeType);
  const asText = kind === "html" || kind === "markdown" || kind === "text";
  const [url, setUrl] = React.useState<string | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (kind === "extracted") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setText(null);
    setFailed(false);
    readUploadBytes(doc.id)
      .then((bytes) => {
        if (cancelled) return;
        if (asText) {
          setText(new TextDecoder().decode(bytes));
          return;
        }
        const blob = new Blob([new Uint8Array(bytes)], {
          type: doc.mimeType ?? "application/octet-stream",
        });
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Re-read only when the underlying file identity changes, not on
    // ingest-status poll updates of the same doc.
  }, [doc.id, doc.mimeType, kind, asText]);

  if (kind === "extracted" || failed) {
    return (
      <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono  text-muted">
        {doc.content.slice(0, 4000) || "No extracted text yet."}
      </div>
    );
  }
  if (url === null && text === null) {
    return (
      <div className="flex h-[20vh] items-center justify-center  text-faint">Loading preview…</div>
    );
  }
  if (kind === "image") {
    return <img src={url!} alt={doc.title} className="max-h-[60vh] w-full object-contain" />;
  }
  if (kind === "pdf") {
    return <iframe title={doc.title} src={url!} className="h-[60vh] w-full" />;
  }
  if (kind === "html") {
    return (
      <iframe
        title={doc.title}
        srcDoc={text!}
        sandbox=""
        className="h-[60vh] w-full bg-white"
      />
    );
  }
  if (kind === "markdown") {
    return (
      <div className="max-h-[60vh] overflow-auto px-4 py-4">
        <MarkdownPreview content={text!} />
      </div>
    );
  }
  return (
    <div className="max-h-[60vh] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono  text-muted">
      {text}
    </div>
  );
}
