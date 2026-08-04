import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as React from "react";

import { completeAt, type CompletionKind } from "@/lib/completions";

/**
 * Monaco-based markdown editor — the default engine (see AppSettings.editor).
 * Self-hosted (no CDN loader): the editor ships in the bundle and the base
 * editor worker is served by vite, which is all markdown needs. Monaco's
 * automaticLayout tracks the container's pixel size directly, so it fills
 * whatever box it's given regardless of webview flex/percent quirks.
 */

// Markdown never spawns a language service; every worker request gets the
// base editor worker.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Editor chrome colors mirror the app tokens in globals.css (Monaco needs
// concrete hex values, not CSS variables).
monaco.editor.defineTheme("lattice-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#101216",
    "editor.foreground": "#e7e8ea",
    "editor.lineHighlightBackground": "#15171b",
    "editorCursor.foreground": "#5b8cff",
    "editor.selectionBackground": "#5b8cff4d",
    "editorWidget.background": "#15171b",
    "scrollbarSlider.background": "#262a3180",
    "scrollbarSlider.hoverBackground": "#262a31",
  },
});
monaco.editor.defineTheme("lattice-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#f5f5f3",
    "editor.foreground": "#1b1e23",
    "editor.lineHighlightBackground": "#f0f0ee",
    "editorCursor.foreground": "#3a6df0",
    "editor.selectionBackground": "#3a6df04d",
    "editorWidget.background": "#f0f0ee",
    "scrollbarSlider.background": "#d3d3cd80",
    "scrollbarSlider.hoverBackground": "#d3d3cd",
  },
});

/** Monaco's icon vocabulary — closest match per completion kind. */
const MONACO_KIND: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  tag: monaco.languages.CompletionItemKind.Keyword,
  wikilink: monaco.languages.CompletionItemKind.Reference,
  path: monaco.languages.CompletionItemKind.File,
  snippet: monaco.languages.CompletionItemKind.Snippet,
};

/**
 * Adapter over the shared completion core (lib/completions) — the same source
 * the CodeMirror engine uses, so both editors offer identical completions.
 *
 * Registered once at module scope, NOT per editor instance: EditorPane remounts
 * this component for every document (key={doc.id}), and a provider registered
 * in the effect would stack a duplicate on each remount, multiplying every
 * suggestion.
 */
monaco.languages.registerCompletionItemProvider("markdown", {
  // `#` and `[` open tag/wiki-link contexts; `(` covers `](`, `/` the slash
  // menu. Trigger characters fire even with quickSuggestions off, which is how
  // prose stays quiet while these contexts still complete.
  triggerCharacters: ["#", "[", "(", "/"],
  async provideCompletionItems(model, position, context) {
    const before = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
    // Ctrl+Space (Invoke) offers the snippet catalog anywhere; typing a
    // trigger character does not.
    const explicit = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
    const result = await completeAt(before, explicit);
    if (!result || result.items.length === 0) return { suggestions: [] };

    const start = model.getPositionAt(result.from);
    const range = new monaco.Range(
      start.lineNumber,
      start.column,
      position.lineNumber,
      position.column,
    );
    return {
      suggestions: result.items.map((item) => {
        // Monaco's own snippet syntax uses $0 for the final cursor stop, which
        // is exactly the marker the shared catalog uses — hand it over as-is
        // rather than pre-splicing it.
        const isSnippet = item.insert.includes("$0");
        return {
          label: item.label,
          detail: item.detail,
          kind: MONACO_KIND[item.kind],
          // Monaco filters against the whole replaced range, which for the
          // slash menu starts at the `/`. Without it in filterText, every
          // snippet vanishes as soon as a character follows the slash.
          filterText: (result.filterPrefix ?? "") + item.label,
          insertText: item.insert,
          insertTextRules: isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range,
        };
      }),
      // Offsets shift as the user keeps typing; let Monaco re-query.
      incomplete: true,
    };
  },
});

/** Same #tag / [[wiki-link]] pattern as codemirror-lattice.ts and parseLinks. */
const LATTICE_RE = /(#[a-zA-Z][\w-]*)|(\[\[[^\]]+?\]\])/g;

function latticeDecorations(
  model: monaco.editor.ITextModel,
): monaco.editor.IModelDeltaDecoration[] {
  const out: monaco.editor.IModelDeltaDecoration[] = [];
  const text = model.getValue();
  for (const m of text.matchAll(LATTICE_RE)) {
    const start = model.getPositionAt(m.index);
    const end = model.getPositionAt(m.index + m[0].length);
    out.push({
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      options: {
        inlineClassName: m[0].startsWith("#") ? "monaco-lattice-tag" : "monaco-lattice-wikilink",
      },
    });
  }
  return out;
}

const themeFor = (theme: string | undefined) =>
  theme === "light" ? "lattice-light" : "lattice-dark";

/**
 * Uncontrolled: `value` seeds the model, edits flow out through onChange.
 * The parent remounts per document (key={doc.id}), matching how EditorPane
 * already treats CodeMirror.
 */
export function MonacoMarkdown({
  value,
  theme,
  onChange,
  className,
}: {
  value: string;
  theme?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const initialValue = React.useRef(value);
  const initialTheme = React.useRef(theme);

  React.useEffect(() => {
    const editor = monaco.editor.create(container.current!, {
      value: initialValue.current,
      language: "markdown",
      placeholder: "Start writing…",
      theme: themeFor(initialTheme.current),
      automaticLayout: true,
      wordWrap: "on",
      minimap: { enabled: false },
      lineNumbers: "off",
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: "line",
      scrollBeyondLastLine: false,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13.5,
      lineHeight: 1.7,
      padding: { top: 2, bottom: 12 },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      quickSuggestions: false,
      wordBasedSuggestions: "off",
      occurrencesHighlight: "off",
      selectionHighlight: false,
      guides: { indentation: false },
      unicodeHighlight: { ambiguousCharacters: false },
      stickyScroll: { enabled: false },
    });
    const model = editor.getModel()!;
    const decorations = editor.createDecorationsCollection(latticeDecorations(model));
    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
      decorations.set(latticeDecorations(model));
    });
    return () => {
      sub.dispose();
      editor.dispose();
    };
  }, []);

  React.useEffect(() => {
    monaco.editor.setTheme(themeFor(theme));
  }, [theme]);

  return <div ref={container} className={className} />;
}
