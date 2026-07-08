/**
 * Assistant chat — ported from apps/web/src/components/assistant/chat.tsx.
 *
 * Deviations from the web version:
 * - Streams via LocalChatTransport (in-page streamText over the local graph)
 *   instead of DefaultChatTransport → /api/chat. The transport persists the
 *   user + assistant messages to SQLite itself and attaches citations on the
 *   finish message metadata, so this component only renders.
 * - No per-conversation model picker: the desktop uses the single endpoint
 *   configured in Settings (loadAiSettings). The header shows the configured
 *   model and links to /settings; when no model is ready the composer is
 *   disabled and an empty state points at Settings.
 * - Conversations are created client-side via ipc before the first send
 *   (the web creates them server-side inside /api/chat); auto-titling from the
 *   first user message happens here via ipc.renameConversation.
 * - No docContext (document-scoped chats are a web-only entry point for now).
 */
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Check, ChevronRight, Copy, FileText, Sparkles, Wrench } from "lucide-react";
import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { MarkdownPreview } from "@/components/assistant/markdown-preview";
import { Badge, Spinner } from "@/components/ui";
import { LocalChatTransport, type LatticeUIMessage } from "@/lib/ai/transport";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { createConversation, listMessages, renameConversation } from "@/lib/ipc";

const SUGGESTIONS = [
  "Summarize what I know about retrieval",
  "How are my notes connected?",
  "What have I written about embeddings?",
];

/** Result shape of "@/lib/ai/settings" loadAiSettings(), passed down by the screen. */
export interface AiInfo {
  ready: boolean;
  chatModelLabel: string;
}

interface RouteState {
  /** First message typed on /assistant, forwarded through navigation so the
   * conversation pane can send it once its transport exists. */
  pendingText?: string;
}

// ── Existing conversation: load history, then stream ─────────────────────────

export function ConversationPane({
  conversationId,
  ai,
  onConversationsChanged,
}: {
  conversationId: string;
  ai: AiInfo | null;
  onConversationsChanged: () => void;
}) {
  const navigate = useNavigate();
  const [initial, setInitial] = React.useState<{
    messages: LatticeUIMessage[];
    timestamps: Record<string, string>;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listMessages(conversationId)
      .then((rows) => {
        if (cancelled) return;
        const timestamps: Record<string, string> = {};
        const messages = rows.map((r): LatticeUIMessage => {
          timestamps[r.id] = r.createdAt;
          return {
            id: r.id,
            role: r.role,
            parts: [{ type: "text", text: r.content }],
            metadata: { citations: r.citations ?? undefined },
          };
        });
        setInitial({ messages, timestamps });
      })
      .catch(() => {
        // Unknown/deleted conversation → back to the new-chat screen.
        if (!cancelled) navigate("/assistant", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, navigate]);

  if (!initial) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <Chat
      conversationId={conversationId}
      initialMessages={initial.messages}
      initialTimestamps={initial.timestamps}
      ai={ai}
      onConversationsChanged={onConversationsChanged}
    />
  );
}

function Chat({
  conversationId,
  initialMessages,
  initialTimestamps,
  ai,
  onConversationsChanged,
}: {
  conversationId: string;
  initialMessages: LatticeUIMessage[];
  initialTimestamps: Record<string, string>;
  ai: AiInfo | null;
  onConversationsChanged: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = React.useState("");
  const transport = React.useMemo(
    () => new LocalChatTransport({ conversationId }),
    [conversationId],
  );
  // Timestamp the first time each message appears; persisted messages carry a
  // real createdAt (initialTimestamps) which takes precedence.
  const seenAt = React.useRef(new Map<string, number>());
  // Auto-title: the first user message in a fresh conversation becomes its name.
  const needsTitle = React.useRef(initialMessages.length === 0);

  const { messages, sendMessage, status } = useChat<LatticeUIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: () => onConversationsChanged(), // pick up new updatedAt ordering
  });

  React.useEffect(() => {
    for (const m of messages) {
      if (!seenAt.current.has(m.id)) seenAt.current.set(m.id, Date.now());
    }
  }, [messages]);

  function timestampFor(m: LatticeUIMessage): string | number | undefined {
    return initialTimestamps[m.id] ?? seenAt.current.get(m.id);
  }

  const ready = ai?.ready ?? false;
  const isLoading = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading || !ready) return;
    void sendMessage({ text: trimmed });
    setInput("");
    if (needsTitle.current) {
      needsTitle.current = false;
      renameConversation(conversationId, trimmed.slice(0, 60))
        .then(onConversationsChanged)
        .catch(() => {});
    }
  }

  // Send the message typed on /assistant (forwarded via navigation state).
  const pendingText = (location.state as RouteState | null)?.pendingText;
  const sentPending = React.useRef(false);
  React.useEffect(() => {
    if (!pendingText || sentPending.current || !ready) return;
    sentPending.current = true;
    navigate(location.pathname, { replace: true, state: null });
    submit(pendingText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingText, ready]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const isEmpty = messages.length === 0;
  const lastIsUser = messages.at(-1)?.role === "user";

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <ModelHeader ai={ai} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {isEmpty ? (
            ready ? (
              <EmptyChat onPick={submit} />
            ) : (
              <ConfigureModelNotice loaded={ai !== null} />
            )
          ) : (
            <div className="space-y-7">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} timestamp={timestampFor(m)} />
              ))}
              {isLoading && lastIsUser && (
                <div className="flex items-center gap-2 text-graph-tag">
                  <Spinner className="h-4 w-4 text-graph-tag" />
                  Searching your graph…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Composer input={input} setInput={setInput} onSubmit={submit} disabled={!ready} />
    </div>
  );
}

// ── New chat (no conversation yet) ───────────────────────────────────────────

export function NewChat({
  ai,
  onConversationsChanged,
}: {
  ai: AiInfo | null;
  onConversationsChanged: () => void;
}) {
  const navigate = useNavigate();
  const [input, setInput] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const ready = ai?.ready ?? false;

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || creating || !ready) return;
    setCreating(true);
    try {
      const conv = await createConversation("New conversation");
      onConversationsChanged();
      const state: RouteState = { pendingText: trimmed };
      navigate(`/assistant/${conv.id}`, { state });
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <ModelHeader ai={ai} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {ready ? (
            <EmptyChat onPick={(t) => void submit(t)} />
          ) : (
            <ConfigureModelNotice loaded={ai !== null} />
          )}
        </div>
      </div>
      <Composer
        input={input}
        setInput={setInput}
        onSubmit={(t) => void submit(t)}
        disabled={!ready || creating}
      />
    </div>
  );
}

// ── Header (configured model, links to Settings) ─────────────────────────────

function ModelHeader({ ai }: { ai: AiInfo | null }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <Link
        to="/settings"
        title="Chat model — configure in Settings"
        className="group inline-flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          className={cn("h-2 w-2 rounded-full", ai?.ready ? "bg-graph-tag" : "bg-graph-citation")}
        />
        <span className="max-w-[15rem] truncate font-semibold tracking-tight text-foreground">
          {ai === null ? "…" : ai.ready ? ai.chatModelLabel : "No model configured"}
        </span>
      </Link>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  input,
  setInput,
  onSubmit,
  disabled,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="border-t border-border px-6 py-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(input);
        }}
        className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm transition-colors focus-within:border-accent"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(input);
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder="Ask your knowledge graph…"
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity hover:bg-accent-active disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

function textOf(message: LatticeUIMessage): string {
  return (message.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
}

function MessageItem({
  message,
  timestamp,
}: {
  message: LatticeUIMessage;
  timestamp?: string | number;
}) {
  const isUser = message.role === "user";
  const source = textOf(message);
  const citations = message.metadata?.citations ?? [];
  const parts = message.parts ?? [];

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-accent-foreground shadow-sm">
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
            {citations.map((c, i) => {
              const chip = (
                <Badge concept="citation" className="cursor-pointer hover:opacity-80">
                  <FileText className="h-3 w-3" />
                  {c.label}
                </Badge>
              );
              const key = `${c.documentId ?? c.label}-${i}`;
              return c.documentId ? (
                <Link key={key} to={`/editor/${c.documentId}`}>
                  {chip}
                </Link>
              ) : (
                <span key={key}>{chip}</span>
              );
            })}
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

function toolInfo(part: LatticeUIMessage["parts"][number]): ToolInfo | null {
  if (typeof part.type !== "string") return null;
  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
    // Tool parts are discriminated unions over `state` across AI SDK versions;
    // read the common fields loosely and narrow defensively (as the web does).
    const p = part as unknown as {
      type: string;
      toolName?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
    };
    return {
      name: p.type === "dynamic-tool" ? (p.toolName ?? "tool") : p.type.slice("tool-".length),
      state: p.state,
      input: p.input,
      output: p.output,
    };
  }
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

// ── Empty states ─────────────────────────────────────────────────────────────

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Ask your knowledge graph</h2>
        <p className="mt-1 max-w-sm text-muted">
          Answers come only from your notes and uploads, with citations you can open.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-muted transition-colors hover:border-accent/40 hover:bg-surface-raised hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfigureModelNotice({ loaded }: { loaded: boolean }) {
  if (!loaded) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">No chat model configured</h2>
        <p className="mt-1 max-w-sm text-muted">
          Add a provider and model in Settings to start asking your knowledge graph.
        </p>
      </div>
      <Link
        to="/settings"
        className="rounded-lg border border-border bg-surface px-4 py-2 text-muted transition-colors hover:border-accent/40 hover:bg-surface-raised hover:text-foreground"
      >
        Open Settings
      </Link>
    </div>
  );
}

// ── Logo mark ────────────────────────────────────────────────────────────────
// The web renders /logo-mark.png via @lattice/ui's LogoMark; the desktop has no
// bundled copy of that asset, so this is an inline SVG of the same motif
// (node-and-edge graph on the accent-blue rounded tile).

function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className={cn("shrink-0 select-none", className)}
      aria-hidden
    >
      <rect width="28" height="28" rx="7" className="fill-accent" />
      <g className="stroke-accent-foreground" strokeWidth="1.4" opacity="0.9">
        <line x1="9" y1="10" x2="19" y2="12" />
        <line x1="9" y1="10" x2="12" y2="19" />
        <line x1="19" y1="12" x2="12" y2="19" />
      </g>
      <g className="fill-accent-foreground">
        <circle cx="9" cy="10" r="2.4" />
        <circle cx="19" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </g>
    </svg>
  );
}
