import { getDocument, getDocumentByTitle, listDocuments, listFolders } from "@lattice/db";
import { PenLine } from "lucide-react";
import type { Metadata } from "next";
import { BlobDetail } from "@/components/editor/blob-detail";
import { CreateNotePrompt } from "@/components/editor/create-note-prompt";
import { DocumentTabs } from "@/components/editor/document-tabs";
import { EditorPane } from "@/components/editor/editor-pane";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; title?: string; tab?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [documents, folders] = await Promise.all([listDocuments(user.id), listFolders(user.id)]);

  let selected = null;
  let createTitle: string | undefined;
  if (sp.doc) {
    selected = await getDocument(user.id, sp.doc);
  } else if (sp.title) {
    selected = await getDocumentByTitle(user.id, sp.title);
    if (!selected) createTitle = sp.title;
  } else {
    selected = documents.find((d) => d.kind === "note") ?? null;
  }

  const tab: "documents" | "blobs" =
    sp.tab === "blobs" || selected?.kind === "upload" ? "blobs" : "documents";

  return (
    <div className="flex h-full">
      <DocumentTabs
        documents={documents}
        folders={folders}
        selectedId={selected?.id ?? null}
        tab={tab}
      />
      <div className="min-w-0 flex-1">
        {selected ? (
          selected.kind === "upload" ? (
            <BlobDetail key={selected.id} doc={selected} />
          ) : (
            <EditorPane key={selected.id} doc={selected} />
          )
        ) : createTitle ? (
          <CreateNotePrompt title={createTitle} />
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
