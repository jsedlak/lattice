import { PenLine } from "lucide-react";
import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { CreateNotePrompt } from "@/components/editor/CreateNotePrompt";
import { DocumentTabs, type EditorTab } from "@/components/editor/DocumentTabs";
import { EditorPane } from "@/components/editor/EditorPane";
import { OpenTabs } from "@/components/editor/OpenTabs";
import { UploadDetail } from "@/components/editor/UploadDetail";
import { ResizeHandle, Spinner } from "@/components/ui";
import { findDocumentByTitle, getDocument, listDocuments, listFolders } from "@/lib/ipc";
import { layoutBootCache, loadLayoutPrefs, saveLayoutPrefs } from "@/lib/layout-prefs";
import { invalidateCompletionCaches } from "@/lib/completions";
import { closeTab, openTab, pruneTabs, useOpenTabIds } from "@/lib/open-tabs";
import type { Doc, Folder } from "@/lib/types";

/**
 * The editor screen — desktop port of the web app's /editor page. The selected
 * document comes from the /editor/:id route param (the web app used ?doc=);
 * ?title= (wiki-link navigation) and ?tab= keep their web meanings. That route
 * param is also the active editor tab — see lib/open-tabs.ts.
 */
export function EditorScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const openIds = useOpenTabIds();
  const [searchParams] = useSearchParams();
  const titleParam = searchParams.get("title");
  const tabParam = searchParams.get("tab");

  const [documents, setDocuments] = React.useState<Doc[] | null>(null);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [selected, setSelected] = React.useState<Doc | null>(null);
  const [createTitle, setCreateTitle] = React.useState<string | null>(null);
  const [treeWidth, setTreeWidth] = React.useState(() => layoutBootCache().treeWidth);
  const treeWidthRef = React.useRef(treeWidth);
  const rowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void loadLayoutPrefs().then((p) => {
      setTreeWidth(p.treeWidth);
      treeWidthRef.current = p.treeWidth;
    });
  }, []);

  // The desktop analogue of the web app's router.refresh(): reload the data
  // that the server components used to fetch.
  const refresh = React.useCallback(async () => {
    const [docs, fs] = await Promise.all([listDocuments(), listFolders()]);
    setDocuments(docs);
    setFolders(fs);
    // Every document mutation funnels through here, so it's the one place that
    // can keep completion (wiki-link titles, file paths) from going stale.
    invalidateCompletionCaches();
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve the selected document. Re-runs after every refresh() so the
  // selection tracks renames, deletions and ingest-status changes.
  React.useEffect(() => {
    if (documents === null) return;
    let cancelled = false;
    void (async () => {
      if (id) {
        const doc = await getDocument(id);
        if (cancelled) return;
        setSelected(doc);
        setCreateTitle(null);
        if (doc) openTab(doc.id);
      } else if (titleParam) {
        const doc = await findDocumentByTitle(titleParam);
        if (cancelled) return;
        setSelected(doc);
        setCreateTitle(doc ? null : titleParam);
        if (doc) openTab(doc.id);
      } else {
        // No document in the URL. With tabs, "nothing open" is a real state —
        // don't silently adopt the first note, or closing the last tab would
        // immediately reopen something.
        setSelected(null);
        setCreateTitle(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, titleParam, documents]);

  // While an upload is being ingested, poll so ingest-status badges update.
  React.useEffect(() => {
    const pending = documents?.some(
      (d) =>
        d.kind === "upload" && (d.ingestStatus === "queued" || d.ingestStatus === "processing"),
    );
    if (!pending) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [documents, refresh]);

  const onRefresh = React.useCallback(() => void refresh(), [refresh]);

  // Drop tabs whose document is gone — deleted here, or by a files-mode sync.
  React.useEffect(() => {
    if (documents === null) return;
    pruneTabs(new Set(documents.map((d) => d.id)));
  }, [documents]);

  // Tab labels come from the document list, so renames land after a refresh().
  const tabDocs = React.useMemo(() => {
    const byId = new Map((documents ?? []).map((d) => [d.id, d]));
    return openIds.map((tid) => byId.get(tid)).filter((d): d is Doc => Boolean(d));
  }, [documents, openIds]);

  const activeId = selected?.id ?? null;

  const onCloseTab = React.useCallback(
    (tabId: string) => {
      const next = closeTab(tabId);
      // Closing a background tab leaves the current document alone.
      if (tabId !== activeId) return;
      navigate(next ? `/editor/${next}` : "/editor");
    },
    [activeId, navigate],
  );

  const onActivateTab = React.useCallback(
    (tabId: string) => navigate(`/editor/${tabId}`),
    [navigate],
  );

  // Ctrl/Cmd+W closes the active tab. Capture phase so Monaco/CodeMirror can't
  // swallow it — and note the macOS menu is what actually owns this chord, so
  // src-tauri drops the default Close Window item for the webview to see it.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "w") return;
      e.preventDefault();
      e.stopPropagation();
      if (activeId) onCloseTab(activeId);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [activeId, onCloseTab]);

  if (documents === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const tab: EditorTab =
    tabParam === "uploads" || selected?.kind === "upload" ? "uploads" : "documents";

  return (
    <div ref={rowRef} className="flex h-full">
      <DocumentTabs
        documents={documents}
        folders={folders}
        selectedId={selected?.id ?? null}
        tab={tab}
        onRefresh={onRefresh}
        width={treeWidth}
      />
      <ResizeHandle
        label="Resize document list"
        onResize={(x) => {
          const left = rowRef.current?.getBoundingClientRect().left ?? 0;
          const w = Math.min(480, Math.max(200, x - left));
          treeWidthRef.current = w;
          setTreeWidth(w);
        }}
        onEnd={() => saveLayoutPrefs({ treeWidth: treeWidthRef.current })}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <OpenTabs
          tabs={tabDocs}
          activeId={activeId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
        />
        <div className="min-h-0 flex-1">
          {selected ? (
            selected.kind === "upload" ? (
              <UploadDetail key={selected.id} doc={selected} />
            ) : (
              <EditorPane key={selected.id} doc={selected} onRefresh={onRefresh} />
            )
          ) : createTitle ? (
            <CreateNotePrompt title={createTitle} onRefresh={onRefresh} />
          ) : (
            <EmptyEditor />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <PenLine className="h-8 w-8 text-faint" />
      <p className=" font-medium">Nothing open</p>
      <p className="max-w-xs  text-muted">
        Select a note from the list, or create a new one to start writing.
      </p>
    </div>
  );
}
