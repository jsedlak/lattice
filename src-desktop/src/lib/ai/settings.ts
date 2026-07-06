/**
 * In-app AI configuration (replaces the web app's env vars). Non-secret
 * settings live in settings.json via the Rust core; API keys live in the OS
 * keychain. Small in-memory cache so hot paths (chat, ingest) don't hit IPC
 * for every call — invalidated on save.
 */
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EndpointConfig,
  type ProviderKind,
  type SecretName,
} from "@/lib/types";
import * as ipc from "@/lib/ipc";

interface Loaded {
  settings: AppSettings;
  chatApiKey: string | null;
  embeddingApiKey: string | null;
}

let cache: Loaded | null = null;

export function invalidateAiSettings(): void {
  cache = null;
}

async function load(): Promise<Loaded> {
  if (cache) return cache;
  const [raw, chatApiKey, embeddingApiKey] = await Promise.all([
    ipc.getSettings(),
    ipc.getSecret("chat-api-key"),
    ipc.getSecret("embedding-api-key"),
  ]);
  const settings: AppSettings = {
    chat: { ...DEFAULT_SETTINGS.chat, ...(raw?.chat ?? {}) },
    embedding: { ...DEFAULT_SETTINGS.embedding, ...(raw?.embedding ?? {}) },
    editor: raw?.editor === "codemirror" ? "codemirror" : DEFAULT_SETTINGS.editor,
  };
  cache = { settings, chatApiKey, embeddingApiKey };
  return cache;
}

export async function loadSettings(): Promise<AppSettings> {
  return (await load()).settings;
}

export async function saveSettings(
  settings: AppSettings,
  secrets: Partial<Record<SecretName, string>>,
): Promise<void> {
  await ipc.setSettings(settings);
  for (const [name, value] of Object.entries(secrets)) {
    if (value === undefined) continue;
    if (value === "") await ipc.deleteSecret(name as SecretName);
    else await ipc.setSecret(name as SecretName, value);
  }
  invalidateAiSettings();
}

/** openai-compatible endpoints (Ollama, LM Studio, llama.cpp) may be keyless. */
export function requiresApiKey(kind: ProviderKind): boolean {
  return kind !== "openai-compatible";
}

function endpointReady(config: EndpointConfig, apiKey: string | null): boolean {
  if (!config.model.trim()) return false;
  if (config.kind === "openai-compatible" && !config.baseUrl?.trim()) return false;
  if (requiresApiKey(config.kind) && !apiKey) return false;
  return true;
}

export interface ChatKit {
  config: EndpointConfig;
  apiKey: string | null;
}

/** Chat endpoint config + key, or null when not usable yet. */
export async function getChatKit(): Promise<ChatKit | null> {
  const { settings, chatApiKey } = await load();
  return endpointReady(settings.chat, chatApiKey)
    ? { config: settings.chat, apiKey: chatApiKey }
    : null;
}

export interface EmbeddingKit {
  config: EndpointConfig;
  apiKey: string | null;
  dimensions: number;
}

export async function getEmbeddingKit(): Promise<EmbeddingKit | null> {
  const { settings, embeddingApiKey } = await load();
  return endpointReady(settings.embedding, embeddingApiKey)
    ? {
        config: settings.embedding,
        apiKey: embeddingApiKey,
        dimensions: settings.embedding.dimensions,
      }
    : null;
}

/** Summary consumed by the assistant screen. */
export async function loadAiSettings(): Promise<{ ready: boolean; chatModelLabel: string }> {
  const { settings, chatApiKey } = await load();
  return {
    ready: endpointReady(settings.chat, chatApiKey),
    chatModelLabel: settings.chat.model || "no model",
  };
}
