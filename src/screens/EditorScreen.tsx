import { PenLine } from "lucide-react";
import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { CreateNotePrompt } from "@/components/editor/CreateNotePrompt";
import { DocumentTabs, type EditorTab } from "@/components/editor/DocumentTabs";
import { EditorPane } from "@/components/editor/EditorPane";
import { UploadDetail } from "@/components/editor/UploadDetail";
import { Spinner } from "@/components/ui";
import { findDocumentByTitle, getDocument, listDocuments, listFolders } from "@/lib/ipc";
import type { Doc, Folder } from "@/lib/types";

/**
 * The editor screen — desktop port of the web app's /editor page. The selected
 * document comes from the /editor/:id route param (the web app used ?doc=);
 * ?title= (wiki-link navigation) and ?tab= keep their web meanings.
 */
export function EditorScreen() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const titleParam = searchParams.get("title");
  const tabParam = searchParams.get("tab");

  const [documents, setDocuments] = React.useState<Doc[] | null>(null);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [selected, setSelected] = React.useState<Doc | null>(null);
  const [createTitle, setCreateTitle] = React.useState<string | null>(null);

  // The desktop analogue of the web app's router.refresh(): reload the data
  // that the server components used to fetch.
  const refresh = React.useCallback(async () => {
    const [docs, fs] = await Promise.all([listDocuments(), listFolders()]);
    setDocuments(docs);
    setFolders(fs);
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
      } else if (titleParam) {
        const doc = await findDocumentByTitle(titleParam);
        if (cancelled) return;
        setSelected(doc);
        setCreateTitle(doc ? null : titleParam);
      } else {
        setSelected(documents.find((d) => d.kind === "note") ?? null);
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
    <div className="flex h-full">
      <DocumentTabs
        documents={documents}
        folders={folders}
        selectedId={selected?.id ?? null}
        tab={tab}
        onRefresh={onRefresh}
      />
      <div className="h-full min-w-0 flex-1">
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
