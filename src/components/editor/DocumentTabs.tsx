import { FolderPlus, Paperclip, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Spinner,
  useConfirm,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { folderPathLabel } from "@/lib/folder-context";
import { createFolder, createNote, deleteDocument } from "@/lib/ipc";
import type { Doc, Folder } from "@/lib/types";
import { describeImportErrors, importUploads } from "@/lib/uploads";
import { useFileDrop } from "@/lib/use-file-drop";

import { DocumentTree, type RenameRequest } from "./DocumentTree";
import { IngestBadge } from "./IngestBadge";
import { UploadButton } from "./UploadButton";

export type EditorTab = "documents" | "uploads";

export function DocumentTabs({
  documents,
  folders,
  selectedId,
  tab,
  onRefresh,
  width,
}: {
  documents: Doc[];
  folders: Folder[];
  selectedId: string | null;
  tab: EditorTab;
  onRefresh: () => void;
  width?: number;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  // New items get named inline in the tree: create → focus a rename input.
  const [renameRequest, setRenameRequest] = React.useState<RenameRequest | null>(null);
  const onRenameRequestHandled = React.useCallback(() => setRenameRequest(null), []);

  // The tree shows notes *and* uploads: an upload's folder is a logical
  // placement (its bytes live in files/<id>/ either way), so the tree row is
  // the link to it. Uploads tab still lists every upload, foldered or not.
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
    <div
      style={{ width: width ?? 288 }}
      className="flex h-full shrink-0 flex-col border-r border-border bg-surface"
    >
      {/* Tabs — h-12 matches the document header so the bottom borders align. */}
      <div className="flex h-12 shrink-0 border-b border-border">
        <TabLink active={tab === "documents"} to="/editor?tab=documents" label="Documents" />
        <TabLink active={tab === "uploads"} to="/editor?tab=uploads" label="Uploads" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "documents" ? (
          <DocumentTree
            documents={documents}
            folders={folders}
            selectedId={selectedId}
            renameRequest={renameRequest}
            onRenameRequestHandled={onRenameRequestHandled}
            onRefresh={onRefresh}
          />
        ) : (
          <UploadList
            uploads={uploads}
            folders={folders}
            selectedId={selectedId}
            onRefresh={onRefresh}
          />
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

/**
 * The Uploads pane: every upload, foldered or not. Files dropped here land at
 * the root — the tree is where you drop to file something into a folder, but
 * the drop shouldn't silently do nothing just because this tab is showing.
 */
function UploadList({
  uploads,
  folders,
  selectedId,
  onRefresh,
}: {
  uploads: Doc[];
  folders: Folder[];
  selectedId: string | null;
  onRefresh: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const over = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && containerRef.current?.contains(el));
  };

  useFileDrop((e) => {
    if (e.type === "leave") return setHovering(false);
    if (e.type === "over") return setHovering(over(e.x, e.y));
    setHovering(false);
    if (!over(e.x, e.y)) return;
    void importUploads(e.paths).then(({ errors }) => {
      setError(errors.length > 0 ? describeImportErrors(errors) : null);
      onRefresh();
    });
  });

  return (
    <div
      ref={containerRef}
      className={cn("min-h-full", hovering && "rounded-md ring-1 ring-inset ring-accent")}
    >
      {error && (
        <p className="mb-1 whitespace-pre-wrap rounded-md bg-surface-raised px-2 py-1.5 text-xs text-graph-citation">
          {error}
        </p>
      )}
      {uploads.map((d) => (
        <UploadRow
          key={d.id}
          doc={d}
          folderPath={folderPathLabel(d.folderId, folders)}
          active={d.id === selectedId}
          onRefresh={onRefresh}
        />
      ))}
      {uploads.length === 0 && (
        <p className="px-2 py-3  text-faint">No uploads yet. Import or drop files here.</p>
      )}
    </div>
  );
}

function UploadRow({
  doc,
  folderPath,
  active,
  onRefresh,
}: {
  doc: Doc;
  /** Folder the upload is filed under, if any — where its tree row lives. */
  folderPath: string | null;
  active: boolean;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();

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
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{doc.title}</span>
            {folderPath && <span className="block truncate text-xs text-faint">{folderPath}</span>}
          </span>
          <IngestBadge status={doc.ingestStatus} className="ml-auto shrink-0" />
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
