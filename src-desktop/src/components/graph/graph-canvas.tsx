import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useTheme } from "next-themes";
import * as React from "react";
import { graphColors } from "@/lib/tokens";
import type { NodeType, RelationType } from "@/lib/types";

/**
 * View-model for the graph screen — the desktop analogue of the web app's
 * GraphResponse (degree + counts are computed client-side from ipc.getGraph).
 */
export interface GraphViewData {
  nodes: {
    id: string;
    type: NodeType;
    label: string;
    documentId: string | null;
    degree: number;
  }[];
  edges: { id: string; source: string; target: string; relation: RelationType; origin: string }[];
  counts: { documents: number; tags: number; entities: number; edges: number };
}

let registered = false;
function ensureRegistered() {
  if (!registered) {
    cytoscape.use(fcose);
    registered = true;
  }
}

export interface GraphCanvasHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
}

export const GraphCanvas = React.forwardRef<
  GraphCanvasHandle,
  {
    data: GraphViewData;
    selectedId: string | null;
    showEdges: boolean;
    onSelectNode: (id: string | null) => void;
  }
>(function GraphCanvas({ data, selectedId, showEdges, onSelectNode }, ref) {
  const { resolvedTheme } = useTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cyRef = React.useRef<Core | null>(null);

  React.useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
    },
    fit: () => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 250 });
    },
  }));

  // Build / rebuild the instance when the data or theme changes.
  React.useEffect(() => {
    ensureRegistered();
    if (!containerRef.current) return;
    const colors = graphColors(resolvedTheme === "light" ? "light" : "dark");

    const elements: ElementDefinition[] = [
      ...data.nodes.map((n) => ({
        data: { id: n.id, label: n.label, type: n.type, degree: n.degree, documentId: n.documentId },
      })),
      ...data.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, relation: e.relation },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (el: cytoscape.NodeSingular) =>
              colors[el.data("type") as keyof typeof colors] ?? colors.doc,
            width: "mapData(degree, 0, 12, 18, 48)",
            height: "mapData(degree, 0, 12, 18, 48)",
            label: "data(label)",
            color: resolvedTheme === "light" ? "#1b1e23" : "#e7e8ea",
            "font-size": 9,
            "font-family": "var(--font-sans)",
            "text-margin-y": 6,
            "text-valign": "bottom",
            "min-zoomed-font-size": 8,
            "text-max-width": "120px",
            "overlay-opacity": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            // --faint per theme: readable against the canvas, unlike the
            // border grays (which are designed to be barely visible).
            "line-color": resolvedTheme === "light" ? "#8a909a" : "#6e747e",
            "curve-style": "bezier",
            opacity: showEdges ? 0.55 : 0,
          },
        },
        { selector: ".faded", style: { opacity: 0.12 } },
        {
          selector: "node.focused",
          style: { "border-width": 3, "border-color": colors.doc },
        },
        { selector: "edge.incident", style: { "line-color": colors.link, opacity: 0.9, width: 1.5 } },
      ],
      layout: { name: "fcose", animate: false, randomize: true, padding: 40, nodeSeparation: 80 } as cytoscape.LayoutOptions,
    });

    cy.on("tap", "node", (evt) => onSelectNode(evt.target.id()));
    cy.on("tap", (evt) => {
      if (evt.target === cy) onSelectNode(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, resolvedTheme, showEdges, onSelectNode]);

  // Focus highlight when selection changes.
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("faded focused incident");
      if (selectedId) {
        const node = cy.getElementById(selectedId);
        if (node.nonempty()) {
          const neighborhood = node.closedNeighborhood();
          cy.elements().not(neighborhood).addClass("faded");
          node.addClass("focused");
          node.connectedEdges().addClass("incident");
        }
      }
    });
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
});
