import { getDocument, listConversations } from "@lattice/db";
import type { Metadata } from "next";
import { Chat } from "@/components/assistant/chat";
import { ConversationList } from "@/components/assistant/conversation-list";
import { defaultModelId, modelOptions } from "@/lib/assistant-config";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const conversations = await listConversations(user.id);

  let docContext: { id: string; title: string } | undefined;
  if (sp.doc) {
    const d = await getDocument(user.id, sp.doc);
    if (d) docContext = { id: d.id, title: d.title };
  }

  return (
    <div className="flex h-full">
      <ConversationList conversations={conversations} />
      <Chat docContext={docContext} models={modelOptions()} initialModel={defaultModelId()} />
    </div>
  );
}
