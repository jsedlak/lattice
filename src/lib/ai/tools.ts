/**
 * Retrieval tools given to the chat model. Ported from packages/ai/src/tools.ts
 * — tool names, descriptions, and schemas kept verbatim so prompt behavior
 * carries over; execution goes through Tauri IPC instead of @lattice/db.
 * (The web closes userId over these; single-user desktop has no userId.)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import * as ipc from "@/lib/ipc";
import { embedOne } from "./embeddings";
import { getEmbeddingKit } from "./settings";

export function graphTools(): ToolSet {
  return {
    semanticSearch: tool({
      description:
        "Find the most relevant note/document chunks by meaning. Use for 'what do I know about X' style questions.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language search query"),
        k: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ query, k }) => {
        const kit = await getEmbeddingKit();
        if (!kit) {
          return { error: "Semantic search unavailable: no embedding model configured." };
        }
        const embedding = await embedOne(query);
        const hits = await ipc.cosineSearchChunks(embedding, kit.dimensions, k);
        // Shape matches the web tool result (title/snippet keys) — toCitations
        // and the model's citing behavior depend on it.
        return hits.map((h) => ({
          chunkId: h.chunkId,
          documentId: h.documentId,
          title: h.documentTitle,
          snippet: h.content.length > 280 ? `${h.content.slice(0, 280)}…` : h.content,
          content: h.content,
          score: h.score,
        }));
      },
    }),

    searchNodes: tool({
      description:
        "Search graph nodes (documents, tags, entities) by label. Returns node ids usable with getNeighbors/traverse.",
      inputSchema: z.object({
        q: z.string(),
        type: z.enum(["document", "tag", "entity"]).optional(),
      }),
      execute: async ({ q, type }) => {
        const nodes = await ipc.searchNodes(q, type);
        return nodes.map((n) => ({
          nodeId: n.id,
          type: n.type,
          label: n.label,
          documentId: n.documentId,
        }));
      },
    }),

    getNeighbors: tool({
      description: "Get the 1-hop neighbors of a graph node by id.",
      inputSchema: z.object({ nodeId: z.string() }),
      // Web parity: an array of {node, relation, …} — toCitations reads it.
      execute: async ({ nodeId }) => {
        const hood = await ipc.getNeighbors(nodeId);
        return hood?.neighbors ?? [];
      },
    }),

    traverse: tool({
      description:
        "Find a path / multi-hop connection between two graph nodes. Use for 'how are X and Y connected' questions.",
      inputSchema: z.object({
        fromNodeId: z.string(),
        toNodeId: z.string(),
        maxHops: z.number().int().min(1).max(4).default(3),
      }),
      execute: async ({ fromNodeId, toNodeId, maxHops }) =>
        ipc.traverse(fromNodeId, toNodeId, maxHops),
    }),
  };
}
