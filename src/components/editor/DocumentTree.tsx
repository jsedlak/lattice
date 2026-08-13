import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Paperclip,
  Upload,
} from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  useConfirm,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { folderSubtreeIds } from "@/lib/folder-context";
import { rebuildFolderContext } from "@/lib/graph-build";
import {
  createFolder,
  createNote,
  deleteDocument,
  deleteFolder,
  renameFolder,
  reorderDocuments,
  reorderFolders,
  updateDocument,
} from "@/lib/ipc";
import type { Doc, Folder } from "@/lib/types";
import { describeImportErrors, importUploads, pickUploadPaths } from "@/lib/uploads";
import { useFileDrop } from "@/lib/use-file-drop";

import { IngestBadge } from "./IngestBadge";

const moveDocument = (documentId: string, folderId: string | null) =>
  updateDocument(documentId, { folderId });

export interface RenameRequest {
  kind: "folder" | "doc";
  id: string;
}

type DragPayload = { kind: "doc" | "folder"; id: string };

/** Where a drag is currently hovering. */
type DropSpot =
  | { kind: "doc"; id: string; pos: "before" | "after" }
  | { kind: "folder"; id: string; pos: "before" | "after" | "into" }
  | { kind: "root" }
  | null;

/** Where an OS file drag would land — `null` folderId means the tree root. */
type FileDropTarget = { folderId: string | null };

/** Pixels of movement before a mousedown becomes a drag instead of a click. */
const DRAG_THRESHOLD = 5;

/**
 * The note tree: nested folders + notes, with a right-click context menu
 * (rename / move / delete / new), drag & drop (into/out of folders and manual
 * reordering, persisted via sort_order), and inline rename. Drag & drop is
 * pointer-based (mousedown/mousemove/mouseup) rather than HTML5 DnD, because
 * WebKitGTK — the Tauri webview on Linux — fires dragover but swallows drop.
 */
export function DocumentTree({
  documents,
  folders,
  selectedId,
  renameRequest,
  onRenameRequestHandled,
  onRefresh,
}: {
  documents: Doc[];
  folders: Folder[];
  selectedId: string | null;
  /** Set by the parent (e.g. the New note / New folder buttons) to start an inline rename. */
  renameRequest?: RenameRequest | null;
  onRenameRequestHandled?: () => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(folders.map((f) => f.id)),
  );
  const [renaming, setRenaming] = React.useState<RenameRequest | null>(null);
  // Files an import rejected (unsupported type, unreadable) — shown above the tree.
  const [importError, setImportError] = React.useState<string | null>(null);
  // Folder an OS file-drag is hovering; null while no drag is over the tree.
  const [fileDrop, setFileDrop] = React.useState<FileDropTarget | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<DragPayload | null>(null);
  const [drop, setDrop] = React.useState<DropSpot>(null);
  // mousedown that may become a drag once the pointer moves past the threshold.
  const pendingDrag = React.useRef<(DragPayload & { x: number; y: number }) | null>(null);
  const dragRef = React.useRef<DragPayload | null>(null);
  // Swallow the click that immediately follows a drop.
  const suppressClick = React.useRef(false);

  // The parent asked for an inline rename (new note / new folder buttons).
  React.useEffect(() => {
    if (renameRequest) {
      setRenaming(renameRequest);
      onRenameRequestHandled?.();
    }
  }, [renameRequest, onRenameRequestHandled]);

  // Lists keep the backend's order (sort_order, i.e. manual drag order).
  const foldersByParent = React.useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId ?? null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(f);
    }
    return m;
  }, [folders]);

  const docsByFolder = React.useMemo(() => {
    const m = new Map<string | null, Doc[]>();
    for (const d of documents) {
      const key = d.folderId ?? null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(d);
    }
    return m;
  }, [documents]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function newFolder(parentId: string | null) {
    const folder = await createFolder("New folder", parentId);
    if (parentId) setExpanded((p) => new Set(p).add(parentId));
    setExpanded((p) => new Set(p).add(folder.id));
    setRenaming({ kind: "folder", id: folder.id });
    onRefresh();
  }

  /** Copies files into `folderId` as uploads. Shared by the context-menu
   *  picker and the OS drag & drop handler. */
  const importInto = React.useCallback(
    async (paths: string[], folderId: string | null) => {
      if (paths.length === 0) return;
      const { errors } = await importUploads(paths, folderId);
      setImportError(errors.length > 0 ? describeImportErrors(errors) : null);
      if (folderId) setExpanded((p) => new Set(p).add(folderId));
      onRefresh();
    },
    [onRefresh],
  );

  async function uploadInto(folderId: string | null) {
    await importInto(await pickUploadPaths(), folderId);
  }

  /** Folder under the cursor, or null when the pointer is outside the tree. */
  function fileDropTarget(x: number, y: number): FileDropTarget | null {
    const root = containerRef.current;
    if (!root) return null;
    const el = document.elementFromPoint(x, y);
    if (!el || !root.contains(el)) return null;
    // Folder wrappers nest, so the innermost match is the folder you're in.
    return { folderId: el.closest("[data-folder-id]")?.getAttribute("data-folder-id") ?? null };
  }

  // Files dragged in from the OS land in whichever folder they're dropped on.
  useFileDrop((e) => {
    if (e.type === "leave") return setFileDrop(null);
    const target = fileDropTarget(e.x, e.y);
    if (e.type === "over") return setFileDrop(target);
    setFileDrop(null);
    if (target) void importInto(e.paths, target.folderId);
  });

  async function newNoteIn(folderId: string | null) {
    const document = await createNote("Untitled note", "", folderId);
    if (folderId) setExpanded((p) => new Set(p).add(folderId));
    navigate(`/editor/${document.id}`);
    setRenaming({ kind: "doc", id: document.id });
    onRefresh();
  }

  // ── Drag & drop (pointer-based) ────────────────────────────────────────────

  const docIdsIn = (folderId: string | null) =>
    (docsByFolder.get(folderId) ?? []).map((d) => d.id);
  const folderIdsIn = (parentId: string | null) =>
    (foldersByParent.get(parentId) ?? []).map((f) => f.id);

  /** true when `ancestorId` is `folderId` itself or one of its ancestors. */
  function underneath(folderId: string, ancestorId: string): boolean {
    const byId = new Map(folders.map((f) => [f.id, f]));
    let cur: string | null = folderId;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  }

  /**
   * Documents whose folder path a change to `folderId`'s subtree affects — a
   * folder rename, move, or delete shifts the derived tags of everything under
   * it, not just its direct children.
   */
  function docsUnder(folderId: string): string[] {
    const ids = folderSubtreeIds(folderId, folders);
    return documents.filter((d) => d.folderId && ids.has(d.folderId)).map((d) => d.id);
  }

  /** before/after by row half; folders also accept "into" in the middle band. */
  function rowPos(e: React.MouseEvent, canNest: boolean): "before" | "after" | "into" {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (canNest) return y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
    return y < 0.5 ? "before" : "after";
  }

  /** setDrop, skipping the re-render when the spot didn't change. */
  function setDropSpot(next: DropSpot) {
    setDrop((prev) => {
      if (prev === next) return prev;
      if (
        prev &&
        next &&
        prev.kind === next.kind &&
        ("id" in prev ? prev.id : null) === ("id" in next ? next.id : null) &&
        ("pos" in prev ? prev.pos : null) === ("pos" in next ? next.pos : null)
      ) {
        return prev;
      }
      return next;
    });
  }

  function beginDrag(e: React.MouseEvent, payload: DragPayload) {
    if (e.button !== 0) return;
    pendingDrag.current = { ...payload, x: e.clientX, y: e.clientY };
  }

  // Promote a pending mousedown to a drag once the pointer moves far enough.
  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      const p = pendingDrag.current;
      if (!p || dragRef.current) return;
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) >= DRAG_THRESHOLD) {
        const payload = { kind: p.kind, id: p.id };
        dragRef.current = payload;
        setDrag(payload);
      }
    }
    function onUp() {
      pendingDrag.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // While a drag is live: grabbing cursor, no text selection, and mouseup
  // anywhere either commits the drop or cancels.
  React.useEffect(() => {
    if (!drag) return;
    const body = document.body;
    const prevSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = "none";
    body.style.cursor = "grabbing";

    function finish() {
      dragRef.current = null;
      setDrag(null);
      setDrop(null);
    }
    function onUp() {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const payload = drag;
      const spot = drop;
      finish();
      if (payload && spot) void performDrop(payload, spot);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      body.style.userSelect = prevSelect;
      body.style.cursor = prevCursor;
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, drop]);

  async function performDrop(payload: DragPayload, spot: NonNullable<DropSpot>) {
    if (payload.kind === "doc") {
      const docId = payload.id;
      const from = documents.find((d) => d.id === docId)?.folderId ?? null;
      let dest: string | null;
      if (spot.kind === "doc") {
        if (spot.id === docId) return;
        const target = documents.find((d) => d.id === spot.id);
        if (!target) return;
        dest = target.folderId ?? null;
        const ids = docIdsIn(dest).filter((id) => id !== docId);
        const at = ids.indexOf(spot.id) + (spot.pos === "after" ? 1 : 0);
        ids.splice(at, 0, docId);
        await reorderDocuments(dest, ids);
      } else {
        // Onto a folder row (any position) or the root background: move into it.
        const into = spot.kind === "folder" ? spot.id : null;
        dest = into;
        const ids = docIdsIn(into).filter((id) => id !== docId);
        ids.push(docId);
        await reorderDocuments(into, ids);
        if (into) setExpanded((p) => new Set(p).add(into));
      }
      // A reorder within the same folder doesn't change the note's path.
      if (dest !== from) await rebuildFolderContext([docId]);
      onRefresh();
    } else {
      const folderId = payload.id;
      if (spot.kind === "doc") return;
      const from = folders.find((f) => f.id === folderId)?.parentId ?? null;
      // Snapshot before the move: the subtree walk needs the pre-move tree.
      const affected = docsUnder(folderId);
      let dest: string | null;
      if (spot.kind === "folder") {
        if (spot.id === folderId || underneath(spot.id, folderId)) return;
        const target = folders.find((f) => f.id === spot.id);
        if (!target) return;
        if (spot.pos === "into") {
          dest = spot.id;
          const ids = folderIdsIn(spot.id).filter((id) => id !== folderId);
          ids.push(folderId);
          await reorderFolders(spot.id, ids);
          setExpanded((p) => new Set(p).add(spot.id));
        } else {
          dest = target.parentId ?? null;
          const ids = folderIdsIn(dest).filter((id) => id !== folderId);
          const at = ids.indexOf(spot.id) + (spot.pos === "after" ? 1 : 0);
          ids.splice(at, 0, folderId);
          await reorderFolders(dest, ids);
        }
      } else {
        dest = null;
        const ids = folderIdsIn(null).filter((id) => id !== folderId);
        ids.push(folderId);
        await reorderFolders(null, ids);
      }
      // Re-parenting shifts the path of every note beneath the folder.
      if (dest !== from) await rebuildFolderContext(affected);
      onRefresh();
    }
  }

  /** Accent line above/below a row while a drag hovers over it. */
  function DropLine({ pos }: { pos: "before" | "after" }) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent",
          pos === "before" ? "-top-px" : "-bottom-px",
        )}
      />
    );
  }

  const moveTargets = [
    { id: null as string | null, name: "Root" },
    ...folders.map((f) => ({ id: f.id as string | null, name: f.name })),
  ];

  function DocRow({ doc, depth }: { doc: Doc; depth: number }) {
    const isUpload = doc.kind === "upload";
    const isRenaming = renaming?.kind === "doc" && renaming.id === doc.id;
    const isDragSource = drag?.kind === "doc" && drag.id === doc.id;
    const hover = drop?.kind === "doc" && drop.id === doc.id ? drop.pos : null;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onMouseDown={(e) => !isRenaming && beginDrag(e, { kind: "doc", id: doc.id })}
            onMouseMove={(e) => {
              if (!drag) return;
              e.stopPropagation();
              // A folder can't land on a note row.
              if (drag.kind !== "doc") return setDropSpot(null);
              setDropSpot({
                kind: "doc",
                id: doc.id,
                pos: rowPos(e, false) as "before" | "after",
              });
            }}
            className={cn(
              "group relative flex items-center gap-2 rounded-md py-1.5 pr-2 ",
              doc.id === selectedId
                ? "bg-accent/10 text-accent"
                : "text-muted hover:bg-surface-raised hover:text-foreground",
              isDragSource && "opacity-50",
            )}
            style={{ paddingLeft: depth * 14 + 8 }}
          >
            {hover && <DropLine pos={hover} />}
            {/* Uploads live in the tree as a link to the file itself — the
                paperclip is what separates them from notes at a glance. */}
            {isUpload ? (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-faint" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
            )}
            {isRenaming ? (
              <InlineRename
                initial={doc.title}
                onSubmit={async (name) => {
                  await updateDocument(doc.id, { title: name });
                  setRenaming(null);
                  onRefresh();
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    if (suppressClick.current) return;
                    // Explicit tab: opening an upload from the tree shouldn't
                    // swap the sidebar out from under you.
                    navigate(`/editor/${doc.id}?tab=documents`);
                  }}
                >
                  {doc.title}
                </button>
                {isUpload && <IngestBadge status={doc.ingestStatus} className="shrink-0" />}
              </>
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
                    await rebuildFolderContext([doc.id]);
                    onRefresh();
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
                  title: isUpload ? "Delete file?" : "Delete note?",
                  description: isUpload
                    ? `"${doc.title}" and its extracted graph data will be permanently deleted.`
                    : `"${doc.title}" will be permanently deleted.`,
                  confirmLabel: "Delete",
                  destructive: true,
                })
              ) {
                await deleteDocument(doc.id);
                onRefresh();
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
    const isDragSource = drag?.kind === "folder" && drag.id === folder.id;
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childDocs = docsByFolder.get(folder.id) ?? [];
    const hover = drop?.kind === "folder" && drop.id === folder.id ? drop.pos : null;
    const fileHover = fileDrop?.folderId === folder.id;

    return (
      // The wrapper spans the folder's whole subtree, so an OS file drag
      // anywhere inside it (child row, blank space) resolves to this folder.
      <div data-folder-id={folder.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onMouseDown={(e) => !isRenaming && beginDrag(e, { kind: "folder", id: folder.id })}
              onMouseMove={(e) => {
                if (!drag) return;
                e.stopPropagation();
                // Don't offer a folder as a target of itself or its descendants.
                if (
                  drag.kind === "folder" &&
                  (drag.id === folder.id || underneath(folder.id, drag.id))
                ) {
                  return setDropSpot(null);
                }
                // A dragged doc always drops *into* the folder; a dragged
                // folder can also land before/after it (reorder).
                const pos = drag.kind === "doc" ? "into" : rowPos(e, true);
                setDropSpot({ kind: "folder", id: folder.id, pos });
              }}
              className={cn(
                "relative flex items-center gap-1 rounded-md py-1.5 pr-2  text-foreground hover:bg-surface-raised",
                (hover === "into" || fileHover) && "bg-accent/10 ring-1 ring-accent",
                isDragSource && "opacity-50",
              )}
              style={{ paddingLeft: depth * 14 + 4 }}
            >
              {(hover === "before" || hover === "after") && <DropLine pos={hover} />}
              <button
                type="button"
                onClick={() => !suppressClick.current && toggle(folder.id)}
                className="text-faint"
              >
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
                    const affected = docsUnder(folder.id);
                    await renameFolder(folder.id, name);
                    setRenaming(null);
                    // The folder's name is a tag on every note beneath it.
                    await rebuildFolderContext(affected);
                    onRefresh();
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 truncate text-left"
                  onClick={() => !suppressClick.current && toggle(folder.id)}
                >
                  {folder.name}
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => newNoteIn(folder.id)}>New note</ContextMenuItem>
            <ContextMenuItem onSelect={() => newFolder(folder.id)}>New subfolder</ContextMenuItem>
            <ContextMenuItem onSelect={() => void uploadInto(folder.id)}>
              <Upload className="h-3.5 w-3.5" /> Upload files here
            </ContextMenuItem>
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
                    description: `"${folder.name}" and everything inside it — notes, files and subfolders — will be permanently deleted.`,
                    confirmLabel: "Delete folder",
                    destructive: true,
                  })
                ) {
                  await deleteFolder(folder.id);
                  onRefresh();
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

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootDocs = docsByFolder.get(null) ?? [];
  const isEmpty = folders.length === 0 && documents.length === 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={cn(
            "min-h-full",
            (drop?.kind === "root" || fileDrop?.folderId === null) &&
              "ring-1 ring-inset ring-accent",
          )}
          onMouseMove={() => drag && setDropSpot({ kind: "root" })}
          onMouseLeave={() => drag && setDropSpot(null)}
        >
          {importError && (
            <p className="mb-1 whitespace-pre-wrap rounded-md bg-surface-raised px-2 py-1.5 text-xs text-graph-citation">
              {importError}
            </p>
          )}
          {isEmpty ? (
            <p className="px-2 py-3  text-faint">
              No notes yet. Right-click to add a folder, or drop files here.
            </p>
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
        <ContextMenuItem onSelect={() => void uploadInto(null)}>
          <Upload className="h-3.5 w-3.5" /> Upload files
        </ContextMenuItem>
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
      onFocus={(e) => e.target.select()}
      onBlur={() => (value.trim() && value !== initial ? onSubmit(value.trim()) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value.trim() || initial);
        if (e.key === "Escape") onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded border border-accent bg-background px-1 py-0.5  focus:outline-none"
    />
  );
}
