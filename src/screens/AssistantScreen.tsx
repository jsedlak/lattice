/**
 * Assistant screen — ported from apps/web/app/(app)/assistant/page.tsx and
 * assistant/[id]/page.tsx. One component handles both routes:
 *   /assistant      → conversation list + new-chat empty state
 *   /assistant/:id  → conversation list + streaming chat for :id
 *
 * The web pages are server components (data via Drizzle + router.refresh());
 * here the same data comes from the Tauri ipc layer and re-fetches through the
 * `reload` callback the children invoke after mutations.
 */
import * as React from "react";
import { useParams } from "react-router-dom";

import { ConversationPane, NewChat, type AiInfo } from "@/components/assistant/chat";
import { ConversationList } from "@/components/assistant/conversation-list";
import { loadAiSettings } from "@/lib/ai/settings";
import { listConversations } from "@/lib/ipc";
import type { Conversation } from "@/lib/types";

export function AssistantScreen() {
  const { id } = useParams<{ id: string }>();
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [ai, setAi] = React.useState<AiInfo | null>(null);

  const reload = React.useCallback(() => {
    listConversations()
      .then(setConversations)
      .catch(() => {});
  }, []);

  React.useEffect(reload, [reload]);

  React.useEffect(() => {
    let cancelled = false;
    loadAiSettings()
      .then((s) => {
        if (!cancelled) setAi(s);
      })
      .catch(() => {
        if (!cancelled) setAi({ ready: false, chatModelLabel: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full">
      <ConversationList conversations={conversations} onChanged={reload} />
      {id ? (
        <ConversationPane
          key={id}
          conversationId={id}
          ai={ai}
          onConversationsChanged={reload}
        />
      ) : (
        <NewChat ai={ai} onConversationsChanged={reload} />
      )}
    </div>
  );
}
