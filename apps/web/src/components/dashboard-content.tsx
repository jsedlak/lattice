"use client";

import type { Document } from "@lattice/db";
import { Badge, Card, cn } from "@lattice/ui";
import { parseLinks } from "@lattice/graph/parse";
import { FileText, MessageSquare, PenLine, Search, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { fileTypeLabel, relativeTime } from "@/lib/format";

const ENTRY_CARDS = [
  {
    href: "/editor",
    icon: PenLine,
    title: "Open editor",
    body: "Write markdown with live preview, tags and wiki-links.",
  },
  {
    href: "/graph",
    icon: Share2,
    title: "Explore graph",
    body: "See how notes, tags and entities connect.",
  },
  {
    href: "/assistant",
    icon: MessageSquare,
    title: "Ask the assistant",
    body: "Get answers grounded in your own notes, with citations.",
  },
];

export function DashboardContent({ name, documents }: { name: string; documents: Document[] }) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q),
    );
  }, [documents, query]);

  const greeting = greetingFor();

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className=" text-muted">
            {greeting}, {name.split(" ")[0]}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your workspace</h1>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes & documents"
            className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3  focus-visible:border-accent focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Entry cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ENTRY_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.href} href={c.href}>
              <Card className="h-full p-5 hover:border-border-strong hover:bg-surface-raised">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold">{c.title}</h3>
                <p className="mt-1  text-muted">{c.body}</p>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Documents */}
      <div className="mt-10 flex items-baseline justify-between">
        <h2 className=" font-semibold">
          All documents <span className="ml-1 text-faint">{filtered.length}</span>
        </h2>
        <span className=" text-faint">Sorted by last edited</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyDocuments hasQuery={query.length > 0} />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentCard({ doc }: { doc: Document }) {
  const tags = doc.kind === "note" ? parseLinks(doc.content).tags.slice(0, 3) : [];
  const snippet = doc.content
    .replace(/[#*`>[\]]/g, "")
    .slice(0, 120)
    .trim();

  return (
    <Link href={`/editor?doc=${doc.id}`}>
      <Card className="flex h-full gap-3 p-4 hover:border-border-strong hover:bg-surface-raised">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-raised text-faint">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{doc.title}</h3>
            <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-faint">
              {fileTypeLabel(doc.mimeType, doc.kind)}
            </span>
          </div>
          {snippet && <p className="mt-1 line-clamp-2  text-muted">{snippet}</p>}
          <div className="mt-2 flex items-center gap-1.5">
            {tags.map((t) => (
              <Badge key={t} concept="tag">
                #{t}
              </Badge>
            ))}
            <span className={cn("ml-auto  text-faint", tags.length === 0 && "ml-0")}>
              {relativeTime(doc.updatedAt)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function EmptyDocuments({ hasQuery }: { hasQuery: boolean }) {
  return (
    <Card className="mt-4 flex flex-col items-center justify-center gap-2 border-dashed py-16 text-center">
      <FileText className="h-8 w-8 text-faint" />
      <p className=" font-medium">{hasQuery ? "No matches" : "No documents yet"}</p>
      <p className="max-w-xs  text-muted">
        {hasQuery
          ? "Try a different search."
          : "Create a note or upload a document to start building your graph."}
      </p>
    </Card>
  );
}

function greetingFor(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
