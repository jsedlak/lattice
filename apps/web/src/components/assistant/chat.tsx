"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type { Citation } from "@lattice/db";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LogoMark,
  Spinner,
  cn,
} from "@lattice/ui";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Sparkles,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { MarkdownPreview } from "@/components/markdown-preview";
import { type AssistantModel, setConversationModel } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";

const SUGGESTIONS = [
  "Summarize what I know about retrieval",
  "How are my notes connected?",
  "What have I written about embeddings?",
];

interface MessageMetadata {
  citations?: Citation[];
  conversationId?: string;
  createdAt?: string;
}

export function Chat({
  conversationId,
  initialMessages,
  docContext,
  models,
  initialModel,
}: {
  conversationId?: string;
  initialMessages?: UIMessage[];
  docContext?: { id: string; title: string };
  models: AssistantModel[];
  initialModel: string;
}) {
  const router = useRouter();
  const convIdRef = React.useRef(conversationId);
  const [input, setInput] = React.useState("");
  const [model, setModel] = React.useState(initialModel);
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  // Timestamp the first time each message appears; persisted messages carry a
  // real createdAt in their metadata which takes precedence.
  const seenAt = React.useRef(new Map<string, number>());

  function onModelChange(next: string) {
    setModel(next);
    if (convIdRef.current) setConversationModel(convIdRef.current, next).catch(() => {});
  }

  const { messages, sendMessage, status } = useChat({
    ...(conversationId ? { id: conversationId } : {}),
    messages: initialMessages,
    transport,
    onFinish: ({ message }) => {
      const id = (message.metadata as MessageMetadata | undefined)?.conversationId;
      if (id && !convIdRef.current) {
        convIdRef.current = id;
        router.replace(`/assistant/${id}`);
      } else {
        router.refresh();
      }
    },
  });

  React.useEffect(() => {
    for (const m of messages) {
      if (!seenAt.current.has(m.id)) seenAt.current.set(m.id, Date.now());
    }
  }, [messages]);

  function timestampFor(m: UIMessage): string | number | undefined {
    return (m.metadata as MessageMetadata | undefined)?.createdAt ?? seenAt.current.get(m.id);
  }

  const isLoading = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    sendMessage(
      { text: trimmed },
      { body: { conversationId: convIdRef.current, docId: docContext?.id, model } },
    );
    setInput("");
  }

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const isEmpty = messages.length === 0;
  const lastIsUser = messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      {/* Header — model selector (unsloth-style, top-left) */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <ModelHeaderPicker models={models} value={model} onChange={onModelChange} />
        {docContext && (
          <span className="hidden items-center gap-1.5 text-sm text-muted sm:flex">
            <FileText className="h-3 w-3 text-graph-doc" />
            {docContext.title}
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {isEmpty ? (
            <EmptyChat docContext={docContext} onPick={submit} />
          ) : (
            <div className="space-y-7">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} timestamp={timestampFor(m)} />
              ))}
              {isLoading && lastIsUser && (
                <div className="flex items-center gap-2  text-graph-tag">
                  <Spinner className="h-4 w-4 text-graph-tag" />
                  Searching your notes…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm transition-colors focus-within:border-accent"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder="Ask your knowledge graph…"
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5  focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity hover:bg-accent-active disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Model header picker (styled trigger over a native select for a11y) ───────

function fmtPrice(v: string): string {
  if (!v) return "";
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? `$${n}` : "";
}

function splitSlug(name: string): { provider: string; model: string } {
  const i = name.indexOf("/");
  return i === -1
    ? { provider: "", model: name }
    : { provider: name.slice(0, i + 1), model: name.slice(i + 1) };
}

function ModelHeaderPicker({
  models,
  value,
  onChange,
}: {
  models: AssistantModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const options = models.some((m) => m.name === value)
    ? models
    : [{ name: value, input: "", output: "" }, ...models];
  const current = options.find((m) => m.name === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="h-2 w-2 rounded-full bg-graph-tag" />
          <span className="max-w-[15rem] truncate  font-semibold tracking-tight text-foreground">
            {current?.name ?? value}
          </span>
          {current?.input && current?.output && (
            <span className="hidden text-sm text-muted md:inline">
              in {fmtPrice(current.input)} / out {fmtPrice(current.output)} /M
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-faint transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[22rem]">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((m) => {
            const { provider, model } = splitSlug(m.name);
            return (
              <DropdownMenuRadioItem key={m.name} value={m.name} className="gap-4">
                <span className="truncate font-mono text-[13px]">
                  <span className="text-faint">{provider}</span>
                  <span className="text-foreground">{model}</span>
                </span>
                {m.input && m.output && (
                  <span className="ml-auto whitespace-nowrap text-sm text-muted">
                    in <span className="text-foreground">{fmtPrice(m.input)}</span>
                    <span className="text-faint"> · </span>
                    out <span className="text-foreground">{fmtPrice(m.output)}</span>
                    <span className="text-faint"> /M</span>
                  </span>
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] text-faint">
          Prices are $ per 1M tokens · routed via the Vercel AI Gateway
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

function textOf(message: UIMessage): string {
  return (message.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
}

function MessageItem({ message, timestamp }: { message: UIMessage; timestamp?: string | number }) {
  const isUser = message.role === "user";
  const source = textOf(message);
  const citations = (message.metadata as MessageMetadata | undefined)?.citations ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (message.parts ?? []) as any[];

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5  text-accent-foreground shadow-sm">
          <p className="whitespace-pre-wrap break-words">{source}</p>
        </div>
        <MessageMeta source={source} timestamp={timestamp} align="right" />
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <LogoMark size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {parts.map((part, i) => {
          const tool = toolInfo(part);
          if (tool) return <ToolExpander key={i} {...tool} />;
          if (part.type === "text" && part.text)
            return <MarkdownPreview key={i} content={part.text} />;
          return null;
        })}
        {citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {citations.map((c, i) => (
              <Link
                key={`${c.documentId ?? c.label}-${i}`}
                href={c.documentId ? `/editor?doc=${c.documentId}` : "#"}
              >
                <Badge concept="citation" className="cursor-pointer hover:opacity-80">
                  <FileText className="h-3 w-3" />
                  {c.label}
                </Badge>
              </Link>
            ))}
          </div>
        )}
        <MessageMeta source={source} timestamp={timestamp} align="left" />
      </div>
    </div>
  );
}

function MessageMeta({
  source,
  timestamp,
  align,
}: {
  source: string;
  timestamp?: string | number;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-2.5 text-[11px] text-faint",
        align === "right" && "justify-end",
      )}
    >
      {timestamp && <span>{relativeTime(timestamp)}</span>}
      <CopyButton source={source} />
    </div>
  );
}

function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      title="Copy source"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(source);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="flex items-center gap-1 hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-graph-tag" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy
        </>
      )}
    </button>
  );
}

// ── Tool calls (collapsible) ─────────────────────────────────────────────────

interface ToolInfo {
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toolInfo(part: any): ToolInfo | null {
  if (!part || typeof part.type !== "string") return null;
  if (part.type === "dynamic-tool")
    return { name: part.toolName, state: part.state, input: part.input, output: part.output };
  if (part.type.startsWith("tool-"))
    return {
      name: part.type.slice("tool-".length),
      state: part.state,
      input: part.input,
      output: part.output,
    };
  return null;
}

function json(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch {
    return String(value);
  }
}

function ToolExpander({ name, state, input, output }: ToolInfo) {
  const [open, setOpen] = React.useState(false);
  const done = state === "output-available" || output !== undefined;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-graph-link/30 bg-graph-link/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Wrench className="h-3.5 w-3.5 text-graph-link" />
        <span className="font-mono font-medium text-foreground">{name}</span>
        <span className={cn("text-[11px]", done ? "text-graph-tag" : "text-graph-entity")}>
          {done ? "done" : "running…"}
        </span>
        <ChevronRight
          className={cn("ml-auto h-3.5 w-3.5 text-faint transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-graph-link/20 px-3 py-2.5 font-mono text-[11px]">
          <div>
            <div className="mb-1 uppercase tracking-wide text-faint">input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-muted">{json(input)}</pre>
          </div>
          {done && (
            <div>
              <div className="mb-1 uppercase tracking-wide text-faint">output</div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-muted">
                {json(output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyChat({
  docContext,
  onPick,
}: {
  docContext?: { id: string; title: string };
  onPick: (text: string) => void;
}) {
  const prompts = docContext
    ? [`Summarize ${docContext.title}`, `What connects to ${docContext.title}?`]
    : SUGGESTIONS;

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Ask your knowledge graph</h2>
        <p className="mt-1 max-w-sm  text-muted">
          Answers come only from your notes and uploads, with citations you can open.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {prompts.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-border bg-surface px-4 py-2  text-muted transition-colors hover:border-accent/40 hover:bg-surface-raised hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
