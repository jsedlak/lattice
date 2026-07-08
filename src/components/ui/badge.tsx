import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Concept badges. The graph taxonomy colors (tag=green, entity=orange,
 * link/wikilink=purple, doc=blue) read the SAME everywhere — editor chips,
 * preview, graph legend, citations. Uses translucent backgrounds over the
 * concept color so it works in both themes.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5  font-medium font-mono",
  {
    variants: {
      concept: {
        neutral: "bg-surface-raised text-muted",
        tag: "bg-graph-tag/15 text-graph-tag",
        entity: "bg-graph-entity/15 text-graph-entity",
        wikilink: "bg-graph-link/15 text-graph-link",
        doc: "bg-graph-doc/15 text-graph-doc",
        citation: "bg-graph-citation/15 text-graph-citation",
      },
    },
    defaultVariants: { concept: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, concept, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ concept }), className)} {...props} />;
}

export { badgeVariants };
