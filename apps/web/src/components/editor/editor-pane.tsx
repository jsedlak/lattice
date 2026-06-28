"use client";

import CodeMirror from "@uiw/react-codemirror";
import type { Document } from "@lattice/db";
import { buttonVariants, cn } from "@lattice/ui";
import { Check, Loader2, MessageSquare } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { latticeEditorExtensions } from "@/lib/codemirror-lattice";
import { updateDocument } from "@/lib/client-api";
import { MarkdownPreview } from "@/components/markdown-preview";

type SaveState = "idle" | "saving" | "saved";

const AUTOSAVE_MS = 700;

export function EditorPane({ doc }: { doc: Document }) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [title, setTitle] = React.useState(doc.title);
  const [content, setContent] = React.useState(doc.content);
  const [save, setSave] = React.useState<SaveState>("idle");
  const [showPreview, setShowPreview] = React.useState(true);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last title we revalidated the server tree for. The parent renders this
  // component with key={doc.id}, so it remounts (with fresh state) when the
  // selected document changes — no reset effect needed, and router.refresh()
  // won't clobber in-progress edits.
  const lastRefreshedTitle = React.useRef(doc.title);

  const persist = React.useCallback(
    async (patch: { title?: string; content?: string }) => {
      setSave("saving");
      try {
        await updateDocument(doc.id, patch);
        setSave("saved");
        // When the title changed, revalidate server components (document nav +
        // main sidebar) so they reflect the new name.
        if (patch.title !== undefined && patch.title !== lastRefreshedTitle.current) {
          lastRefreshedTitle.current = patch.title;
          router.refresh();
        }
      } catch {
        setSave("idle");
      }
    },
    [doc.id, router],
  );

  const scheduleSave = React.useCallback(
    (patch: { title?: string; content?: string }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => persist(patch), AUTOSAVE_MS);
    },
    [persist],
  );

  // Flush on unmount.
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Ctrl/Cmd-S explicit save, Ctrl/Cmd-P toggle preview.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        persist({ title, content });
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowPreview((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persist, title, content]);

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value, content });
          }}
          className="min-w-0 flex-1 truncate bg-transparent  font-medium focus:outline-none"
          aria-label="Document title"
        />
        <SaveIndicator state={save} />
        <span className=" text-faint">{words} words</span>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className={cn(
            "rounded-md px-2 py-1 ",
            showPreview ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          Preview
        </button>
        <Link
          href={`/assistant?doc=${doc.id}`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Ask assistant
        </Link>
      </div>

      {/* Split */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 overflow-auto",
            showPreview ? "w-1/2 border-r border-border" : "w-full",
          )}
        >
          <div className="px-4 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-faint">
              Markdown
            </div>
            <CodeMirror
              value={content}
              theme={resolvedTheme === "light" ? "light" : "dark"}
              extensions={latticeEditorExtensions()}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: false,
              }}
              onChange={(val) => {
                setContent(val);
                scheduleSave({ title, content: val });
              }}
            />
          </div>
        </div>
        {showPreview && (
          <div className="min-h-0 w-1/2 overflow-auto px-6 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-faint">
              Preview
            </div>
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1  text-faint">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1  text-graph-tag">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  return null;
}
