"use client";

import { Spinner, buttonVariants, cn } from "@lattice/ui";
import { Minus, Plus, RotateCcw, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { type GraphResponse, fetchGraph } from "@/lib/client-api";
import { GraphCanvas, type GraphCanvasHandle } from "./graph-canvas";

type NodeType = "document" | "tag" | "entity";
const ALL_TYPES: NodeType[] = ["document", "tag", "entity"];

const LEGEND: { key: NodeType; label: string; color: string }[] = [
  { key: "document", label: "Documents", color: "var(--graph-doc)" },
  { key: "tag", label: "Tags", color: "var(--graph-tag)" },
  { key: "entity", label: "Entities", color: "var(--graph-entity)" },
];

export function GraphView() {
  const [data, setData] = React.useState<GraphResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [activeTypes, setActiveTypes] = React.useState<Set<NodeType>>(new Set(ALL_TYPES));
  const [showEdges, setShowEdges] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const canvasRef = React.useRef<GraphCanvasHandle>(null);

  const typesKey = [...activeTypes].sort().join(",");
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGraph({ types: typesKey ? typesKey.split(",") : ["__none__"] })
      .then((res) => {
        if (active) {
          setData(res);
          setSelectedId(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [typesKey]);

  function toggleType(t: NodeType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const selected = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const neighbors = React.useMemo(() => {
    if (!data || !selectedId) return [];
    const seen = new Map<
      string,
      { id: string; label: string; type: string; documentId: string | null }
    >();
    for (const e of data.edges) {
      const otherId =
        e.source === selectedId ? e.target : e.target === selectedId ? e.source : null;
      if (!otherId) continue;
      const n = data.nodes.find((x) => x.id === otherId);
      if (n && !seen.has(n.id)) seen.set(n.id, n);
    }
    return [...seen.values()];
  }, [data, selectedId]);

  const counts = data?.counts;
  const isEmpty = !loading && data && data.nodes.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div>
          <h1 className="text-base font-semibold">Knowledge graph</h1>
          {counts && (
            <p className=" text-faint">
              {counts.documents} documents · {counts.tags + counts.entities} concepts ·{" "}
              {counts.edges} edges
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {LEGEND.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => toggleType(l.key)}
              className={cn(
                "flex items-center gap-1.5 ",
                activeTypes.has(l.key) ? "text-foreground" : "text-faint line-through",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              {l.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowEdges((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 ",
              showEdges ? "text-foreground" : "text-faint line-through",
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: "var(--graph-link)" }}
            />
            Links
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {isEmpty ? (
          <EmptyGraph />
        ) : data ? (
          <GraphCanvas
            ref={canvasRef}
            data={data}
            selectedId={selectedId}
            showEdges={showEdges}
            onSelectNode={setSelectedId}
          />
        ) : null}

        {/* Controls */}
        {!isEmpty && (
          <div className="absolute bottom-4 left-4 flex flex-col gap-1.5">
            <CtrlBtn label="Zoom in" onClick={() => canvasRef.current?.zoomBy(1.3)}>
              <Plus className="h-4 w-4" />
            </CtrlBtn>
            <CtrlBtn label="Zoom out" onClick={() => canvasRef.current?.zoomBy(1 / 1.3)}>
              <Minus className="h-4 w-4" />
            </CtrlBtn>
            <CtrlBtn label="Reset view" onClick={() => canvasRef.current?.fit()}>
              <RotateCcw className="h-4 w-4" />
            </CtrlBtn>
          </div>
        )}

        {/* Hint */}
        {!isEmpty && !selected && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface/80 px-3 py-1.5  text-faint backdrop-blur">
            Drag to pan · scroll-zoom · click a node to focus
          </div>
        )}

        {/* Detail card */}
        {selected && (
          <div className="absolute right-4 top-4 w-72 rounded-lg border border-border bg-surface p-4 shadow-lg animate-slide-up">
            <div className="flex items-center gap-2  font-medium uppercase tracking-wide text-faint">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: `var(--graph-${selected.type === "document" ? "doc" : selected.type})`,
                }}
              />
              {selected.type}
            </div>
            <h3 className="mt-1 font-semibold">{selected.label}</h3>
            <div className="mt-3  font-medium uppercase tracking-wide text-faint">
              Connected · {neighbors.length}
            </div>
            <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
              {neighbors.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className="flex w-full items-center gap-2 truncate rounded px-1.5 py-1 text-left  text-muted hover:bg-surface-raised hover:text-foreground"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: `var(--graph-${n.type === "document" ? "doc" : n.type})`,
                    }}
                  />
                  <span className="truncate">{n.label}</span>
                </button>
              ))}
            </div>
            {selected.type === "document" && selected.documentId && (
              <Link
                href={`/editor?doc=${selected.documentId}`}
                className={cn(buttonVariants({ size: "sm", variant: "subtle" }), "mt-3 w-full")}
              >
                Open document →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CtrlBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted hover:bg-surface-raised hover:text-foreground"
    >
      {children}
    </button>
  );
}

function EmptyGraph() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Share2 className="h-8 w-8 text-faint" />
      <p className=" font-medium">Your graph is empty</p>
      <p className="max-w-xs  text-muted">
        It grows as you write notes, add #tags and [[wiki-links]], and upload documents.
      </p>
    </div>
  );
}
