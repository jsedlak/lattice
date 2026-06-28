"use client";

import { Badge } from "@lattice/ui";
import Link from "next/link";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkLattice } from "@/lib/remark-lattice";

// Allow embedded HTML in notes/uploads but sanitize it (drops <script>, event
// handlers, javascript: URLs, iframes, etc.). We extend GitHub's default schema
// to keep our own `lattice-tag:` / `lattice-wiki:` link protocols and common
// presentational attributes (align, width/height on images).
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "lattice-tag", "lattice-wiki"],
  },
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align", "className"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height", "align"],
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
          href={`/editor?title=${encodeURIComponent(target)}`}
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
        // Order matters: parse raw HTML → sanitize it → then add (trusted)
        // syntax-highlight classes so they aren't stripped by the sanitizer.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
