/**
 * Provider factory — the desktop analogue of packages/ai/src/providers.ts.
 * The model is named in exactly one place: the user's settings. All HTTP goes
 * through the Tauri http plugin's fetch (Rust reqwest), which is CORS-free —
 * required for direct browser-context calls to provider APIs.
 *
 * Provider kinds:
 *  - gateway            Vercel AI Gateway ("provider/model" slugs) — web parity
 *  - openai             api.openai.com via the OpenAI-compatible provider
 *  - anthropic          api.anthropic.com's OpenAI-compatible endpoint
 *  - openai-compatible  any base URL: Ollama, LM Studio, llama.cpp, vLLM…
 */
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type { EndpointConfig } from "@/lib/types";

const BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

function compatProvider(config: EndpointConfig, apiKey: string | null) {
  const baseURL = config.kind === "openai-compatible" ? config.baseUrl! : BASE_URLS[config.kind]!;
  return createOpenAICompatible({
    name: config.kind,
    baseURL,
    apiKey: apiKey ?? undefined,
    fetch: tauriFetch as typeof globalThis.fetch,
  });
}

export function languageModelFor(config: EndpointConfig, apiKey: string | null) {
  if (config.kind === "gateway") {
    return createGateway({
      apiKey: apiKey ?? undefined,
      fetch: tauriFetch as typeof globalThis.fetch,
    }).languageModel(config.model);
  }
  return compatProvider(config, apiKey).chatModel(config.model);
}

export function embeddingModelFor(config: EndpointConfig, apiKey: string | null) {
  if (config.kind === "gateway") {
    return createGateway({
      apiKey: apiKey ?? undefined,
      fetch: tauriFetch as typeof globalThis.fetch,
    }).embeddingModel(config.model);
  }
  return compatProvider(config, apiKey).embeddingModel(config.model);
}
