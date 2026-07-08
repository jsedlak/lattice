/**
 * COPIED VERBATIM (minus this header) from the Lattice web monorepo:
 * packages/graph/src/parse.ts. PARITY-CRITICAL — the regexes define what a
 * tag/wiki-link IS; desktop and web must agree or they build different graphs
 * from the same markdown. Do not modify without changing both.
 */

// A tag: `#` immediately followed by a letter, then word chars / hyphens.
// The `#` must be at start-of-string or preceded by whitespace or `(` so we
// don't match markdown headings (`# Title` has a space) or `foo#bar`.
const TAG_RE = /(?:^|[\s(])#([a-zA-Z][\w-]*)/g;

// A wiki-link: [[Target]] or [[Target|alias]]. Captures the inner text.
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

export interface ParsedLinks {
  /** Lower-cased, de-duplicated tag labels (without the leading `#`). */
  tags: string[];
  /** De-duplicated wiki-link targets (the part before any `|`), trimmed. */
  wikiLinks: string[];
}

export function parseLinks(markdown: string): ParsedLinks {
  const tags = new Set<string>();
  const wikiLinks = new Set<string>();

  for (const m of markdown.matchAll(TAG_RE)) {
    if (m[1]) tags.add(m[1].toLowerCase());
  }
  for (const m of markdown.matchAll(WIKILINK_RE)) {
    const inner = m[1];
    if (!inner) continue;
    const target = (inner.split("|")[0] ?? "").trim();
    if (target) wikiLinks.add(target);
  }

  return { tags: [...tags], wikiLinks: [...wikiLinks] };
}

/** Token positions for editor decoration. Returns ranges into the source. */
export interface LinkToken {
  type: "tag" | "wikilink";
  from: number;
  to: number;
  value: string;
}

export function tokenizeLinks(markdown: string): LinkToken[] {
  const tokens: LinkToken[] = [];
  for (const m of markdown.matchAll(TAG_RE)) {
    const value = m[1]!;
    // m.index points at the boundary char; the `#` is at the start of the tag.
    const hashIndex = markdown.indexOf("#" + value, m.index);
    tokens.push({ type: "tag", from: hashIndex, to: hashIndex + value.length + 1, value });
  }
  for (const m of markdown.matchAll(WIKILINK_RE)) {
    tokens.push({
      type: "wikilink",
      from: m.index!,
      to: m.index! + m[0].length,
      value: (m[1]!.split("|")[0] ?? "").trim(),
    });
  }
  return tokens.sort((a, b) => a.from - b.from);
}
