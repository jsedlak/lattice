/**
 * Client-side chat: the desktop analogue of the web app's /api/chat route
 * handler. useChat hands us the UI messages; we run streamText in-page against
 * the configured provider with the graph tools, persist both sides of the
 * exchange to SQLite, and attach citations as finish-message metadata exactly
 * like the web server does (toUIMessageStreamResponse messageMetadata).
 */
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import * as ipc from "@/lib/ipc";
import type { Citation } from "@/lib/types";
import { toCitations } from "./citations";
import { CHAT_SYSTEM_PROMPT } from "./prompts";
import { languageModelFor } from "./providers";
import { getChatKit } from "./settings";
import { graphTools } from "./tools";

export type LatticeMetadata = { citations?: Citation[] };
export type LatticeUIMessage = UIMessage<LatticeMetadata>;

function textOf(message: LatticeUIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export class LocalChatTransport implements ChatTransport<LatticeUIMessage> {
  constructor(private readonly opts: { conversationId: string }) {}

  async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: LatticeUIMessage[];
    abortSignal: AbortSignal | undefined;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const kit = await getChatKit();
    if (!kit) throw new Error("No chat model configured — set one in Settings.");

    const last = options.messages.at(-1);
    if (options.trigger === "submit-message" && last?.role === "user") {
      await ipc.appendMessage(this.opts.conversationId, "user", textOf(last));
    }

    let citations: Citation[] = [];
    const conversationId = this.opts.conversationId;

    const result = streamText({
      model: languageModelFor(kit.config, kit.apiKey),
      system: CHAT_SYSTEM_PROMPT,
      messages: await convertToModelMessages(options.messages),
      tools: graphTools(),
      stopWhen: stepCountIs(6),
      abortSignal: options.abortSignal,
      onFinish: async ({ steps, text }) => {
        citations = toCitations(steps);
        await ipc.appendMessage(
          conversationId,
          "assistant",
          text,
          citations.length > 0 ? citations : null,
        );
      },
    });

    return result.toUIMessageStream({
      messageMetadata: ({ part }): LatticeMetadata | undefined =>
        part.type === "finish" ? { citations } : undefined,
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Local streams can't outlive the page; nothing to reconnect to.
    return null;
  }
}
