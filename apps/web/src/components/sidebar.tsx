"use client";

import { authClient } from "@lattice/auth/client";
import { LogoMark, Spinner, ThemeToggle, cn } from "@lattice/ui";
import { FileText, Home, LogOut, MessageSquare, PenLine, Plus, Share2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { createNote } from "@/lib/client-api";

export interface SidebarUser {
  name: string;
  email: string;
  image?: string | null;
}
export interface SidebarDocument {
  id: string;
  title: string;
  kind: "note" | "upload";
}

const NAV = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/editor",
    label: "Editor",
    icon: PenLine,
    match: (p: string) => p.startsWith("/editor"),
  },
  { href: "/graph", label: "Graph", icon: Share2, match: (p: string) => p.startsWith("/graph") },
  {
    href: "/assistant",
    label: "Assistant",
    icon: MessageSquare,
    match: (p: string) => p.startsWith("/assistant"),
  },
];

export function Sidebar({
  user,
  documents,
  nodeCount,
}: {
  user: SidebarUser;
  documents: SidebarDocument[];
  nodeCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

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

  async function onSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const initials = (user.name || user.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
      {/* Identity */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <LogoMark size={32} />
        <div className="min-w-0">
          <div className="truncate  font-semibold">{user.name || "Your"}'s Workspace</div>
          <div className=" text-faint">Personal · Free</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-2">
        {NAV.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2  transition-colors",
                active
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:bg-surface-raised hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.label === "Graph" && nodeCount > 0 && (
                <span className="rounded bg-surface-raised px-1.5 py-0.5  text-faint">
                  {nodeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Documents */}
      <div className="mt-4 flex items-center justify-between px-4 py-1">
        <span className=" font-medium uppercase tracking-wide text-faint">Documents</span>
        <button
          type="button"
          onClick={onNewNote}
          disabled={creating}
          aria-label="New note"
          className="text-faint hover:text-foreground"
        >
          {creating ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {documents.length === 0 ? (
          <p className="px-2 py-2  text-faint">No documents yet.</p>
        ) : (
          documents.map((doc) => (
            <Link
              key={doc.id}
              href={`/editor?doc=${doc.id}`}
              className="flex items-center gap-2 truncate rounded-md px-2 py-1.5  text-muted hover:bg-surface-raised hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">{doc.title}</span>
            </Link>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15  font-medium text-accent">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate  font-medium">{user.name}</div>
          <div className="truncate  text-faint">{user.email}</div>
        </div>
        <ThemeToggle />
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
