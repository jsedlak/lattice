import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { generateText } from "ai";
import { CheckCircle2, FolderOpen, KeyRound, Monitor, Moon, Sun, XCircle } from "lucide-react";
import { useTheme } from "next-themes";

import { Button, Input, Spinner, useConfirm } from "@/components/ui";
import { cn } from "@/lib/cn";
import * as ipc from "@/lib/ipc";
import type {
  AppSettings,
  EditorChoice,
  EndpointConfig,
  ProviderKind,
  SecretName,
  StorageMode,
  WorkspaceInfo,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { languageModelFor } from "@/lib/ai/providers";
import { invalidateAiSettings, loadSettings, requiresApiKey, saveSettings } from "@/lib/ai/settings";
import { enqueueIngest, reingestAll } from "@/lib/ingest/pipeline";

const PROVIDER_OPTIONS: { value: ProviderKind; label: string; hint: string }[] = [
  { value: "gateway", label: "Vercel AI Gateway", hint: "provider/model slugs — parity with the web app" },
  { value: "openai", label: "OpenAI", hint: "api.openai.com" },
  { value: "anthropic", label: "Anthropic", hint: "api.anthropic.com (OpenAI-compatible endpoint)" },
  { value: "openai-compatible", label: "OpenAI-compatible / local", hint: "Ollama, LM Studio, llama.cpp, vLLM — any base URL" },
];

const MODEL_PLACEHOLDERS: Record<ProviderKind, string> = {
  gateway: "anthropic/claude-opus-4-8",
  openai: "gpt-4o",
  anthropic: "claude-opus-4-8",
  "openai-compatible": "llama3.1",
};

const EMBEDDING_PLACEHOLDERS: Record<ProviderKind, string> = {
  gateway: "openai/text-embedding-3-small",
  openai: "text-embedding-3-small",
  anthropic: "— no embedding models —",
  "openai-compatible": "nomic-embed-text",
};

const EDITOR_OPTIONS: { value: EditorChoice; label: string; hint: string }[] = [
  { value: "monaco", label: "Monaco", hint: "VS Code's editor — default" },
  { value: "codemirror", label: "CodeMirror", hint: "lightweight alternative" },
];

const THEME_OPTIONS = [
  { value: "light", label: "Light", hint: "bright surfaces", icon: Sun },
  { value: "dark", label: "Dark", hint: "default", icon: Moon },
  { value: "system", label: "System", hint: "follow the OS setting", icon: Monitor },
] as const;

const STORAGE_OPTIONS: { value: StorageMode; label: string; hint: string }[] = [
  { value: "database", label: "Database", hint: "note content lives in the workspace database" },
  { value: "files", label: "Markdown files", hint: "notes are .md files under notes/ — editable with any tool" },
];

type Tab = "general" | "ai";
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
];

type TestState = { status: "idle" | "running" | "ok" | "fail"; detail?: string };

interface EndpointFormProps {
  role: "chat" | "embedding";
  title: string;
  description: string;
  config: EndpointConfig;
  onChange: (c: EndpointConfig) => void;
  apiKey: string;
  keyStored: boolean;
  onApiKeyChange: (v: string) => void;
  test: TestState;
  onTest: () => void;
  extra?: React.ReactNode;
}

function EndpointForm(p: EndpointFormProps) {
  const placeholders = p.role === "chat" ? MODEL_PLACEHOLDERS : EMBEDDING_PLACEHOLDERS;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">{p.title}</h2>
          <p className="mt-0.5 text-xs text-muted">{p.description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={p.onTest}
          disabled={p.test.status === "running"}
        >
          {p.test.status === "running" ? <Spinner className="h-3.5 w-3.5" /> : "Test connection"}
        </Button>
      </div>

      {p.test.status === "ok" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-graph-tag">
          <CheckCircle2 className="h-3.5 w-3.5" /> {p.test.detail ?? "Connected"}
        </div>
      )}
      {p.test.status === "fail" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-graph-citation">
          <XCircle className="h-3.5 w-3.5" /> {p.test.detail}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => p.onChange({ ...p.config, kind: opt.value })}
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
            placeholder={placeholders[p.config.kind]}
            onChange={(e) => p.onChange({ ...p.config, model: e.target.value })}
          />
        </label>
        <label className="grid gap-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <KeyRound className="h-3 w-3" />
            API key{" "}
            {requiresApiKey(p.config.kind) ? "" : "(optional for local endpoints)"}
          </span>
          <Input
            type="password"
            value={p.apiKey}
            placeholder={p.keyStored ? "•••••••• (stored in keychain — type to replace)" : "sk-…"}
            onChange={(e) => p.onApiKeyChange(e.target.value)}
          />
        </label>
        {p.extra}
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const confirm = useConfirm();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [chatKey, setChatKey] = useState("");
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [stored, setStored] = useState({ chat: false, embedding: false });
  const [initialEmbedding, setInitialEmbedding] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [chatTest, setChatTest] = useState<TestState>({ status: "idle" });
  const [embTest, setEmbTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      setSettings(s);
      setInitialEmbedding(`${s.embedding.kind}:${s.embedding.model}:${s.embedding.dimensions}`);
      const [ck, ek, ws] = await Promise.all([
        ipc.getSecret("chat-api-key"),
        ipc.getSecret("embedding-api-key"),
        ipc.getWorkspaceInfo(),
      ]);
      setStored({ chat: ck !== null, embedding: ek !== null });
      setWorkspace(ws);
    })();
  }, []);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const keyFor = async (name: SecretName, typed: string): Promise<string | null> =>
    typed ? typed : ipc.getSecret(name);

  const testChat = async () => {
    setChatTest({ status: "running" });
    try {
      const apiKey = await keyFor("chat-api-key", chatKey);
      const { text } = await generateText({
        model: languageModelFor(settings.chat, apiKey),
        prompt: "Reply with the single word: ok",
      });
      setChatTest({ status: "ok", detail: `Model responded (“${text.trim().slice(0, 40)}”)` });
    } catch (e) {
      setChatTest({ status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const testEmbedding = async () => {
    setEmbTest({ status: "running" });
    try {
      // Test through a temporary save-free path: embed with the form's config.
      const apiKey = await keyFor("embedding-api-key", embeddingKey);
      const { embeddingModelFor } = await import("@/lib/ai/providers");
      const { embed } = await import("ai");
      const { embedding } = await embed({
        model: embeddingModelFor(settings.embedding, apiKey),
        value: "lattice",
      });
      if (embedding.length !== settings.embedding.dimensions) {
        setSettings({
          ...settings,
          embedding: { ...settings.embedding, dimensions: embedding.length },
        });
        setEmbTest({
          status: "ok",
          detail: `Connected — model returns ${embedding.length} dims (updated below)`,
        });
      } else {
        setEmbTest({ status: "ok", detail: `Connected — ${embedding.length} dims` });
      }
    } catch (e) {
      setEmbTest({ status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(settings, {
        "chat-api-key": chatKey || undefined,
        "embedding-api-key": embeddingKey || undefined,
      });
      setChatKey("");
      setEmbeddingKey("");
      setStored({
        chat: stored.chat || chatKey !== "",
        embedding: stored.embedding || embeddingKey !== "",
      });
      setSavedAt(Date.now());

      const nowKey = `${settings.embedding.kind}:${settings.embedding.model}:${settings.embedding.dimensions}`;
      if (initialEmbedding && nowKey !== initialEmbedding) {
        const docs = await ipc.listDocuments();
        if (docs.length > 0) {
          const ok = await confirm({
            title: "Re-embed your library?",
            description:
              "The embedding model changed, which invalidates every stored vector. Lattice will re-chunk and re-embed all documents now (this may take a while and use API credits).",
            confirmLabel: "Re-embed everything",
          });
          if (ok) {
            invalidateAiSettings();
            await reingestAll();
          }
        }
      }
      setInitialEmbedding(nowKey);
    } finally {
      setSaving(false);
    }
  };

  const confirmRestart = async (target: string) => {
    setRestartPending(true);
    const ok = await confirm({
      title: "Restart Lattice?",
      description: `Lattice needs to restart to open the workspace at ${target}.`,
      confirmLabel: "Restart now",
    });
    if (ok) await ipc.restartApp();
  };

  const pickWorkspace = async () => {
    if (!workspace) return;
    const path = await open({ directory: true, title: "Open workspace" });
    if (typeof path !== "string" || path === workspace.path) return;
    await ipc.setWorkspacePath(path);
    setWorkspace({ ...workspace, overridePath: path });
    await confirmRestart(path);
  };

  const resetWorkspace = async () => {
    if (!workspace) return;
    await ipc.setWorkspacePath(null);
    setWorkspace({ ...workspace, overridePath: null });
    if (workspace.isDefault) {
      // Only a pending switch was cleared — we're already running the default.
      setRestartPending(false);
    } else {
      await confirmRestart("the default location");
    }
  };

  const switchMode = async (mode: StorageMode) => {
    if (!workspace || mode === workspace.mode || switchingMode) return;
    const ok = await confirm({
      title: mode === "files" ? "Store notes as markdown files?" : "Store notes in the database?",
      description:
        mode === "files"
          ? "Your notes will be exported as markdown files under notes/ in the workspace, mirroring your folder tree. Titles with unsupported characters or duplicate names get adjusted."
          : "Note content will be imported back into the workspace database. The notes/ folder stays on disk but is no longer read or updated by Lattice.",
      confirmLabel: "Switch",
    });
    if (!ok) return;
    setSwitchingMode(true);
    try {
      const report = await ipc.setStorageMode(mode);
      for (const id of [...report.added, ...report.changed]) enqueueIngest(id);
      setWorkspace({ ...workspace, mode });
    } finally {
      setSwitchingMode(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Keys are stored in your OS keychain; nothing leaves this machine
          except the API calls you configure.
        </p>

        <div className="mt-6 flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-accent"
                  : "border-transparent text-muted hover:border-border-strong",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "general" && (
          <div className="mt-6 grid gap-6">
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Workspace</h2>
              <p className="mt-0.5 text-xs text-muted">
                The folder holding your notes, uploads, and the knowledge graph.
                Avoid cloud-synced folders (Dropbox, OneDrive) — the database
                doesn't tolerate sync conflicts.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-raised px-3 py-2 text-xs">
                  {workspace?.path ?? "…"}
                </code>
                {workspace?.isDefault && (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                    Default
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void pickWorkspace()}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  Open workspace…
                </Button>
                {workspace && (!workspace.isDefault || workspace.overridePath !== null) && (
                  <Button variant="outline" size="sm" onClick={() => void resetWorkspace()}>
                    Open default workspace
                  </Button>
                )}
                {restartPending && (
                  <span className="text-xs text-muted">
                    Takes effect the next time Lattice starts.
                  </span>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Note storage</h2>
              <p className="mt-0.5 text-xs text-muted">
                Where note content is canonical for this workspace. Switching
                migrates your notes in place.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {STORAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    disabled={switchingMode}
                    onClick={() => void switchMode(opt.value)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      workspace?.mode === opt.value
                        ? "border-accent bg-surface-raised"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      {opt.label}
                      {switchingMode && workspace?.mode !== opt.value && (
                        <Spinner className="h-3 w-3" />
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Appearance</h2>
              <p className="mt-0.5 text-xs text-muted">Color theme for the app.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      theme === opt.value
                        ? "border-accent bg-surface-raised"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      <opt.icon className="h-3.5 w-3.5 text-muted" />
                      {opt.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Markdown editor</h2>
              <p className="mt-0.5 text-xs text-muted">
                The engine behind the note editor. Takes effect the next time a note opens.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {EDITOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSettings({ ...settings, editor: opt.value })}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      settings.editor === opt.value
                        ? "border-accent bg-surface-raised"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="text-[13px] font-medium">{opt.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "ai" && (
          <div className="mt-6 grid gap-6">
            <EndpointForm
              role="chat"
              title="Chat model"
              description="Powers the assistant and graph extraction."
              config={settings.chat}
              onChange={(chat) => setSettings({ ...settings, chat })}
              apiKey={chatKey}
              keyStored={stored.chat}
              onApiKeyChange={setChatKey}
              test={chatTest}
              onTest={() => void testChat()}
            />

            <EndpointForm
              role="embedding"
              title="Embedding model"
              description="Powers semantic search and entity resolution. For a fully local setup, point an OpenAI-compatible endpoint at Ollama or LM Studio."
              config={settings.embedding}
              onChange={(e) =>
                setSettings({ ...settings, embedding: { ...settings.embedding, ...e } })
              }
              apiKey={embeddingKey}
              keyStored={stored.embedding}
              onApiKeyChange={setEmbeddingKey}
              test={embTest}
              onTest={() => void testEmbedding()}
              extra={
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted">Dimensions</span>
                  <Input
                    type="number"
                    value={settings.embedding.dimensions}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        embedding: {
                          ...settings.embedding,
                          dimensions: Number(e.target.value) || DEFAULT_SETTINGS.embedding.dimensions,
                        },
                      })
                    }
                  />
                </label>
              }
            />
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : null}
            Save settings
          </Button>
          {savedAt && <span className="text-xs text-graph-tag animate-fade-in">Saved.</span>}
        </div>
      </div>
    </div>
  );
}
