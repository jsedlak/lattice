"use client";

import type { Document } from "@lattice/db";
import { Badge, buttonVariants, cn } from "@lattice/ui";
import { Download, MessageSquare } from "lucide-react";
import Link from "next/link";
import { blobUrl } from "@/lib/client-api";
import { fileSize, fileTypeLabel, relativeTime } from "@/lib/format";

const STATUS_LABEL: Record<
  Document["ingestStatus"],
  { label: string; concept: "tag" | "entity" | "citation" | "neutral" }
> = {
  idle: { label: "Idle", concept: "neutral" },
  queued: { label: "Queued", concept: "entity" },
  processing: { label: "Processing…", concept: "entity" },
  ready: { label: "Ready", concept: "tag" },
  error: { label: "Error", concept: "citation" },
};

export function BlobDetail({ doc }: { doc: Document }) {
  const href = blobUrl(doc.id);
  const status = STATUS_LABEL[doc.ingestStatus];
  const isPreviewable = doc.mimeType?.includes("pdf") || doc.mimeType?.startsWith("image/");

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
          <Link
            href={href}
            target="_blank"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
          >
            <Download className="h-3.5 w-3.5" /> Download
          </Link>
          <Link
            href={`/assistant?doc=${doc.id}`}
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
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
        {isPreviewable ? (
          doc.mimeType?.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={doc.title} className="max-h-[60vh] w-full object-contain" />
          ) : (
            <iframe title={doc.title} src={href} className="h-[60vh] w-full" />
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
