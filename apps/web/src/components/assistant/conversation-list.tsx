"use client";

import type { Conversation } from "@lattice/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  useConfirm,
} from "@lattice/ui";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { deleteConversation, renameConversation } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";

export function ConversationList({ conversations }: { conversations: Conversation[] }) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const activeId = params?.id;
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
    if (c.id === activeId) router.push("/assistant");
    router.refresh();
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="p-2">
        <button
          type="button"
          onClick={() => {
            router.push("/assistant");
            router.refresh();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-2  text-muted hover:bg-surface-raised hover:text-foreground"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-3  text-faint">No conversations yet.</p>
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
                            router.refresh();
                          }}
                          onCancel={() => setRenamingId(null)}
                        />
                      </div>
                    ) : (
                      <Link href={`/assistant/${c.id}`} className="block px-2 py-2">
                        <div
                          className={cn("truncate ", active ? "text-accent" : "text-foreground")}
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
                  <ContextMenuItem destructive onSelect={() => onDelete(c)}>
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
      className="w-full rounded border border-accent bg-background px-1.5 py-1  focus:outline-none"
    />
  );
}
