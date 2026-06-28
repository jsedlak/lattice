import type { Citation } from "@lattice/db";

/**
 * Derive citations from the tool results of a chat turn. We cite documents the
 * model actually retrieved from: semanticSearch chunk hits, plus document nodes
 * surfaced by searchNodes / getNeighbors. Deduped by document/chunk/node id.
 *
 * Shape is intentionally permissive (`unknown`) because tool results are typed
 * loosely across AI SDK versions — we narrow defensively.
 */
interface ToolResultLike {
  toolName?: string;
  // AI SDK v5+ uses `output`; older shapes used `result`. Read either.
  output?: unknown;
  result?: unknown;
}
interface StepLike {
  toolResults?: ToolResultLike[];
}

export function toCitations(steps: StepLike[] | undefined): Citation[] {
  if (!steps) return [];
  const out: Citation[] = [];
  const seen = new Set<string>();

  const push = (c: Citation) => {
    const key = c.chunkId ?? c.documentId ?? c.nodeId ?? c.label;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  for (const step of steps) {
    for (const tr of step.toolResults ?? []) {
      const result = tr.output ?? tr.result;
      if (!Array.isArray(result)) continue;

      if (tr.toolName === "semanticSearch") {
        for (const hit of result as Record<string, unknown>[]) {
          if (typeof hit?.documentId === "string") {
            push({
              label: typeof hit.title === "string" ? hit.title : "Document",
              documentId: hit.documentId,
              chunkId: typeof hit.chunkId === "string" ? hit.chunkId : undefined,
              snippet: typeof hit.snippet === "string" ? hit.snippet : undefined,
            });
          }
        }
      }

      if (tr.toolName === "searchNodes") {
        for (const n of result as Record<string, unknown>[]) {
          if (typeof n?.documentId === "string" && n.documentId) {
            push({
              label: typeof n.label === "string" ? n.label : "Document",
              documentId: n.documentId,
              nodeId: typeof n.nodeId === "string" ? n.nodeId : undefined,
            });
          }
        }
      }

      if (tr.toolName === "getNeighbors") {
        for (const nb of result as Record<string, unknown>[]) {
          const node = nb?.node as Record<string, unknown> | undefined;
          if (node && typeof node.documentId === "string" && node.documentId) {
            push({
              label: typeof node.label === "string" ? node.label : "Document",
              documentId: node.documentId,
              nodeId: typeof node.id === "string" ? node.id : undefined,
            });
          }
        }
      }
    }
  }

  return out;
}
