import { FileText, FolderPlus, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  Badge,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Spinner,
  useConfirm,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { createFolder, createNote, deleteDocument } from "@/lib/ipc";
import type { Doc, Folder, IngestStatus } from "@/lib/types";

import { DocumentTree, type RenameRequest } from "./DocumentTree";
import { UploadButton } from "./UploadButton";

export type EditorTab = "documents" | "uploads";

export function DocumentTabs({
  documents,
  folders,
  selectedId,
  tab,
  onRefresh,
}: {
  documents: Doc[];
  folders: Folder[];
  selectedId: string | null;
  tab: EditorTab;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  // New items get named inline in the tree: create → focus a rename input.
  const [renameRequest, setRenameRequest] = React.useState<RenameRequest | null>(null);
  const onRenameRequestHandled = React.useCallback(() => setRenameRequest(null), []);

  const notes = documents.filter((d) => d.kind === "note");
  const uploads = documents.filter((d) => d.kind === "upload");

  async function onNewNote() {
    setCreating(true);
    try {
      const document = await createNote("Untitled note");
      navigate(`/editor/${document.id}`);
      setRenameRequest({ kind: "doc", id: document.id });
      onRefresh();
    } finally {
      setCreating(false);
    }
  }

  async function onNewFolder() {
    const folder = await createFolder("New folder", null);
    setRenameRequest({ kind: "folder", id: folder.id });
    onRefresh();
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
      {/* Tabs — h-12 matches the document header so the bottom borders align. */}
      <div className="flex h-12 shrink-0 border-b border-border">
        <TabLink active={tab === "documents"} to="/editor?tab=documents" label="Documents" />
        <TabLink active={tab === "uploads"} to="/editor?tab=uploads" label="Uploads" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "documents" ? (
          <DocumentTree
            documents={notes}
            folders={folders}
            selectedId={selectedId}
            renameRequest={renameRequest}
            onRenameRequestHandled={onRenameRequestHandled}
            onRefresh={onRefresh}
          />
        ) : (
          <>
            {uploads.map((d) => (
              <UploadRow key={d.id} doc={d} active={d.id === selectedId} onRefresh={onRefresh} />
            ))}
            {uploads.length === 0 && <p className="px-2 py-3  text-faint">No uploads yet.</p>}
          </>
        )}
      </div>

      {/* Footer — h-[52px] matches the main sidebar's footer so the top borders align. */}
      <div className="flex h-[52px] shrink-0 items-center border-t border-border px-2">
        {tab === "documents" ? (
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={onNewNote}
              disabled={creating}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-1.5  text-muted hover:bg-surface-raised hover:text-foreground"
            >
              {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              New note
            </button>
            <button
              type="button"
              onClick={onNewFolder}
              aria-label="New folder"
              title="New folder"
              className="flex items-center justify-center rounded-md border border-dashed border-border-strong px-3 text-muted hover:bg-surface-raised hover:text-foreground"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <UploadButton className="w-full" onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

function TabLink({ active, to, label }: { active: boolean; to: string; label: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-1 items-center justify-center border-b-2 px-3 transition-colors",
        active
          ? "border-accent font-medium text-foreground bg-surface-raised"
          : "border-transparent text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

/** Row badge for in-flight / failed ingestion (ready is the quiet default). */
const ROW_STATUS: Partial<
  Record<IngestStatus, { label: string; concept: "entity" | "citation" }>
> = {
  queued: { label: "Queued", concept: "entity" },
  processing: { label: "Processing…", concept: "entity" },
  error: { label: "Error", concept: "citation" },
};

function UploadRow({
  doc,
  active,
  onRefresh,
}: {
  doc: Doc;
  active: boolean;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const status = ROW_STATUS[doc.ingestStatus];

  async function onDelete() {
    const ok = await confirm({
      title: "Delete file?",
      description: `"${doc.title}" and its extracted graph data will be permanently deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteDocument(doc.id);
    if (active) navigate("/editor?tab=uploads");
    onRefresh();
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={`/editor/${doc.id}?tab=uploads`}
          className={cn(
            "flex items-center gap-2 truncate rounded-md px-2 py-2 ",
            active
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-surface-raised hover:text-foreground",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="truncate">{doc.title}</span>
          {status && (
            <Badge concept={status.concept} className="ml-auto shrink-0">
              {status.label}
            </Badge>
          )}
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
