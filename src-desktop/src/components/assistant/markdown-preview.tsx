/**
 * Markdown renderer for assistant messages — ported from
 * apps/web/src/components/markdown-preview.tsx (+ the web's remark-lattice
 * plugin, inlined below since it is dependency-free).
 *
 * Deviations from the web version:
 * - No rehype-raw / rehype-sanitize (not in the desktop dependency set), so
 *   embedded HTML renders as literal text instead of markup. That is safe by
 *   default and irrelevant for model output.
 * - Wiki-links navigate with react-router instead of next/link.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui";

// ── remark-lattice (copied from apps/web/src/lib/remark-lattice.ts) ──────────
// Turns `#tags` and `[[wiki-links]]` in markdown text nodes into special link
// nodes the preview renders as colored chips / internal links. Skips code
// (code/inlineCode are leaf nodes we never recurse into).

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const PATTERN = /(#[a-zA-Z][\w-]*)|(\[\[[^\]]+?\]\])/g;

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
    const token = m[0];
    if (token.startsWith("#")) {
      out.push({
        type: "link",
        url: `lattice-tag:${token.slice(1)}`,
        children: [{ type: "text", value: token }],
      });
    } else {
      const inner = token.slice(2, -2);
      const target = (inner.split("|")[0] ?? "").trim();
      const display = (inner.split("|")[1] ?? target).trim();
      out.push({
        type: "link",
        url: `lattice-wiki:${encodeURIComponent(target)}`,
        children: [{ type: "text", value: display }],
      });
    }
    last = idx + token.length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && PATTERN.test(child.value)) {
      PATTERN.lastIndex = 0;
      next.push(...splitText(child.value));
    } else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

function remarkLattice() {
  return (tree: MdNode) => {
    transform(tree);
  };
}

// ── Renderer ─────────────────────────────────────────────────────────────────

const components: Components = {
  a({ href, children, ...props }) {
    if (href?.startsWith("lattice-tag:")) {
      return <Badge concept="tag">{children}</Badge>;
    }
    if (href?.startsWith("lattice-wiki:")) {
      const target = decodeURIComponent(href.slice("lattice-wiki:".length));
      return (
        <Link
          to={`/editor?title=${encodeURIComponent(target)}`}
          className="font-medium text-graph-link hover:underline"
        >
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkLattice]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
