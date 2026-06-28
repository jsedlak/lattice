import type { UIMessage } from "ai";
import { getConversation, getMessages, listConversations, type Citation } from "@lattice/db";
import { notFound } from "next/navigation";
import { Chat } from "@/components/assistant/chat";
import { ConversationList } from "@/components/assistant/conversation-list";
import { defaultModelId, modelOptions } from "@/lib/assistant-config";
import { requireUser } from "@/lib/session";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const conversation = await getConversation(user.id, id);
  if (!conversation) notFound();

  const [conversations, messages] = await Promise.all([
    listConversations(user.id),
    getMessages(user.id, id),
  ]);

  const initialMessages = messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
    metadata: {
      citations: (m.citations as Citation[] | null) ?? undefined,
      createdAt: m.createdAt.toISOString(),
    },
  })) as UIMessage[];

  return (
    <div className="flex h-full">
      <ConversationList conversations={conversations} />
      <Chat
        conversationId={id}
        initialMessages={initialMessages}
        models={modelOptions()}
        initialModel={conversation.model ?? defaultModelId()}
      />
    </div>
  );
}
