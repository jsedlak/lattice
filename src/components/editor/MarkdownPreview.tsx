import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Badge } from "@/components/ui";
import { remarkLattice } from "./remark-lattice";

/**
 * Markdown preview with the lattice taxonomy renderers: `#tags` render as
 * green chips, `[[wiki-links]]` as purple internal links (routing to the
 * target note by title — the editor screen shows a create prompt when it
 * doesn't exist yet). Ported from the web app's markdown-preview.tsx.
 *
 * Embedded HTML renders (rehype-raw) but is sanitized first: the webview has
 * IPC access, so scripts/event handlers in a note or an ingested document
 * must never execute.
 */

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // README-style HTML: <p align="center">, sized <img width=...>.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // remarkLattice encodes tags/wikilinks as custom protocols; keep them.
    href: [...(defaultSchema.protocols?.href ?? []), "lattice-tag", "lattice-wiki"],
  },
};
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
    // External links: open in the system browser instead of the webview.
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) void openUrl(href);
        }}
        rel="noreferrer"
        {...props}
      >
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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
