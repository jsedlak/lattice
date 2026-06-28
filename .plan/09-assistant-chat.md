# Phase 09 — AI Assistant (Chat)

The payoff: a streaming chat assistant that answers from the user's knowledge graph and **cites its sources**. Design priority #2 — answers must feel trustworthy and traceable. Retrieval is **hybrid**: graph-traversal tools + pgvector semantic search, exposed to the model as tools (not dumped into context).

## Deliverables

1. Chat route handler using Vercel AI SDK streaming + tool calling (Anthropic default).
2. Retrieval tools in `@lattice/ai`: `searchNodes`, `getNeighbors`, `traverse`, `semanticSearch`.
3. Citations: assistant messages carry source references rendered as clickable chips.
4. Conversation history (list, resume, per-session messages) persisted.
5. Chat UI: message stream, streaming state, citation affordances, empty state.
6. "Ask assistant" entry points from editor + blob detail pass context.

## Provider factory (`@lattice/ai`)

```ts
import { anthropic } from "@ai-sdk/anthropic";
export function chatModel() {
  switch (process.env.CHAT_PROVIDER) {
    case "anthropic": return anthropic(process.env.CHAT_MODEL ?? "claude-opus-4-8");
    // case "openai": return openai(process.env.CHAT_MODEL ?? "gpt-...");
    default: throw new Error("Unknown CHAT_PROVIDER");
  }
}
```
Same factory powers LLM extraction (`07`) and chat — one place to swap providers.

## Retrieval tools

Defined with the AI SDK `tool()` helper; each re-scopes to the session `userId` (closed over server-side — never a tool arg the model controls):

```ts
import { tool } from "ai";
import { z } from "zod";

export function graphTools(userId: string) {
  return {
    semanticSearch: tool({
      description: "Find the most relevant note/document chunks by meaning.",
      parameters: z.object({ query: z.string(), k: z.number().max(12).default(6) }),
      execute: async ({ query, k }) => {
        const [embedding] = await embedChunks([query]);
        return cosineSearchChunks(userId, embedding, k); // -> [{ chunkId, documentId, title, snippet, score }]
      },
    }),
    searchNodes: tool({
      description: "Search graph nodes (documents, tags, entities) by label.",
      parameters: z.object({ q: z.string(), type: z.enum(["document","tag","entity"]).optional() }),
      execute: ({ q, type }) => searchNodes(userId, q, type),
    }),
    getNeighbors: tool({
      description: "Get the 1-hop neighbors of a node.",
      parameters: z.object({ nodeId: z.string() }),
      execute: ({ nodeId }) => getNeighbors(userId, nodeId),
    }),
    traverse: tool({
      description: "Find a path / multi-hop connections between two nodes.",
      parameters: z.object({ fromNodeId: z.string(), toNodeId: z.string(), maxHops: z.number().max(4).default(3) }),
      execute: ({ fromNodeId, toNodeId, maxHops }) => traverse(userId, fromNodeId, toNodeId, maxHops),
    }),
  };
}
```

## Chat route handler

`app/api/chat/route.ts`
```ts
import { streamText } from "ai";
import { chatModel, graphTools } from "@lattice/ai";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { messages, conversationId } = await req.json();

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,           // "answer ONLY from retrieved sources; cite them; say when unknown"
    messages,
    tools: graphTools(user.id),
    maxSteps: 6,                     // allow tool → reason → tool loops
    onFinish: async ({ text, toolResults }) => {
      // derive citations from the chunks/nodes the tools returned and were used;
      // persist user + assistant messages with citations jsonb
      await persistTurn(user.id, conversationId, messages, text, toCitations(toolResults));
    },
  });

  return result.toDataStreamResponse();
}
```

### System prompt principles
- Answer **only** from retrieved sources; if the graph lacks the answer, say so — don't fabricate.
- Always cite: every claim ties back to a document/chunk/node the tools surfaced.
- Prefer `semanticSearch` for "what do I know about X", graph tools (`getNeighbors`/`traverse`) for "how are X and Y connected".

## Citations

- Tool results carry `{ documentId, chunkId?, nodeId?, title, snippet }`. After the turn, map the sources actually used into `message.citations` (jsonb).
- UI renders them as **citation chips** under the assistant message — clicking opens the source document (editor) or focuses the node (graph). This is a prominent, first-class affordance, not a footnote (per the design brief).

## Chat UI

`app/(app)/assistant/...` (also dockable beside the editor — the "Ask assistant" button):
- Streaming message list (text appears as generated); distinct user/assistant styling.
- A subtle "thinking / searching your notes…" state while tools run (surface which tool ran if cheap to show).
- Citation chips per assistant message → click-through.
- Conversation history: list past conversations (`conversation` table), resume one, start new. Auto-title from the first user message.
- Empty state: suggested prompts grounded in the user's actual docs ("Summarize Project Atlas", "How do embeddings relate to retrieval?").
- **Context hand-off:** "Ask assistant" from a document seeds the conversation with that document's node as focus (e.g., pre-load `getNeighbors` or pin the doc in the system context).

## Done when

- Asking a question streams a grounded answer that cites real documents; clicking a citation opens the source.
- "How are X and Y connected?" triggers graph traversal and explains the path.
- A question with no supporting notes yields an honest "I don't have anything on that" rather than a hallucination.
- Conversations persist, list, and resume; titles auto-generate.
- Switching `CHAT_PROVIDER` env swaps the model without code changes.

## Notes

- `userId` is closed over in the tool factory — the model can never query another user's graph.
- Cap `k` and `maxSteps` to bound cost/latency; the tools already cap their params.
- Keep retrieval as tools (not stuffed context) so the model fetches only what it needs and citations map cleanly to what was used.
