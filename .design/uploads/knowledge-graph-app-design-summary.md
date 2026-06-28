# Knowledge Graph App — Design Summary

A brief for designing the UI of a cloud markdown authoring tool that builds a queryable knowledge graph and exposes it to an AI chat assistant. This document is the design hand-off: what the app does, what screens it needs, and how it should look and feel. It is not an engineering spec.

## What This Is

A single-user "second brain." Users write markdown notes, upload documents, and the app weaves both into a knowledge graph. They can then chat with an AI assistant that answers using that graph as its source of truth. Think of it as the overlap of a note editor, a document library, a graph view, and a chat panel.

## Who It's For

Knowledge workers building a personal or team knowledge base — people comfortable with markdown, tags, and wiki-style linking. The aesthetic should respect that: capable and dense where it needs to be, not dumbed-down, but never cluttered. Calm, focused, trustworthy. This is a tool people live in for hours, so it must be comfortable for long sessions and easy on the eyes.

---

## Core Features & Functionality

### 1. Authentication
- Sign up / sign in with email + password.
- Sign in with GitHub (OAuth).
- Everything is per-user and private. The product promise is data isolation — the design should quietly reinforce that (e.g., user identity always visible, clear "your workspace" framing).

### 2. Markdown Editor with Live Preview
- Split-pane: editor on the left, rendered preview on the right.
- Syntax highlighting in the editor; properly rendered markdown (headings, lists, tables, code blocks, links) in the preview.
- Autosave with a subtle, non-nagging save indicator.
- Support for `#tags` and `[[wiki-links]]` as first-class concepts — these should be visually distinct in both editor and preview, since they drive the graph.

### 3. Document Library
- A list/grid of the user's notes and uploaded documents.
- Upload flow for source files (PDF, Word docs, etc.) that get ingested into the graph.
- Each item shows title, type (authored note vs. uploaded doc), and last-modified.
- Search/filter across the collection.

### 4. Knowledge Graph View
- A visual graph: nodes (documents, entities, tags) connected by edges (links, shared tags, extracted relationships).
- Click a node to focus it and see its neighbors; click through to the underlying document.
- Should feel explorable and alive, but remain legible — graphs get hairy fast, so design for filtering, focus/zoom, and sensible default layouts rather than showing everything at once.

### 5. AI Chat Assistant
- A chat panel where the user asks questions and the assistant answers using the knowledge graph.
- Streaming responses (text appears as it generates).
- Responses should be able to **cite their sources** — link back to the documents/nodes the answer drew from. This is core to trust; design citations as a prominent, clickable affordance, not an afterthought.
- Conversation history per session.

---

## Primary Screens

| Screen | Purpose |
|---|---|
| **Auth** | Sign up / sign in (email + GitHub). Minimal, welcoming. |
| **Workspace / Dashboard** | Landing after login. Document library + entry points to editor, graph, chat. |
| **Editor** | Split-pane markdown authoring with live preview. The screen users spend the most time in. |
| **Graph View** | Interactive visualization of the knowledge graph. |
| **Chat** | AI assistant conversation with source citations. |

The editor, graph, and chat may share a persistent shell (sidebar nav + workspace context) rather than being fully separate destinations. Consider whether chat lives as a dockable/collapsible panel available alongside the editor, since asking the assistant about what you're writing is a natural flow.

---

## Layout & Navigation

- **Persistent left sidebar:** workspace identity, document list/tree, navigation between Editor / Graph / Chat, user menu.
- **Main content area:** the active view (editor, graph, or chat).
- **Optional right panel:** chat or contextual info, collapsible.
- Responsive down to tablet; the split-pane editor gracefully stacks or toggles on narrow screens. Phone is read/chat-first, not authoring-first.

---

## General Design Requirements

### Aesthetic Direction
- **Calm, focused, modern, trustworthy.** Developer-tool adjacent without being cold or sterile.
- Generous whitespace in chrome; high information density allowed inside the editor and library where it earns its keep.
- Avoid hype, gloss, gradients-for-the-sake-of-it. This is a serious tool for thinking, not a flashy consumer app. Restraint signals competence.

### Theming
- **Dark mode is the priority / default**, given the audience and long working sessions. Provide light mode too.
- Both themes must be fully considered — not a dark theme with a bolted-on light afterthought.

### Typography
- Clean, readable UI sans-serif.
- A genuine **monospace** for the editor, code blocks, and any code-like content (tags, links). The editor's type treatment matters a lot — this is where users stare.
- Comfortable line height and measure in the preview pane for long-form reading.

### Color
- Restrained base palette (neutrals carrying most of the UI) with a confident single accent for primary actions, active states, and links.
- Reserve distinct, consistent colors for graph-meaningful concepts: tags, wiki-links, entity types, and citation references. These should read the same everywhere they appear (editor, preview, graph, chat).

### Components Needed
- Split-pane with draggable divider.
- Code/markdown editor surface (syntax-highlighted).
- Rendered markdown preview.
- Graph canvas (nodes + edges, zoom/pan, focus state).
- Chat interface (message bubbles, streaming state, citation chips/links).
- Document list/grid cards.
- Upload control with progress + states.
- Auth forms.
- Sidebar nav + user menu.
- Save/sync status indicator.
- Empty states for every primary surface (no docs yet, empty graph, no chat history) — these set first impressions, so design them deliberately.

### Interaction & Feel
- Fast and responsive; optimistic UI where possible (autosave, instant preview).
- Subtle, purposeful motion — graph transitions, streaming text, panel collapse. Nothing gratuitous.
- Clear loading, empty, and error states throughout.
- Keyboard-friendly: shortcuts for save, new note, toggle preview, open chat. Power users expect this.

### Accessibility
- WCAG AA contrast in both themes.
- Full keyboard navigation.
- Sensible focus states and ARIA for the custom surfaces (editor, graph, chat).

---

## Design Priorities (in order)

1. **The editor.** It's where users spend their time. Authoring markdown here should feel better than in a generic text box — that's the bar.
2. **The chat with citations.** The payoff of the whole product. Answers must feel trustworthy and traceable.
3. **The graph view.** The "wow," but secondary to daily authoring and querying. Make it legible before making it impressive.
4. **Library + auth.** Solid, unremarkable, out of the way.

## Out of Scope for Design (engineering concerns, noted for context)

The graph is built from tag/wiki-link parsing plus AI entity extraction; documents are stored privately per user; the AI assistant queries the graph via tools rather than reading everything at once. None of this needs UI beyond what's above — but it explains *why* tags, links, citations, and per-user privacy deserve visual weight.
