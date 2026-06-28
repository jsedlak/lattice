import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Assistant model catalog, read from data/assistant.json at the repo root.
 * Each model has a slug (`name`) and input/output price in $ per 1M tokens.
 * The default selected model comes from the CHAT_MODEL env var.
 */
export interface AssistantModel {
  name: string;
  input: string;
  output: string;
}

let cache: AssistantModel[] | null = null;

export function loadModels(): AssistantModel[] {
  if (cache) return cache;
  const candidates = [
    resolve(process.cwd(), "data/assistant.json"),
    resolve(process.cwd(), "../../data/assistant.json"),
    resolve(process.cwd(), "../data/assistant.json"),
  ];
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { models?: AssistantModel[] };
      if (parsed.models?.length) {
        cache = parsed.models;
        return cache;
      }
    } catch {
      // try next candidate
    }
  }
  const fallback = process.env.CHAT_MODEL ?? "anthropic/claude-opus-4-8";
  cache = [{ name: fallback, input: "", output: "" }];
  return cache;
}

/** The default model id (CHAT_MODEL), guaranteed to appear in the option list. */
export function defaultModelId(): string {
  return process.env.CHAT_MODEL ?? loadModels()[0]?.name ?? "anthropic/claude-opus-4-8";
}

/** Models to offer in the picker, with the default guaranteed present. */
export function modelOptions(): AssistantModel[] {
  const models = loadModels();
  const def = defaultModelId();
  if (models.some((m) => m.name === def)) return models;
  return [{ name: def, input: "", output: "" }, ...models];
}
