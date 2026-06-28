# Phase 10 — Polish & Launch

Cross-cutting quality pass that makes Lattice feel like a tool people live in for hours: empty/loading/error states, accessibility, keyboard shortcuts, responsiveness, motion, and launch hardening. Much of this is built incrementally in earlier phases — this phase is the audit that closes the gaps.

## Deliverables

1. Deliberate **empty states** for every primary surface.
2. Consistent **loading + error** states (skeletons, retries, toasts).
3. **Accessibility** pass — WCAG AA, keyboard nav, focus/ARIA for custom surfaces.
4. **Keyboard shortcuts** consolidated + discoverable.
5. **Responsive** behavior down to tablet; phone read/chat-first.
6. **Motion** pass — purposeful, subtle.
7. **Launch hardening** — security checklist, observability, rate limits, backups.

## Empty states (set first impressions — design deliberately)

- **Dashboard:** no documents → welcoming "Create your first note" + "Upload a document" with the entry cards still present.
- **Editor:** no doc selected → calm placeholder with shortcut hints.
- **Graph:** no nodes → "Your graph grows as you write and link notes" with a sample illustration.
- **Assistant:** no history → suggested prompts grounded in the user's real docs (or onboarding prompts if none).
- **Blobs:** no uploads → drag-and-drop prompt.

## Loading & error states

- Skeletons for the document list, graph canvas, and chat history.
- Ingestion: clear `queued → processing → ready/error` with a retry on error (re-send the Inngest event).
- Network/save failures: non-destructive toasts; autosave keeps a local buffer so nothing is lost on a failed PATCH.
- Route handlers return structured errors; the client renders them, never a raw 500.

## Accessibility (WCAG AA, both themes)

- Verify contrast for every token pair in dark *and* light (the brief insists both are first-class).
- Full keyboard navigation; visible focus rings on all interactive elements.
- ARIA for the custom surfaces: the editor, the graph canvas (provide a non-visual fallback / node list), the chat stream (announce streaming completion).
- Respect `prefers-reduced-motion`.

## Keyboard shortcuts

Consolidate and document (with a `?` cheat-sheet overlay):
- ⌘/Ctrl-S save · ⌘/Ctrl-N new note · ⌘/Ctrl-P toggle preview · ⌘/Ctrl-K command palette / search · ⌘/Ctrl-J open assistant · ⌘/Ctrl-G graph.

## Responsive

- **Desktop:** full three-region shell.
- **Tablet:** sidebar collapses to icons; editor split-pane toggles between editor/preview instead of side-by-side.
- **Phone:** read + chat first; authoring is degraded-but-usable, not the focus (per the brief).

## Motion

- Graph focus transitions, streaming text, panel collapse, save indicator — subtle and purposeful. Nothing gratuitous. All gated by `prefers-reduced-motion`.

## Launch hardening

- **Security checklist** (from `00-overview.md`) fully audited: session re-checks, `userId` scoping on every query, private blobs + path authorization, server-only secrets, OAuth callbacks per env, Inngest payload re-scoping.
- **Rate limiting** on chat + upload + auth endpoints (e.g. Upstash Ratelimit) to bound cost/abuse.
- **Observability:** Vercel Analytics + logging; Inngest dashboard for job failures; error tracking (Sentry) wired in web + ingest.
- **Cost guards:** sensible caps on embedding/extraction per doc; chat `maxSteps`/`k` caps; alert on spend.
- **Data:** Neon point-in-time recovery / branching for backups; document the restore path.
- **Docs:** a short `README` per package + a run-book for provisioning a fresh environment.

## Done when

- Every primary surface has an intentional empty, loading, and error state.
- AA contrast verified in both themes; keyboard-only operation of editor, graph, and chat is possible.
- The app is usable on tablet; phone supports reading + chat.
- The full security checklist passes an audit.
- Rate limits, error tracking, and job-failure visibility are live.
- A fresh environment can be stood up from the run-book end to end.

## Post-MVP backlog (explicitly out of scope, parked here)

- Team workspaces / sharing + per-resource ACLs.
- Entity "merge candidates" review UI for borderline resolution cases.
- OCR for image uploads; richer file-type previews.
- Graph: saved views, time-based filtering, clustering, web-worker layouts at scale.
- Incremental re-embedding via content hashing; embedding cache.
- Public share links for individual notes (with care, given the privacy promise).
