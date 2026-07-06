import CodeMirror from "@uiw/react-codemirror";
import { Check, Columns2, Loader2, MessageSquare } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Link } from "react-router-dom";

import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { MonacoMarkdown } from "@/components/editor/MonacoMarkdown";
import { cn } from "@/lib/cn";
import { loadSettings } from "@/lib/ai/settings";
import { latticeEditorExtensions } from "@/lib/codemirror-lattice";
import { buildDeterministic } from "@/lib/graph-build";
import { enqueueIngest } from "@/lib/ingest/pipeline";
import { updateDocument } from "@/lib/ipc";
import type { Doc, EditorChoice } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved";

const AUTOSAVE_MS = 700;

/** Same shell as the web button `size="sm" variant="outline"` (buttonVariants). */
const outlineSmLink =
  "inline-flex items-center justify-center gap-2 rounded-md  font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background select-none border border-border-strong bg-transparent text-foreground hover:bg-surface-raised h-8 px-3";

export function EditorPane({ doc, onRefresh }: { doc: Doc; onRefresh: () => void }) {
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = React.useState(doc.title);
  const [content, setContent] = React.useState(doc.content);
  const [save, setSave] = React.useState<SaveState>("idle");
  const [showPreview, setShowPreview] = React.useState(true);
  const [editorChoice, setEditorChoice] = React.useState<EditorChoice | null>(null);

  React.useEffect(() => {
    void loadSettings().then((s) => setEditorChoice(s.editor));
  }, []);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last title we refreshed the sidebar tree for. The parent renders this
  // component with key={doc.id}, so it remounts (with fresh state) when the
  // selected document changes — no reset effect needed, and onRefresh()
  // won't clobber in-progress edits.
  const lastRefreshedTitle = React.useRef(doc.title);

  const persist = React.useCallback(
    async (patch: { title?: string; content?: string }) => {
      setSave("saving");
      try {
        await updateDocument(doc.id, patch);
        setSave("saved");
        // Deterministic graph rebuild + LLM ingest on every content save.
        if (patch.content !== undefined) {
          await buildDeterministic(doc.id, patch.title ?? doc.title, patch.content);
          enqueueIngest(doc.id);
        }
        // When the title changed, reload the document list (sidebar + tabs)
        // so it reflects the new name.
        if (patch.title !== undefined && patch.title !== lastRefreshedTitle.current) {
          lastRefreshedTitle.current = patch.title;
          onRefresh();
        }
      } catch {
        setSave("idle");
      }
    },
    [doc.id, doc.title, onRefresh],
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
        void persist({ title, content });
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
      {/* Header — h-12 matches the sidebar's tab bar so the bottom borders align. */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
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
          title="Toggle preview (Ctrl+P)"
          aria-pressed={showPreview}
          className={cn(
            outlineSmLink,
            "gap-1.5",
            showPreview && "border-accent/50 bg-accent/10 text-accent hover:bg-accent/15",
          )}
        >
          <Columns2 className="h-3.5 w-3.5" />
          Preview
        </button>
        <Link to={`/assistant?doc=${doc.id}`} className={cn(outlineSmLink, "gap-1.5")}>
          <MessageSquare className="h-3.5 w-3.5" />
          Ask assistant
        </Link>
      </div>

      {/* Split */}
      <div className="flex min-h-0 flex-1">
        {/* Full-bleed editing surface: the surface bg marks the editable area
            even when the note is empty. Absolute inset gives the editor a
            definite pixel height — flex percentage chains collapse in
            WebKitGTK. */}
        <div
          className={cn(
            "relative min-h-0 bg-surface",
            showPreview ? "w-1/2 border-r border-border" : "w-full",
          )}
        >
            {editorChoice === "codemirror" ? (
              <CodeMirror
                value={content}
                height="100%"
                className="absolute inset-0 px-2 py-1"
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
            ) : editorChoice === "monaco" ? (
              <MonacoMarkdown
                value={content}
                theme={resolvedTheme}
                className="absolute inset-0 pl-1 pt-1"
                onChange={(val) => {
                  setContent(val);
                  scheduleSave({ title, content: val });
                }}
              />
            ) : null}
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
