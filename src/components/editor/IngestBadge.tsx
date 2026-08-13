import { Badge } from "@/components/ui";
import type { IngestStatus } from "@/lib/types";

/** Row badge for in-flight / failed ingestion (ready is the quiet default). */
const ROW_STATUS: Partial<
  Record<IngestStatus, { label: string; concept: "entity" | "citation" }>
> = {
  queued: { label: "Queued", concept: "entity" },
  processing: { label: "Processing…", concept: "entity" },
  error: { label: "Error", concept: "citation" },
};

/** Shared by the Uploads list and the document tree, so an upload reads the
 *  same in both places. Renders nothing once ingestion is idle or ready. */
export function IngestBadge({ status, className }: { status: IngestStatus; className?: string }) {
  const row = ROW_STATUS[status];
  if (!row) return null;
  return (
    <Badge concept={row.concept} className={className}>
      {row.label}
    </Badge>
  );
}
