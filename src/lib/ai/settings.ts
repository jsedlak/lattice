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
  type EndpointKind,
  type SecretName,
} from "@/lib/types";
import * as ipc from "@/lib/ipc";

interface Loaded {
  settings: AppSettings;
  /** Which secrets exist, recorded by the Rust core in settings.json. Reading
   *  this costs nothing; reading the values themselves unlocks the keychain. */
  present: Set<SecretName>;
}

/**
 * Both caches hold the in-flight promise rather than the resolved value, which
 * is the difference between one load and a stampede: boot resumes every pending
 * ingest job at once, and each asks for its chat and embedding kits. Caching
 * only the result let them all miss simultaneously and each issue their own
 * request — on macOS, one keychain prompt apiece.
 *
 * `cache` is settings.json (free). `secretCache` is the keychain (a password
 * prompt on first unlock), which is why the two are separate: rendering reads
 * the first, and only real work touches the second.
 */
let cache: Promise<Loaded> | null = null;
const secretCache = new Map<SecretName, Promise<string | null>>();

export function invalidateAiSettings(): void {
  cache = null;
  secretCache.clear();
}

function load(): Promise<Loaded> {
  if (!cache) {
    // A failed load must not be cached, or the app never recovers from a
    // transient IPC error without a restart.
    cache = read().catch((e) => {
      cache = null;
      throw e;
    });
  }
  return cache;
}

async function read(): Promise<Loaded> {
  const raw = await ipc.getSettings();
  const settings: AppSettings = {
    chat: { ...DEFAULT_SETTINGS.chat, ...(raw?.chat ?? {}) },
    embedding: { ...DEFAULT_SETTINGS.embedding, ...(raw?.embedding ?? {}) },
    editor: raw?.editor === "codemirror" ? "codemirror" : DEFAULT_SETTINGS.editor,
  };
  return { settings, present: new Set(raw?.secretsPresent ?? []) };
}

/**
 * Fetches a secret's value, which unlocks the OS keychain and can cost a
 * password prompt. Nothing that merely renders should call this — use
 * `Loaded.present` to know whether a key exists. Callers doing real work (an
 * API call, revealing a token) are the ones that belong here.
 *
 * The promise is cached, so concurrent callers share one unlock.
 */
function secret(name: SecretName): Promise<string | null> {
  let pending = secretCache.get(name);
  if (!pending) {
    pending = ipc.getSecret(name).catch((e) => {
      secretCache.delete(name);
      throw e;
    });
    secretCache.set(name, pending);
  }
  return pending;
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

/** openai-compatible endpoints (Ollama, LM Studio, llama.cpp) and the
 *  built-in local model are keyless. */
export function requiresApiKey(kind: EndpointKind): boolean {
  return kind !== "openai-compatible" && kind !== "local";
}

/** Readiness from configuration and key *presence* only — no keychain unlock. */
function endpointReady(config: EndpointConfig, keyPresent: boolean): boolean {
  if (config.kind === "local") return true; // built-in — nothing to configure
  if (!config.model.trim()) return false;
  if (config.kind === "openai-compatible" && !config.baseUrl?.trim()) return false;
  if (requiresApiKey(config.kind) && !keyPresent) return false;
  return true;
}

/** Whether a role's endpoint is usable, without reading the key itself. */
export async function isEndpointReady(role: "chat" | "embedding"): Promise<boolean> {
  const { settings, present } = await load();
  const name: SecretName = role === "chat" ? "chat-api-key" : "embedding-api-key";
  return endpointReady(settings[role], present.has(name));
}

export interface ChatKit {
  config: EndpointConfig;
  apiKey: string | null;
}

/** Chat endpoint config + key, or null when not usable yet. Unlocks the
 *  keychain — this is a doing-work path, not a rendering one. */
export async function getChatKit(): Promise<ChatKit | null> {
  const { settings, present } = await load();
  if (!endpointReady(settings.chat, present.has("chat-api-key"))) return null;
  return { config: settings.chat, apiKey: await secret("chat-api-key") };
}

export interface EmbeddingKit {
  config: EndpointConfig;
  apiKey: string | null;
  dimensions: number;
}

export async function getEmbeddingKit(): Promise<EmbeddingKit | null> {
  const { settings, present } = await load();
  if (!endpointReady(settings.embedding, present.has("embedding-api-key"))) return null;
  // The built-in model runs in the Rust core and has no key to fetch, so this
  // path stays entirely off the keychain.
  const apiKey =
    settings.embedding.kind === "local" ? null : await secret("embedding-api-key");
  return { config: settings.embedding, apiKey, dimensions: settings.embedding.dimensions };
}

/** Which secrets are stored, for "stored" badges. Never reads their values. */
export async function storedSecrets(): Promise<Set<SecretName>> {
  return (await load()).present;
}

/** Summary consumed by the assistant screen. */
export async function loadAiSettings(): Promise<{ ready: boolean; chatModelLabel: string }> {
  const { settings, present } = await load();
  return {
    ready: endpointReady(settings.chat, present.has("chat-api-key")),
    chatModelLabel: settings.chat.model || "no model",
  };
}
