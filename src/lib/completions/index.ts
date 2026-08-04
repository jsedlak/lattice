/**
 * Editor-agnostic completion core.
 *
 * Monaco and CodeMirror are both user-selectable (`AppSettings.editor`), so all
 * of the actual logic — what context the cursor is in, what to offer, what to
 * insert — lives here against plain `(text, offset)`. The adapters in
 * `codemirror-lattice.ts` and `MonacoMarkdown.tsx` only translate this shape
 * into their editor's API.
 *
 * Trigger contexts, all anchored to the text immediately before the cursor:
 *
 *   #tag        after `#` at a word boundary (same boundary rule as parseLinks)
 *   [[wiki]]    inside an unclosed `[[`
 *   ](path)     inside an unclosed `](` — workspace files
 *   /slash      a `/` at the start of an otherwise-empty line — block snippets
 *   explicit    Ctrl+Space anywhere — the same snippet catalog
 */
import { filterSnippets, type Snippet } from "./snippets";
import { documentTitles, tagLabels, workspaceFiles } from "./sources";

export { invalidateCompletionCaches } from "./sources";

export type CompletionKind = "tag" | "wikilink" | "path" | "snippet";

export interface LatticeCompletion {
  /** Shown in the list, and what filtering matches against. */
  label: string;
  detail?: string;
  kind: CompletionKind;
  /** Text replacing [from, offset). `$0`, if present, is the cursor stop. */
  insert: string;
}

export interface CompletionResult {
  /** Offset where the replacement starts. */
  from: number;
  items: LatticeCompletion[];
  /** True for explicit-invoke results, which shouldn't auto-filter to nothing. */
  explicit?: boolean;
  /**
   * A trigger character included in the replaced range but absent from every
   * label — currently only the slash menu's `/`.
   *
   * Both editors re-filter our items against the text between `from` and the
   * cursor, so without this the slash menu filters itself to nothing the
   * moment you type (`/ta` never matches the label `Table`). Items are already
   * filtered here, so the adapters use it to keep their own filter honest.
   */
  filterPrefix?: string;
}

// `#` must start the line or follow whitespace/`(` — matching parse.ts's
// TAG_RE, so we never offer a tag where one wouldn't actually parse.
const TAG_CTX = /(?:^|[\s(])#([a-zA-Z][\w-]*)?$/;
const WIKI_CTX = /\[\[([^\]\n]*)$/;
const PATH_CTX = /\]\(([^)\n]*)$/;
const SLASH_CTX = /(?:^|\n)\s*\/(\w*)$/;

const snippetItems = (snippets: Snippet[]): LatticeCompletion[] =>
  snippets.map((s) => ({ label: s.label, detail: s.detail, kind: "snippet", insert: s.insert }));

/**
 * Completions for the cursor, or null when it isn't in a completable spot.
 *
 * `before` is the document text up to the cursor — deliberately not the whole
 * document, since every trigger is a look-behind and both editors can hand us
 * a prefix slice without copying the full buffer on each keystroke. Its length
 * is therefore the cursor offset, which is what the returned `from` is
 * measured against. `explicit` is set when the user asked for completions
 * directly (Ctrl+Space), which offers the snippet catalog anywhere.
 */
export async function completeAt(
  before: string,
  explicit = false,
): Promise<CompletionResult | null> {
  const offset = before.length;

  const wiki = WIKI_CTX.exec(before);
  if (wiki) {
    const query = wiki[1]!.toLowerCase();
    const titles = await documentTitles();
    return {
      from: offset - wiki[1]!.length,
      items: titles
        .filter((t) => t.toLowerCase().includes(query))
        .slice(0, 50)
        .map((title) => ({ label: title, kind: "wikilink", detail: "note", insert: title })),
    };
  }

  const path = PATH_CTX.exec(before);
  if (path) {
    const query = path[1]!.toLowerCase();
    const files = await workspaceFiles();
    return {
      from: offset - path[1]!.length,
      items: files
        .filter((f) => f.toLowerCase().includes(query))
        .slice(0, 50)
        .map((file) => ({ label: file, kind: "path", detail: "file", insert: file })),
    };
  }

  const tag = TAG_CTX.exec(before);
  if (tag) {
    const query = tag[1] ?? "";
    const labels = await tagLabels(query);
    return {
      // Replace the tag body only; the `#` stays put.
      from: offset - query.length,
      items: labels.map((label) => ({ label, kind: "tag", detail: "tag", insert: label })),
    };
  }

  const slash = SLASH_CTX.exec(before);
  if (slash) {
    const query = slash[1] ?? "";
    return {
      // Replace the `/` too — it's a trigger, not part of the document.
      from: offset - query.length - 1,
      items: snippetItems(filterSnippets(query)),
      filterPrefix: "/",
    };
  }

  if (explicit) {
    // Ctrl+Space mid-prose: offer the catalog, replacing the word in progress
    // so typing "tab" then invoking can complete to the table snippet.
    const word = /([A-Za-z]*)$/.exec(before)![1]!;
    return {
      from: offset - word.length,
      items: snippetItems(filterSnippets(word)),
      explicit: true,
    };
  }

  return null;
}

/**
 * Split an insert string on its `$0` cursor marker.
 * Returns the literal text and where the cursor should land within it.
 */
export function applyCursorMarker(insert: string): { text: string; cursor: number } {
  const at = insert.indexOf("$0");
  if (at === -1) return { text: insert, cursor: insert.length };
  return { text: insert.slice(0, at) + insert.slice(at + 2), cursor: at };
}
