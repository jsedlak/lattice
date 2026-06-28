import { gateway } from "@ai-sdk/gateway";
import { EMBEDDING_DIM } from "@lattice/db";
import type { EmbeddingModel, LanguageModel } from "ai";

/**
 * Provider factory — routes through the **Vercel AI Gateway**. One credential
 * (`AI_GATEWAY_API_KEY` locally; Vercel OIDC in production) reaches every
 * provider, so we don't manage separate Anthropic/OpenAI keys. The provider is
 * encoded in the model slug (`anthropic/…`, `openai/…`), configurable via env —
 * this is the ONLY place a model is named.
 */

export { EMBEDDING_DIM };

const DEFAULT_CHAT_MODEL = "anthropic/claude-opus-4-8";
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function chatModel(modelId?: string): LanguageModel {
  return gateway.languageModel(modelId ?? process.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL);
}

export function embeddingModel(): EmbeddingModel {
  return gateway.embeddingModel(process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL);
}
