import * as React from "react";
import { embed, generateText } from "ai";
import { ArrowLeft, ArrowRight, MessageSquareQuote, PenLine, ShieldCheck } from "lucide-react";

import { EndpointForm, type TestState } from "@/components/settings/EndpointForm";
import { Button, LogoMark, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import * as ipc from "@/lib/ipc";
import { embeddingModelFor, languageModelFor } from "@/lib/ai/providers";
import { requiresApiKey, saveSettings } from "@/lib/ai/settings";
import {
  DEFAULT_SETTINGS,
  LOCAL_EMBEDDING,
  type AppSettings,
  type EndpointConfig,
} from "@/lib/types";

/**
 * First-run setup: intro → chat model → embeddings (local model download).
 * Everything is changeable later in Settings; finishing writes the chosen
 * config plus an `onboarded` flag so this never shows again.
 */

const STEP_LABELS = ["Welcome", "Chat", "Search"] as const;
type Step = 0 | 1 | 2;

/** The graph-in-miniature stepper: each step lights a node and draws the
 *  edge to the next — the same thing Lattice does to your notes. */
function ConstellationSteps({ step, busy }: { step: Step; busy: boolean }) {
  const xs = [10, 68, 126];
  return (
    <div className="select-none">
      <svg width="136" height="16" viewBox="0 0 136 16" className="overflow-visible">
        {[0, 1].map((i) => (
          <line
            key={i}
            x1={xs[i]! + 7}
            y1="8"
            x2={xs[i + 1]! - 7}
            y2="8"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={step > i ? 0 : 1}
            className="stroke-accent transition-[stroke-dashoffset] duration-700 ease-out"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
        {xs.map((x, i) => (
          <circle
            key={x}
            cx={x}
            cy="8"
            r={i === step ? 5 : 4}
            strokeWidth="1.5"
            className={cn(
              "transition-all duration-500",
              i <= step ? "fill-accent stroke-accent" : "fill-surface-raised stroke-border-strong",
              i === step && busy && "animate-pulse-subtle",
            )}
          />
        ))}
      </svg>
      <div className="mt-1 grid grid-cols-3 text-center text-[10px] uppercase tracking-wide">
        {STEP_LABELS.map((label, i) => (
          <span key={label} className={i <= step ? "text-muted" : "text-faint"}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const INTRO_POINTS = [
  {
    icon: PenLine,
    title: "Write, and the graph builds itself",
    body: "Markdown notes with [[wikilinks]] and #tags — plus PDFs and documents you drop in.",
  },
  {
    icon: ShieldCheck,
    title: "Everything stays on this machine",
    body: "Notes, graph, and search index live in a local workspace. The only network traffic is the AI calls you configure.",
  },
  {
    icon: MessageSquareQuote,
    title: "Ask, and follow the citations",
    body: "The assistant answers from your own notes and shows exactly where each claim came from.",
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = React.useState<Step>(0);
  const [chat, setChat] = React.useState<EndpointConfig>(DEFAULT_SETTINGS.chat);
  const [chatKey, setChatKey] = React.useState("");
  const [chatTest, setChatTest] = React.useState<TestState>({ status: "idle" });
  const [emb, setEmb] = React.useState<EndpointConfig>({
    kind: "local",
    model: LOCAL_EMBEDDING.model,
  });
  const [embKey, setEmbKey] = React.useState("");
  const [embTest, setEmbTest] = React.useState<TestState>({ status: "idle" });
  const [local, setLocal] = React.useState({ downloading: false, ready: false });
  const [finishing, setFinishing] = React.useState(false);

  const busy = local.downloading || finishing || chatTest.status === "running";

  const chatConfigured =
    chat.model.trim() !== "" &&
    (!requiresApiKey(chat.kind) || chatKey.trim() !== "") &&
    (chat.kind !== "openai-compatible" || (chat.baseUrl ?? "").trim() !== "");
  const embConfigured =
    emb.kind === "local"
      ? local.ready
      : emb.model.trim() !== "" &&
        (!requiresApiKey(emb.kind) || embKey.trim() !== "") &&
        (emb.kind !== "openai-compatible" || (emb.baseUrl ?? "").trim() !== "");

  const testChat = async () => {
    setChatTest({ status: "running" });
    try {
      const { text } = await generateText({
        model: languageModelFor(chat, chatKey || null),
        prompt: "Reply with the single word: ok",
      });
      setChatTest({ status: "ok", detail: `Model responded (“${text.trim().slice(0, 40)}”)` });
    } catch (e) {
      setChatTest({ status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const finish = async (skipEmbedding: boolean) => {
    setFinishing(true);
    setEmbTest({ status: "idle" });
    try {
      let embedding: AppSettings["embedding"];
      if (skipEmbedding) {
        embedding = DEFAULT_SETTINGS.embedding;
      } else if (emb.kind === "local") {
        embedding = { kind: "local", model: LOCAL_EMBEDDING.model, dimensions: LOCAL_EMBEDDING.dimensions };
      } else {
        // Verify the endpoint and learn its dimensions in one call.
        const { embedding: vector } = await embed({
          model: embeddingModelFor(emb, embKey || null),
          value: "lattice",
        });
        embedding = { ...emb, dimensions: vector.length };
      }
      await saveSettings(
        { chat, embedding, editor: DEFAULT_SETTINGS.editor },
        {
          "chat-api-key": chatKey || undefined,
          "embedding-api-key": skipEmbedding ? undefined : embKey || undefined,
        },
      );
      // Rust merges shallowly — this only adds the flag.
      await ipc.setSettings({ onboarded: true } as unknown as AppSettings);
      onDone();
    } catch (e) {
      setEmbTest({ status: "fail", detail: e instanceof Error ? e.message : String(e) });
      setFinishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div className="absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 animate-dialog-in rounded-xl border border-border bg-surface p-8 shadow-2xl">
        <div className="flex items-start justify-between">
          <LogoMark size={32} />
          <ConstellationSteps step={step} busy={local.downloading} />
        </div>

        <div key={step} className="mt-6 min-h-[24rem] animate-slide-up">
          {step === 0 && (
            <div className="flex min-h-[24rem] flex-col justify-center">
              <h1 className="text-2xl font-semibold tracking-tight">Welcome to Lattice</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                A second brain that keeps everything on your machine. Two quick
                choices and you're writing — both can be changed later in Settings.
              </p>
              <div className="mt-8 grid gap-5">
                {INTRO_POINTS.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised">
                      <Icon className="h-4 w-4 text-accent" strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium">{title}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-muted">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Choose a chat model</h1>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Powers the assistant and the graph's entity extraction. Keys are
                stored in your OS keychain.
              </p>
              <EndpointForm
                frameless
                role="chat"
                config={chat}
                onChange={setChat}
                apiKey={chatKey}
                keyStored={false}
                onApiKeyChange={setChatKey}
                test={chatTest}
              />
            </div>
          )}

          {step === 2 && (
            <div className={cn(local.downloading && "pointer-events-none opacity-80")}>
              <h1 className="text-lg font-semibold tracking-tight">Choose how search works</h1>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Embeddings power semantic search and connect related notes in the
                graph. The built-in model needs no account and runs entirely on
                this device.
              </p>
              <EndpointForm
                frameless
                role="embedding"
                config={emb}
                onChange={setEmb}
                apiKey={embKey}
                keyStored={false}
                onApiKeyChange={setEmbKey}
                test={embTest}
                autoDownloadLocal
                onLocalStateChange={setLocal}
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
          {step > 0 && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStep((s) => (s - 1) as Step)}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <span className="flex-1" />
          {step === 0 && (
            <Button onClick={() => setStep(1)}>
              Set up Lattice
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
          {step === 1 && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStep(2)}>
                Skip for now
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="whitespace-nowrap"
                disabled={!chatConfigured || busy}
                onClick={() => void testChat()}
              >
                {chatTest.status === "running" ? <Spinner className="h-3.5 w-3.5" /> : "Test connection"}
              </Button>
              <Button size="sm" disabled={!chatConfigured || busy} onClick={() => setStep(2)}>
                Continue
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void finish(true)}>
                Skip for now
              </Button>
              <Button size="sm" disabled={!embConfigured || busy} onClick={() => void finish(false)}>
                {finishing ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : null}
                Start writing
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
