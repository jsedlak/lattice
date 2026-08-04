import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView, placeholder } from "@codemirror/view";
import {
  Decoration,
  type DecorationSet,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { applyCursorMarker, completeAt, type CompletionKind } from "@/lib/completions";

/**
 * CodeMirror decorations that make `#tags` (green) and `[[wiki-links]]` (purple)
 * visually distinct — the same taxonomy colors as the preview and graph. Uses
 * the same patterns as parseLinks (kept intentionally in sync). Ported from
 * the web app's src/lib/codemirror-lattice.ts.
 */
const tagDeco = Decoration.mark({ class: "cm-lattice-tag" });
const wikiDeco = Decoration.mark({ class: "cm-lattice-wikilink" });

const matcher = new MatchDecorator({
  regexp: /(#[a-zA-Z][\w-]*)|(\[\[[^\]]+?\]\])/g,
  decoration: (match) => (match[0].startsWith("#") ? tagDeco : wikiDeco),
});

const latticeDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** CodeMirror's icon vocabulary — closest match per completion kind. */
const CM_TYPE: Record<CompletionKind, string> = {
  tag: "keyword",
  wikilink: "class",
  path: "variable",
  snippet: "text",
};

/**
 * Adapter over the shared completion core (lib/completions). All the logic
 * about *what* to offer lives there; this only translates the result into
 * CodeMirror's shape. Returning null outside a trigger context is what keeps
 * the editor quiet during ordinary prose.
 */
async function latticeCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
  const before = ctx.state.doc.sliceString(0, ctx.pos);
  const result = await completeAt(before, ctx.explicit);
  if (!result || result.items.length === 0) return null;

  const options: Completion[] = result.items.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: CM_TYPE[item.kind],
    apply: (view, _completion, from, to) => {
      const { text, cursor } = applyCursorMarker(item.insert);
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + cursor },
      });
    },
  }));
  // filter: false — completeAt has already filtered against the typed query.
  // Letting CodeMirror filter again would drop path completions whose match is
  // mid-string, and would empty the slash menu entirely (its range includes the
  // `/`, which appears in no label).
  return { from: result.from, options, filter: false };
}

/** Editor extensions: markdown language + lattice tag/wiki decorations + wrap. */
export function latticeEditorExtensions() {
  return [
    markdown({ base: markdownLanguage }),
    latticeDecorations,
    autocompletion({
      // Ours is the only source: CodeMirror's word-based default would suggest
      // arbitrary prose words, which is noise in a writing surface.
      override: [latticeCompletions],
      icons: false,
    }),
    EditorView.lineWrapping,
    placeholder("Start writing…"),
    EditorView.theme({
      "&": { backgroundColor: "transparent", height: "100%" },
      ".cm-scroller": { fontFamily: "var(--font-mono)" },
      ".cm-placeholder": { color: "var(--faint)" },
    }),
  ];
}
