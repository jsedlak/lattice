"use client";

import type { Document, Folder } from "@lattice/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Spinner,
  cn,
  useConfirm,
} from "@lattice/ui";
import { Download, FileText, FolderPlus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { blobUrl, createFolder, createNote, deleteDocument } from "@/lib/client-api";
import { DocumentTree } from "./document-tree";
import { UploadButton } from "./upload-button";

export function DocumentTabs({
  documents,
  folders,
  selectedId,
  tab,
}: {
  documents: Document[];
  folders: Folder[];
  selectedId: string | null;
  tab: "documents" | "blobs";
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  const notes = documents.filter((d) => d.kind === "note");
  const blobs = documents.filter((d) => d.kind === "upload");

  async function onNewNote() {
    setCreating(true);
    try {
      const { document } = await createNote();
      router.push(`/editor?doc=${document.id}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function onNewFolder() {
    await createFolder("New folder", null);
    router.refresh();
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabLink active={tab === "documents"} href="/editor?tab=documents" label="Documents" />
        <TabLink active={tab === "blobs"} href="/editor?tab=blobs" label="Blobs" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "documents" ? (
          <DocumentTree documents={notes} folders={folders} selectedId={selectedId} />
        ) : (
          <>
            {blobs.map((d) => (
              <BlobRow key={d.id} doc={d} active={d.id === selectedId} />
            ))}
            {blobs.length === 0 && <p className="px-2 py-3  text-faint">No uploads yet.</p>}
          </>
        )}
      </div>

      <div className="border-t border-border p-2">
        {tab === "documents" ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onNewNote}
              disabled={creating}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-2  text-muted hover:bg-surface-raised hover:text-foreground"
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
          <UploadButton />
        )}
      </div>
    </div>
  );
}

function TabLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "border-b-2 px-3 py-2.5 text-center flex-1 transition-colors",
        active
          ? "border-accent font-medium text-foreground bg-surface-raised"
          : "border-transparent text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function BlobRow({ doc, active }: { doc: Document; active: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();

  function onDownload() {
    const a = window.document.createElement("a");
    a.href = blobUrl(doc.id);
    a.download = doc.title;
    window.document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function onDelete() {
    const ok = await confirm({
      title: "Delete file?",
      description: `"${doc.title}" and its extracted graph data will be permanently deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteDocument(doc.id);
    if (active) router.push("/editor?tab=blobs");
    router.refresh();
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          href={`/editor?doc=${doc.id}&tab=blobs`}
          className={cn(
            "flex items-center gap-2 truncate rounded-md px-2 py-2 ",
            active
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-surface-raised hover:text-foreground",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="truncate">{doc.title}</span>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onDownload}>
          <Download className="h-3.5 w-3.5" /> Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
