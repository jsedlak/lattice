import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bot, FilePlus2, FileText, Upload, Waypoints } from "lucide-react";

import { Badge, Button, Card, CardContent, Spinner } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import * as ipc from "@/lib/ipc";
import type { Doc } from "@/lib/types";

export function DashboardScreen() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Doc[] | null>(null);

  useEffect(() => {
    void ipc.listDocuments().then(setDocs);
  }, []);

  const createNote = async () => {
    const doc = await ipc.createNote("Untitled note");
    navigate(`/editor/${doc.id}`);
  };

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}.</h1>
        <p className="mt-1 text-sm text-muted">
          Your knowledge graph, on your machine.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <button
            onClick={() => void createNote()}
            className="group rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-raised"
          >
            <FilePlus2 className="h-5 w-5 text-accent" strokeWidth={1.75} />
            <div className="mt-2 text-sm font-medium">New note</div>
            <div className="mt-0.5 text-xs text-muted">Markdown, #tags, [[links]]</div>
          </button>
          <Link
            to="/graph"
            className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-raised"
          >
            <Waypoints className="h-5 w-5 text-graph-link" strokeWidth={1.75} />
            <div className="mt-2 text-sm font-medium">Explore graph</div>
            <div className="mt-0.5 text-xs text-muted">Documents, tags, entities</div>
          </Link>
          <Link
            to="/assistant"
            className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-raised"
          >
            <Bot className="h-5 w-5 text-graph-tag" strokeWidth={1.75} />
            <div className="mt-2 text-sm font-medium">Ask your notes</div>
            <div className="mt-0.5 text-xs text-muted">Cited answers from your graph</div>
          </Link>
        </div>

        <div className="mt-10 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">Recent documents</h2>
          <Button variant="outline" size="sm" onClick={() => navigate("/editor?tab=uploads")}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Uploads
          </Button>
        </div>

        {docs === null ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : docs.length === 0 ? (
          <Card className="mt-3">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <FileText className="h-8 w-8 text-faint" strokeWidth={1.5} />
              <p className="mt-3 text-sm text-muted">
                Nothing here yet. Write a note or import a document — Lattice
                weaves both into your graph.
              </p>
              <Button className="mt-4" size="sm" onClick={() => void createNote()}>
                Create your first note
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {docs.slice(0, 10).map((doc) => (
              <Link
                key={doc.id}
                to={`/editor/${doc.id}`}
                className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-raised"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{doc.title}</div>
                  {doc.kind === "upload" && <Badge>upload</Badge>}
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted">
                  {doc.content.slice(0, 160) || "Empty"}
                </div>
                <div className="mt-2 text-[11px] text-faint">{relativeTime(doc.updatedAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
