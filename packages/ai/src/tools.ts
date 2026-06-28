import { cosineSearchChunks, getNeighbors, searchNodes, traverse } from "@lattice/db";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { embedOne } from "./embeddings";

/**
 * Retrieval tools given to the chat model. `userId` is closed over here on the
 * server — it is NEVER a tool argument the model controls, so the model can
 * never reach another user's graph. Hybrid retrieval: semantic (pgvector) +
 * graph traversal.
 */
export function graphTools(userId: string): ToolSet {
  return {
    semanticSearch: tool({
      description:
        "Find the most relevant note/document chunks by meaning. Use for 'what do I know about X' style questions.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language search query"),
        k: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ query, k }) => {
        const embedding = await embedOne(query);
        return cosineSearchChunks(userId, embedding, k);
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
        const nodes = await searchNodes(userId, q, type);
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
      execute: async ({ nodeId }) => getNeighbors(userId, nodeId),
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
        traverse(userId, fromNodeId, toNodeId, maxHops),
    }),
  };
}

export type GraphTools = ReturnType<typeof graphTools>;
