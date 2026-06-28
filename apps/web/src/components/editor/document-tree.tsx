"use client";

import type { Document, Folder } from "@lattice/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  cn,
  useConfirm,
} from "@lattice/ui";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  createFolder,
  createNote,
  deleteDocument,
  deleteFolder,
  moveDocument,
  renameFolder,
  updateDocument,
} from "@/lib/client-api";

/**
 * The note tree: nested folders + notes, with a right-click context menu
 * (rename / move / delete / new), drag-to-move, and inline rename. Server data
 * (documents + folders) drives it; every mutation calls router.refresh().
 */
export function DocumentTree({
  documents,
  folders,
  selectedId,
}: {
  documents: Document[];
  folders: Folder[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(folders.map((f) => f.id)),
  );
  const [renaming, setRenaming] = React.useState<{ kind: "folder" | "doc"; id: string } | null>(
    null,
  );
  const [dropTarget, setDropTarget] = React.useState<string | "root" | null>(null);

  const foldersByParent = React.useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId ?? null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(f);
    }
    return m;
  }, [folders]);

  const docsByFolder = React.useMemo(() => {
    const m = new Map<string | null, Document[]>();
    for (const d of documents) {
      const key = d.folderId ?? null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(d);
    }
    return m;
  }, [documents]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function newFolder(parentId: string | null) {
    const { folder } = await createFolder("New folder", parentId);
    if (parentId) setExpanded((p) => new Set(p).add(parentId));
    setExpanded((p) => new Set(p).add(folder.id));
    setRenaming({ kind: "folder", id: folder.id });
    router.refresh();
  }
  async function newNoteIn(folderId: string | null) {
    const { document } = await createNote();
    if (folderId) await moveDocument(document.id, folderId);
    router.push(`/editor?doc=${document.id}`);
    router.refresh();
  }
  async function onDropDoc(folderId: string | null, e: React.DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    const docId = e.dataTransfer.getData("text/doc");
    if (docId) {
      await moveDocument(docId, folderId);
      router.refresh();
    }
  }

  const moveTargets = [
    { id: null as string | null, name: "Root" },
    ...folders.map((f) => ({ id: f.id as string | null, name: f.name })),
  ];

  function DocRow({ doc, depth }: { doc: Document; depth: number }) {
    const isRenaming = renaming?.kind === "doc" && renaming.id === doc.id;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable={!isRenaming}
            onDragStart={(e) => e.dataTransfer.setData("text/doc", doc.id)}
            className={cn(
              "group flex items-center gap-2 rounded-md py-1.5 pr-2 ",
              doc.id === selectedId
                ? "bg-accent/10 text-accent"
                : "text-muted hover:bg-surface-raised hover:text-foreground",
            )}
            style={{ paddingLeft: depth * 14 + 8 }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
            {isRenaming ? (
              <InlineRename
                initial={doc.title}
                onSubmit={async (name) => {
                  await updateDocument(doc.id, { title: name });
                  setRenaming(null);
                  router.refresh();
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                className="flex-1 truncate text-left"
                onClick={() => router.push(`/editor?doc=${doc.id}`)}
              >
                {doc.title}
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setRenaming({ kind: "doc", id: doc.id })}>
            Rename
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {moveTargets.map((t) => (
                <ContextMenuItem
                  key={t.id ?? "root"}
                  disabled={t.id === (doc.folderId ?? null)}
                  onSelect={async () => {
                    await moveDocument(doc.id, t.id);
                    router.refresh();
                  }}
                >
                  {t.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={async () => {
              if (
                await confirm({
                  title: "Delete note?",
                  description: `"${doc.title}" will be permanently deleted.`,
                  confirmLabel: "Delete",
                  destructive: true,
                })
              ) {
                await deleteDocument(doc.id);
                router.refresh();
              }
            }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  function FolderNode({ folder, depth }: { folder: Folder; depth: number }) {
    const isOpen = expanded.has(folder.id);
    const isRenaming = renaming?.kind === "folder" && renaming.id === folder.id;
    const childFolders = (foldersByParent.get(folder.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const childDocs = docsByFolder.get(folder.id) ?? [];

    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(folder.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === folder.id ? null : t))}
              onDrop={(e) => onDropDoc(folder.id, e)}
              className={cn(
                "flex items-center gap-1 rounded-md py-1.5 pr-2  text-foreground hover:bg-surface-raised",
                dropTarget === folder.id && "bg-accent/10 ring-1 ring-accent",
              )}
              style={{ paddingLeft: depth * 14 + 4 }}
            >
              <button type="button" onClick={() => toggle(folder.id)} className="text-faint">
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
              {isRenaming ? (
                <InlineRename
                  initial={folder.name}
                  onSubmit={async (name) => {
                    await renameFolder(folder.id, name);
                    setRenaming(null);
                    router.refresh();
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 truncate text-left"
                  onClick={() => toggle(folder.id)}
                >
                  {folder.name}
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => newNoteIn(folder.id)}>New note</ContextMenuItem>
            <ContextMenuItem onSelect={() => newFolder(folder.id)}>New subfolder</ContextMenuItem>
            <ContextMenuItem onSelect={() => setRenaming({ kind: "folder", id: folder.id })}>
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              destructive
              onSelect={async () => {
                if (
                  await confirm({
                    title: "Delete folder?",
                    description: `"${folder.name}" will be deleted. Its notes and subfolders move up a level.`,
                    confirmLabel: "Delete folder",
                    destructive: true,
                  })
                ) {
                  await deleteFolder(folder.id);
                  router.refresh();
                }
              }}
            >
              Delete folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isOpen && (
          <div>
            {childFolders.map((f) => (
              <FolderNode key={f.id} folder={f} depth={depth + 1} />
            ))}
            {childDocs.map((d) => (
              <DocRow key={d.id} doc={d} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const rootFolders = (foldersByParent.get(null) ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const rootDocs = docsByFolder.get(null) ?? [];
  const isEmpty = folders.length === 0 && documents.length === 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn("min-h-full", dropTarget === "root" && "ring-1 ring-inset ring-accent")}
          onDragOver={(e) => {
            e.preventDefault();
            setDropTarget("root");
          }}
          onDragLeave={() => setDropTarget((t) => (t === "root" ? null : t))}
          onDrop={(e) => onDropDoc(null, e)}
        >
          {isEmpty ? (
            <p className="px-2 py-3  text-faint">No notes yet. Right-click to add a folder.</p>
          ) : (
            <>
              {rootFolders.map((f) => (
                <FolderNode key={f.id} folder={f} depth={0} />
              ))}
              {rootDocs.map((d) => (
                <DocRow key={d.id} doc={d} depth={0} />
              ))}
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => newFolder(null)}>
          <FolderPlus className="h-3.5 w-3.5" /> New folder
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => newNoteIn(null)}>New note</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function InlineRename({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => (value.trim() && value !== initial ? onSubmit(value.trim()) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value.trim() || initial);
        if (e.key === "Escape") onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 rounded border border-accent bg-background px-1 py-0.5  focus:outline-none"
    />
  );
}
