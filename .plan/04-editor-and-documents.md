# Phase 04 — Editor & Documents

The screen users live in. Split-pane markdown editor with live preview, autosave, first-class `#tags` / `[[wiki-links]]`, and full per-user document CRUD — plus the dashboard content from the mockup.

This is **design priority #1**. Authoring here must feel better than a generic text box.

## Deliverables

1. Document CRUD route handlers (session-checked, `userId`-scoped).
2. Dashboard content: "Your workspace" cards + searchable document grid.
3. Editor surface (CodeMirror 6) with markdown highlighting + tag/wiki-link decorations.
4. Live preview (react-markdown) with matching tag/link styling and a word count.
5. Debounced autosave with the subtle "Saved" indicator from the mockup.
6. Documents tab (the tree/list) within the editor view.
7. Keyboard shortcuts: save, new note, toggle preview.

## Route handlers

`app/api/documents/route.ts` — `GET` (list, user-scoped), `POST` (create note).
`app/api/documents/[id]/route.ts` — `GET`, `PATCH` (autosave content/title), `DELETE`.

Every handler:
```ts
const user = await requireUser();
if (!user) return new Response("Unauthorized", { status: 401 });
// queries always: where(and(eq(document.userId, user.id), eq(document.id, id)))
```

PATCH updates `content`/`title` + `updatedAt`. On save of a **note**, fire the graph-extraction trigger (deterministic parse inline + enqueue LLM extraction) — implemented in `07`; leave a typed hook here (`onDocumentSaved(userId, docId)`).

## Dashboard (`app/(app)/page.tsx`)

Matches `dashboard.png`:
- Greeting ("Good evening, {name}") + "Your workspace" heading.
- Search box across notes & documents (client filter over fetched list to start; server search later).
- Three entry cards: **Open editor**, **Explore graph**, **Ask the assistant**.
- "All documents" grid — cards show title, `NOTE`/`PDF`-style type chip, snippet, tag chips, relative last-edited. Sorted by last edited.
- Empty state when no documents (deliberate first impression — see `10`).

## Editor view (`app/(app)/editor/...`)

Layout from `editor-docs.png`:
- A middle **Documents/Blobs tab** column (Documents here; Blobs in `05`): a collapsible tree grouped by folder, "New note" button, active doc highlighted, recent docs.
- A **split pane** (draggable divider) — `MARKDOWN` editor left, `PREVIEW` right — with a header showing title, save status (`● Saved`), word count, a `Preview` toggle, and an `Ask assistant` button (wires to `09`).

### Editor (CodeMirror 6)
- `@codemirror/lang-markdown`, IBM Plex Mono, line height tuned for long sessions.
- **Decorations** for `#tag` (green) and `[[wiki-link]]` (purple) — distinct from normal text in both weight and color, matching the graph taxonomy. A small ViewPlugin scans visible ranges with regex and applies marks.
- Theme bound to the app's dark/light tokens.

### Preview (react-markdown)
- `remark-gfm` (tables, task lists), `rehype-highlight` or Shiki for fences.
- Custom renderers so `#tag` and `[[wiki-link]]` render as the same colored chips/links as the editor. Wiki-links resolve to the target document when it exists (click → open), and render as "create" affordance when it doesn't.
- Comfortable measure + line height for reading.

### Autosave
- Debounce (~600ms) → `PATCH /api/documents/[id]`. Optimistic "Saving…" → "Saved" indicator. Reconcile `updatedAt`. Never block typing on the network.

### Shortcuts
- ⌘/Ctrl-S explicit save (also flushes debounce), ⌘/Ctrl-N new note, ⌘/Ctrl-P toggle preview. Registered in a shell-level keymap so they also work from the dashboard where sensible.

## Tags & wiki-links — shared parsing

Put the regex + parse logic in `@lattice/graph` (`parseLinks(markdown) -> { tags[], wikiLinks[] }`) so the editor decorations, the preview renderers, and the deterministic graph builder in `07` all agree on what a tag/link is. Single source of truth.

## Done when

- Create, rename, edit, delete notes — all user-scoped; another user can never read them.
- Typing autosaves with a calm, correct "Saved" indicator; reload preserves content.
- `#tags` and `[[wiki-links]]` are visually distinct in both editor and preview, in the taxonomy colors.
- Clicking a wiki-link to an existing note navigates to it.
- Dashboard lists/searches the user's documents; empty state shows for new accounts.
- Shortcuts work.

## Notes

- Keep markdown for notes in Postgres (`document.content`) for fast edit/preview; uploaded files differ (`05`).
- Don't build graph extraction here — just emit the `onDocumentSaved` hook so `07` can subscribe without refactoring.
- Folders in the tree can be a lightweight client grouping (by a `path`/`folder` field) — add a nullable `folder` column to `document` if you want server-side grouping; otherwise infer. Decide during build, keep it simple.
