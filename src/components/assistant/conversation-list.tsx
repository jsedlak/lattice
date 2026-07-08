/**
 * Conversation history sidebar — ported from
 * apps/web/src/components/assistant/conversation-list.tsx.
 *
 * Deviations from the web version:
 * - Data mutations go through the Tauri ipc layer; instead of router.refresh()
 *   the parent screen passes `onChanged` to re-fetch the list.
 * - The ContextMenu primitives are styled locally over
 *   @radix-ui/react-context-menu (same classes as packages/ui) because the
 *   desktop ui barrel does not promise them.
 */
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useConfirm } from "@/components/ui";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { deleteConversation, renameConversation } from "@/lib/ipc";
import type { Conversation } from "@/lib/types";

export function ConversationList({
  conversations,
  onChanged,
}: {
  conversations: Conversation[];
  onChanged: () => void;
}) {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const activeId = params.id;
  const confirm = useConfirm();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  async function onDelete(c: Conversation) {
    const ok = await confirm({
      title: "Delete conversation?",
      description: `"${c.title}" and all its messages will be permanently deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteConversation(c.id);
    if (c.id === activeId) navigate("/assistant");
    onChanged();
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="p-2">
        <button
          type="button"
          onClick={() => navigate("/assistant")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-2 text-muted hover:bg-surface-raised hover:text-foreground"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-faint">No conversations yet.</p>
        ) : (
          conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <ContextMenu key={c.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      "rounded-md",
                      active ? "bg-accent/10" : "hover:bg-surface-raised",
                    )}
                  >
                    {renamingId === c.id ? (
                      <div className="px-2 py-2">
                        <InlineRename
                          initial={c.title}
                          onSubmit={async (name) => {
                            await renameConversation(c.id, name);
                            setRenamingId(null);
                            onChanged();
                          }}
                          onCancel={() => setRenamingId(null)}
                        />
                      </div>
                    ) : (
                      <Link to={`/assistant/${c.id}`} className="block px-2 py-2">
                        <div
                          className={cn("truncate", active ? "text-accent" : "text-foreground")}
                        >
                          {c.title}
                        </div>
                        <div className="text-sm text-faint">{relativeTime(c.updatedAt)}</div>
                      </Link>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setRenamingId(c.id)}>
                    <Pencil className="h-3.5 w-3.5" /> Rename
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem destructive onSelect={() => void onDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </div>
    </div>
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
      className="w-full rounded border border-accent bg-background px-1.5 py-1 focus:outline-none"
    />
  );
}

// ── Context menu (styled like packages/ui/src/components/context-menu.tsx) ───

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const contentClasses =
  "z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface p-1 text-foreground shadow-lg " +
  "data-[state=open]:animate-fade-in";

const itemClasses =
  "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none " +
  "focus:bg-surface-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function ContextMenuContent({ children }: { children: React.ReactNode }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={contentClasses}>
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  destructive,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        itemClasses,
        destructive && "text-graph-citation focus:bg-graph-citation/10",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />;
}
