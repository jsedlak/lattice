/**
 * The markdown block catalog, shared by the slash menu and explicit-invoke
 * completion. `$0` marks where the cursor lands after insertion — the one
 * placeholder syntax both editor adapters understand (Monaco natively,
 * CodeMirror via a small splice in the adapter).
 */
export interface Snippet {
  /** What the user types to match — also the list label. */
  label: string;
  detail: string;
  /** Insert text; `$0` is the resulting cursor position (defaults to the end). */
  insert: string;
  /** Extra words that should match this snippet in a filter. */
  keywords?: string[];
}

export const SNIPPETS: Snippet[] = [
  { label: "Heading 1", detail: "# ", insert: "# $0", keywords: ["h1", "title", "#"] },
  { label: "Heading 2", detail: "## ", insert: "## $0", keywords: ["h2", "##"] },
  { label: "Heading 3", detail: "### ", insert: "### $0", keywords: ["h3", "###"] },
  { label: "Bullet list", detail: "- item", insert: "- $0", keywords: ["ul", "unordered", "-"] },
  {
    label: "Numbered list",
    detail: "1. item",
    insert: "1. $0",
    keywords: ["ol", "ordered", "number"],
  },
  { label: "Task", detail: "- [ ] todo", insert: "- [ ] $0", keywords: ["todo", "checkbox"] },
  { label: "Quote", detail: "> quote", insert: "> $0", keywords: ["blockquote", ">"] },
  {
    label: "Code block",
    detail: "``` fenced ```",
    insert: "```$0\n\n```",
    keywords: ["fence", "pre", "```"],
  },
  {
    label: "Table",
    detail: "2-column table",
    insert: "| $0 |  |\n| --- | --- |\n|  |  |",
    keywords: ["grid"],
  },
  { label: "Divider", detail: "horizontal rule", insert: "---\n$0", keywords: ["hr", "rule"] },
  { label: "Link", detail: "[text](url)", insert: "[$0]()", keywords: ["url", "href"] },
  { label: "Image", detail: "![alt](path)", insert: "![$0]()", keywords: ["img", "picture"] },
  { label: "Bold", detail: "**bold**", insert: "**$0**", keywords: ["strong"] },
  { label: "Italic", detail: "_italic_", insert: "_$0_", keywords: ["em"] },
  { label: "Inline code", detail: "`code`", insert: "`$0`", keywords: ["mono"] },
  { label: "Wiki-link", detail: "[[Note]]", insert: "[[$0]]", keywords: ["link", "note"] },
];

/** Case-insensitive match over label + keywords. Empty query matches all. */
export function filterSnippets(query: string): Snippet[] {
  const q = query.trim().toLowerCase();
  if (!q) return SNIPPETS;
  return SNIPPETS.filter(
    (s) =>
      s.label.toLowerCase().includes(q) || s.keywords?.some((k) => k.toLowerCase().includes(q)),
  );
}
