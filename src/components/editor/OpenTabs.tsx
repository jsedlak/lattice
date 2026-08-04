/**
 * The open-document tab strip above the editor pane.
 *
 * Tab state is an ordered list of document ids; which one is *active* is not
 * stored here — it's the `/editor/:id` route param, so tabs stay in sync with
 * wiki-link navigation, assistant citations, and the sidebar tree without a
 * second source of truth.
 *
 * Not to be confused with `DocumentTabs.tsx`, which is the sidebar's
 * Documents/Uploads switcher and predates this.
 */
import { FileText, Paperclip, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cn";
import type { Doc } from "@/lib/types";

export function OpenTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
}: {
  tabs: Doc[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const activeRef = React.useRef<HTMLDivElement>(null);

  // Keep the active tab visible when it's activated from outside the strip
  // (sidebar click, wiki-link, citation) and the strip has overflowed.
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      // h-9 + the pane header's h-12 stack under the sidebar's h-12 tab bar.
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-surface"
    >
      {tabs.map((doc) => {
        const active = doc.id === activeId;
        const Icon = doc.kind === "upload" ? Paperclip : FileText;
        return (
          <div
            key={doc.id}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            title={doc.title}
            onMouseDown={(e) => {
              // Middle click closes. Handled on mousedown because the webview
              // never delivers a middle-button `click`.
              if (e.button === 1) {
                e.preventDefault();
                onClose(doc.id);
              } else if (e.button === 0) {
                onActivate(doc.id);
              }
            }}
            // Middle click on some platforms also triggers auxclick/paste.
            onAuxClick={(e) => e.preventDefault()}
            className={cn(
              "group relative flex min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3",
              active
                ? "bg-surface-raised text-foreground"
                : "text-muted hover:bg-surface-raised/50 hover:text-foreground",
            )}
          >
            {/* Accent rail marks the active tab without shifting the row. */}
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <Icon className="h-3.5 w-3.5 shrink-0 text-faint" />
            <span className="truncate">{doc.title}</span>
            <button
              type="button"
              aria-label={`Close ${doc.title}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(doc.id);
              }}
              className={cn(
                "-mr-1 shrink-0 rounded p-0.5 text-faint hover:bg-border hover:text-foreground",
                // Reserve the space always; only reveal on hover/active so the
                // strip doesn't jitter as the pointer moves across it.
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
