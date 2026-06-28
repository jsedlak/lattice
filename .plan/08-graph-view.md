# Phase 08 — Graph View

The interactive knowledge graph: Cytoscape.js canvas with the color-coded taxonomy, focus/neighbor inspection, filtering, and click-through to documents. Design priority #3 — make it **legible before impressive**. Graphs get hairy fast; design for filtering and focus, not "show everything."

## Why Cytoscape.js
Mature, performant for thousands of nodes, rich layout ecosystem (fcose/cola for force-directed), good event model for focus/hover, pan/zoom built in. Fits the mockup's force-directed look. (Alternatives like Sigma.js or react-force-graph are viable; Cytoscape was the stated default and is the right call here.)

## Deliverables

1. Graph data endpoint (user-scoped nodes + edges, with filters).
2. Cytoscape canvas component with the taxonomy styling + force layout.
3. Top bar: counts + legend/filter toggles (Documents / Tags / Entities / Links).
4. Focus interaction: click a node → highlight neighbors, show the detail card.
5. Node detail card with "Connected · N" list + **Open document →**.
6. Zoom/pan controls + reset; "Drag to pan · scroll-zoom · click a node to focus" hint.
7. Empty state for a graph with no nodes yet.

## Data endpoint

`app/api/graph/route.ts` — `GET ?types=document,tag,entity&origin=...`
```ts
const user = await requireUser();
if (!user) return new Response("Unauthorized", { status: 401 });
// nodes: where(eq(node.userId, user.id)) [+ type filter]
// edges: where(eq(edge.userId, user.id)) [+ origin filter], both endpoints in the node set
return Response.json({ nodes, edges, counts });
```
For large graphs, cap initial payload (e.g. top-N by degree) and expand on focus — but the MVP scale (one user's notes) is usually fine to send whole. Note any cap in the UI rather than silently truncating.

## Canvas component

`app/(app)/graph/...` — client component wrapping Cytoscape:
- **Layout:** `fcose` (force-directed) for the organic look in `graph-labels.png`; deterministic seed so it doesn't reshuffle on every load.
- **Node style by `type`** (taxonomy from `00-overview.md`):
  - document → blue `#3a6df0`, tag → green `#1f9d68`, entity → orange `#b9701f`, (link relationships shown as edges; wiki-link edges tinted purple `#8b54c4`).
  - size by degree (more-connected = larger), matching the mockup's varied node sizes.
- **Labels:** show on hover/zoom-in; hide at far zoom to avoid clutter (the mockup's "labels" state).
- **Edges:** subtle by default; highlighted when incident to the focused node.
- Bind to app theme tokens (dark/light).

## Top bar
Matches `graph-focus.png`: title "Knowledge graph", counts (`7 documents · 8 concepts · 18 edges`), and a legend that doubles as **filter toggles** (click "Tags" to hide/show tag nodes). Filters re-query or client-filter the elements.

## Focus interaction
Click a node:
- Dim non-neighbors, highlight the node + its 1-hop neighborhood + connecting edges.
- Open the **detail card** (top-right, from `graph-focus.png`): type chip + label, "CONNECTED · N" list of neighbors (each clickable to refocus), and **Open document →** when the node is/links to a document.
- Click empty canvas → reset focus.

## Controls
Bottom-left `+ / − / reset` (fit) buttons; scroll-zoom; drag-pan. The instructional hint pill at bottom-center.

## Done when

- The graph renders the user's real nodes/edges with correct taxonomy colors and degree-based sizing.
- Legend toggles filter node types live.
- Clicking a node focuses it, shows neighbors, and "Open document →" navigates to the editor for that doc.
- Zoom/pan/reset work; labels declutter at distance.
- Empty state shows for a new account ("Your graph will grow as you write and upload").
- Performance is smooth at a few hundred nodes.

## Notes

- Deterministic vs LLM edges can be a filter (`origin`) — useful for trust ("show only links I made").
- Keep the layout computation off the main thread if it janks (Cytoscape supports web-worker layouts for fcose).
- The sidebar Graph badge count (from `07`) should match the counts shown here.
