import { CHAT_SYSTEM_PROMPT, chatModel, graphTools, toCitations } from "@lattice/ai";
import {
  addMessage,
  type Citation,
  createConversation,
  getConversation,
  renameConversation,
  setConversationModel,
} from "@lattice/db";
import { type UIMessage, convertToModelMessages, stepCountIs, streamText } from "ai";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  conversationId?: string;
  docId?: string;
  model?: string;
}

function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return (message.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { messages, conversationId, model } = (await req.json()) as ChatBody;

  // Resolve / create the conversation (validate ownership) and the model.
  let conv = conversationId ? await getConversation(user.id, conversationId) : null;
  if (!conv) conv = await createConversation(user.id, "New conversation", model);
  else if (model && model !== conv.model) await setConversationModel(user.id, conv.id, model);
  const activeConvId = conv.id;
  const effectiveModel = model ?? conv.model ?? undefined;

  const lastUserText = textOf([...messages].reverse().find((m) => m.role === "user"));
  const modelMessages = await convertToModelMessages(messages);

  // Citations are computed in onFinish and surfaced to the client as message
  // metadata (live), as well as persisted to the DB (resume).
  let citations: Citation[] = [];

  const result = streamText({
    model: chatModel(effectiveModel),
    system: CHAT_SYSTEM_PROMPT,
    messages: modelMessages,
    tools: graphTools(user.id),
    stopWhen: stepCountIs(6), // allow tool → reason → tool loops
    onFinish: async ({ steps, text }) => {
      citations = toCitations(steps);
      try {
        if (lastUserText) await addMessage(user.id, activeConvId, "user", lastUserText);
        await addMessage(user.id, activeConvId, "assistant", text, citations);
        const conv = await getConversation(user.id, activeConvId);
        if (conv && conv.title === "New conversation" && lastUserText) {
          await renameConversation(user.id, activeConvId, lastUserText.slice(0, 60));
        }
      } catch (err) {
        console.error("[chat] persist failed", err);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) =>
      part.type === "finish" ? { citations, conversationId: activeConvId } : undefined,
  });
}
