import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import {
  Decoration,
  type DecorationSet,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * CodeMirror decorations that make `#tags` (green) and `[[wiki-links]]` (purple)
 * visually distinct — the same taxonomy colors as the preview and graph. Uses
 * the same patterns as @lattice/graph parseLinks (kept intentionally in sync).
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

/** Editor extensions: markdown language + lattice tag/wiki decorations + wrap. */
export function latticeEditorExtensions() {
  return [
    markdown({ base: markdownLanguage }),
    latticeDecorations,
    EditorView.lineWrapping,
    EditorView.theme({
      "&": { backgroundColor: "transparent", height: "100%" },
      ".cm-scroller": { fontFamily: "var(--font-mono)" },
    }),
  ];
}
