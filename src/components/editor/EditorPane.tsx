import CodeMirror from "@uiw/react-codemirror";
import { Check, Columns2, Loader2, MessageSquare } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Link } from "react-router-dom";

import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { MonacoMarkdown } from "@/components/editor/MonacoMarkdown";
import { ResizeHandle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadSettings } from "@/lib/ai/settings";
import { layoutBootCache, loadLayoutPrefs, saveLayoutPrefs } from "@/lib/layout-prefs";
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
  const [split, setSplit] = React.useState(() => layoutBootCache().editorSplit);
  const splitRef = React.useRef(split);
  const splitRowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void loadSettings().then((s) => setEditorChoice(s.editor));
    void loadLayoutPrefs().then((p) => {
      setSplit(p.editorSplit);
      splitRef.current = p.editorSplit;
    });
  }, []);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fields the user edited but that haven't been persisted yet. Saves send
  // ONLY these — sending an untouched title alongside every content save
  // would silently undo a rename made elsewhere (e.g. the sidebar tree)
  // while this note is open.
  const pending = React.useRef<{ title?: string; content?: string }>({});
  // Last title we refreshed the sidebar tree for. The parent renders this
  // component with key={doc.id}, so it remounts (with fresh state) when the
  // selected document changes — no reset effect needed, and onRefresh()
  // won't clobber in-progress edits.
  const lastRefreshedTitle = React.useRef(doc.title);

  // Adopt renames made outside this pane unless a title edit is in flight.
  React.useEffect(() => {
    if (pending.current.title === undefined) {
      setTitle(doc.title);
      lastRefreshedTitle.current = doc.title;
    }
  }, [doc.title]);

  const persist = React.useCallback(
    async (patch: { title?: string; content?: string }) => {
      if (patch.title === undefined && patch.content === undefined) return;
      setSave("saving");
      try {
        const saved = await updateDocument(doc.id, patch);
        setSave("saved");
        // Files-mode workspaces may adjust the title to a usable, unique
        // filename — adopt what actually stuck.
        if (patch.title !== undefined && saved.title !== patch.title) {
          patch = { ...patch, title: saved.title };
          setTitle(saved.title);
        }
        // Deterministic graph rebuild + LLM ingest on every content save.
        if (patch.content !== undefined) {
          await buildDeterministic(doc.id, patch.title ?? saved.title, patch.content);
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
    [doc.id, onRefresh],
  );

  const scheduleSave = React.useCallback(
    (patch: { title?: string; content?: string }) => {
      // Merge, don't replace: a title edit must survive a content keystroke
      // landing before the debounce fires.
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const flush = pending.current;
        pending.current = {};
        void persist(flush);
      }, AUTOSAVE_MS);
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
        // Flush what's dirty; content is included so an explicit save always
        // lands the visible text.
        const flush = { ...pending.current, content };
        pending.current = {};
        void persist(flush);
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
            scheduleSave({ title: e.target.value });
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
      <div ref={splitRowRef} className="flex min-h-0 flex-1">
        {/* Full-bleed editing surface: the surface bg marks the editable area
            even when the note is empty. Absolute inset gives the editor a
            definite pixel height — flex percentage chains collapse in
            WebKitGTK. */}
        <div
          style={showPreview ? { width: `${split * 100}%` } : undefined}
          className={cn(
            "relative min-h-0 bg-surface",
            showPreview ? "border-r border-border" : "w-full",
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
                  scheduleSave({ content: val });
                }}
              />
            ) : editorChoice === "monaco" ? (
              <MonacoMarkdown
                value={content}
                theme={resolvedTheme}
                className="absolute inset-0 pl-1 pt-1"
                onChange={(val) => {
                  setContent(val);
                  scheduleSave({ content: val });
                }}
              />
            ) : null}
        </div>
        {showPreview && (
          <>
            <ResizeHandle
              label="Resize editor/preview split"
              onResize={(x) => {
                const rect = splitRowRef.current?.getBoundingClientRect();
                if (!rect || rect.width === 0) return;
                const f = Math.min(0.8, Math.max(0.2, (x - rect.left) / rect.width));
                splitRef.current = f;
                setSplit(f);
              }}
              onEnd={() => saveLayoutPrefs({ editorSplit: splitRef.current })}
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-faint">
                Preview
              </div>
              <MarkdownPreview content={content} />
            </div>
          </>
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
