import * as React from "react";
import { CheckCircle2, Cpu, Download, KeyRound, RefreshCw, XCircle } from "lucide-react";

import { Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requiresApiKey } from "@/lib/ai/settings";
import { LOCAL_EMBEDDING, type EndpointConfig, type EndpointKind, type ProviderKind } from "@/lib/types";
import { useLocalEmbedding } from "./use-local-embedding";

export const PROVIDER_OPTIONS: { value: ProviderKind; label: string; hint: string }[] = [
  { value: "gateway", label: "Vercel AI Gateway", hint: "provider/model slugs — parity with the web app" },
  { value: "openai", label: "OpenAI", hint: "api.openai.com" },
  { value: "anthropic", label: "Anthropic", hint: "api.anthropic.com (OpenAI-compatible endpoint)" },
  { value: "openai-compatible", label: "OpenAI-compatible / local", hint: "Ollama, LM Studio, llama.cpp, vLLM — any base URL" },
];

export const MODEL_PLACEHOLDERS: Record<ProviderKind, string> = {
  gateway: "anthropic/claude-opus-4-8",
  openai: "gpt-4o",
  anthropic: "claude-opus-4-8",
  "openai-compatible": "llama3.1",
};

export const EMBEDDING_PLACEHOLDERS: Record<ProviderKind, string> = {
  gateway: "openai/text-embedding-3-small",
  openai: "text-embedding-3-small",
  anthropic: "— no embedding models —",
  "openai-compatible": "nomic-embed-text",
};

export type TestState = { status: "idle" | "running" | "ok" | "fail"; detail?: string };

const formatMB = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * The built-in model's status/download panel. `autoDownload` starts the
 * download as soon as the model is known to be absent (onboarding flow).
 */
export function LocalModelPanel({
  autoDownload,
  onStateChange,
}: {
  autoDownload?: boolean;
  onStateChange?: (s: { downloading: boolean; ready: boolean }) => void;
}) {
  const { status, progress, error, download } = useLocalEmbedding();

  React.useEffect(() => {
    onStateChange?.({ downloading: status === "downloading", ready: status === "ready" });
  }, [status, onStateChange]);

  React.useEffect(() => {
    if (autoDownload && status === "absent") void download();
  }, [autoDownload, status, download]);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, (progress.downloaded / progress.total) * 100)
      : null;

  return (
    <div className="rounded-md border border-border bg-surface-raised/50 p-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="text-[13px] font-medium">{LOCAL_EMBEDDING.model}</span>
        <span className="text-[11px] text-faint">
          {LOCAL_EMBEDDING.dimensions} dims · ~90 MB · runs on this device
        </span>
        <span className="ml-auto" />
        {status === "checking" && <Spinner className="h-3.5 w-3.5" />}
        {status === "ready" && (
          <span className="flex items-center gap-1 text-xs text-graph-tag">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
          </span>
        )}
        {status === "absent" && (
          <Button variant="outline" size="sm" onClick={() => void download()}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download model
          </Button>
        )}
        {status === "error" && (
          <Button variant="outline" size="sm" onClick={() => void download()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>

      {status === "downloading" && (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
            <div
              className={cn(
                "h-full rounded-full bg-accent transition-[width] duration-200",
                pct === null && "w-1/3 animate-pulse-subtle",
              )}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-faint">
            <span>Downloading…</span>
            <span>
              {progress ? formatMB(progress.downloaded) : "0 MB"}
              {progress && progress.total > 0 ? ` / ${formatMB(progress.total)}` : ""}
            </span>
          </div>
        </div>
      )}

      {status === "error" && error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-graph-citation">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export interface EndpointFormProps {
  role: "chat" | "embedding";
  title?: string;
  description?: string;
  config: EndpointConfig;
  onChange: (c: EndpointConfig) => void;
  apiKey: string;
  keyStored: boolean;
  onApiKeyChange: (v: string) => void;
  test?: TestState;
  onTest?: () => void;
  extra?: React.ReactNode;
  /** No section chrome — for embedding in a dialog. */
  frameless?: boolean;
  /** Onboarding: start the local download as soon as local is picked. */
  autoDownloadLocal?: boolean;
  onLocalStateChange?: (s: { downloading: boolean; ready: boolean }) => void;
}

export function EndpointForm(p: EndpointFormProps) {
  const placeholders = p.role === "chat" ? MODEL_PLACEHOLDERS : EMBEDDING_PLACEHOLDERS;
  const isLocal = p.config.kind === "local";

  const pick = (kind: EndpointKind) => {
    if (kind === "local") {
      p.onChange({ kind: "local", model: LOCAL_EMBEDDING.model });
    } else {
      p.onChange({
        ...p.config,
        kind,
        model: p.config.kind === "local" ? "" : p.config.model,
      });
    }
  };

  const body = (
    <>
      {p.test?.status === "ok" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-graph-tag">
          <CheckCircle2 className="h-3.5 w-3.5" /> {p.test.detail ?? "Connected"}
        </div>
      )}
      {p.test?.status === "fail" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-graph-citation">
          <XCircle className="h-3.5 w-3.5" /> {p.test.detail}
        </div>
      )}

      {p.role === "embedding" && (
        <button
          type="button"
          onClick={() => pick("local")}
          className={cn(
            "mt-4 w-full rounded-md border px-3 py-2 text-left transition-colors",
            isLocal ? "border-accent bg-surface-raised" : "border-border hover:border-border-strong",
          )}
        >
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <Cpu className="h-3.5 w-3.5 text-muted" />
            On this device
            <span className="rounded-full border border-border px-1.5 text-[10px] font-normal text-muted">
              recommended
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            built-in model, no account or API key — notes never leave this machine
          </div>
        </button>
      )}

      <div className={cn("grid grid-cols-2 gap-2", p.role === "embedding" ? "mt-2" : "mt-4")}>
        {PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => pick(opt.value)}
            className={cn(
              "rounded-md border px-3 py-2 text-left transition-colors",
              p.config.kind === opt.value
                ? "border-accent bg-surface-raised"
                : "border-border hover:border-border-strong",
            )}
          >
            <div className="text-[13px] font-medium">{opt.label}</div>
            <div className="mt-0.5 text-[11px] text-muted">{opt.hint}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3">
        {isLocal ? (
          <LocalModelPanel
            autoDownload={p.autoDownloadLocal}
            onStateChange={p.onLocalStateChange}
          />
        ) : (
          <>
            {p.config.kind === "openai-compatible" && (
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted">Base URL</span>
                <Input
                  value={p.config.baseUrl ?? ""}
                  placeholder="http://localhost:11434/v1"
                  onChange={(e) => p.onChange({ ...p.config, baseUrl: e.target.value })}
                />
              </label>
            )}
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted">Model</span>
              <Input
                value={p.config.model}
                placeholder={placeholders[p.config.kind as ProviderKind]}
                onChange={(e) => p.onChange({ ...p.config, model: e.target.value })}
              />
            </label>
            <label className="grid gap-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <KeyRound className="h-3 w-3" />
                API key {requiresApiKey(p.config.kind) ? "" : "(optional for local endpoints)"}
              </span>
              <Input
                type="password"
                value={p.apiKey}
                placeholder={p.keyStored ? "•••••••• (stored in keychain — type to replace)" : "sk-…"}
                onChange={(e) => p.onApiKeyChange(e.target.value)}
              />
            </label>
            {p.extra}
          </>
        )}
      </div>
    </>
  );

  if (p.frameless) return <div>{body}</div>;

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">{p.title}</h2>
          <p className="mt-0.5 text-xs text-muted">{p.description}</p>
        </div>
        {p.onTest && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            onClick={p.onTest}
            disabled={p.test?.status === "running"}
          >
            {p.test?.status === "running" ? <Spinner className="h-3.5 w-3.5" /> : "Test connection"}
          </Button>
        )}
      </div>
      {body}
    </section>
  );
}
