/**
 * Settings → MCP. Controls the in-app MCP server that exposes the graph to
 * external agents.
 *
 * Unlike the AI tab, nothing here is staged behind the page's Save button: the
 * enable toggle and the port both start or stop a real listener, so they apply
 * on the spot and report what actually happened (including a failed bind).
 */
import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

import { Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import * as ipc from "@/lib/ipc";
import { DEFAULT_MCP_PORT, type McpStatus } from "@/lib/types";

type TestState = { status: "idle" | "running" | "ok" | "fail"; detail?: string };

/** Clipboard write with a per-button "Copied" tick. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <Check className="mr-1.5 h-3.5 w-3.5 text-graph-tag" />
      ) : (
        <Copy className="mr-1.5 h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function McpServer() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [port, setPort] = useState(String(DEFAULT_MCP_PORT));
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    void (async () => {
      const s = await ipc.mcpStatus();
      setStatus(s);
      setPort(String(s.port));
    })();
  }, []);

  if (!status) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const apply = async (enabled: boolean, nextPort: number) => {
    setBusy(true);
    try {
      setStatus(await ipc.setMcpConfig(enabled, nextPort));
    } catch (e) {
      // A rejected port never reached the server; keep the old status, show why.
      setStatus({ ...status, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const commitPort = () => {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setPort(String(status.port));
      setStatus({ ...status, error: "Port must be a whole number between 1024 and 65535." });
      return;
    }
    if (parsed !== status.port) void apply(status.enabled, parsed);
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      await ipc.regenerateMcpToken();
      setStatus(await ipc.mcpStatus());
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTest({ status: "running" });
    try {
      const dims = await ipc.testMcpEmbedding();
      setTest({ status: "ok", detail: `Query embedding returned ${dims} dimensions.` });
    } catch (e) {
      setTest({ status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const url = `http://127.0.0.1:${status.boundPort ?? status.port}/mcp`;
  const token = status.token ?? "";
  const cliCommand = `claude mcp add --transport http lattice ${url} --header "Authorization: Bearer ${token}"`;
  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        lattice: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );

  return (
    // min-w-0 throughout: grid items default to min-width:auto, so one long
    // unbreakable line (a token, a path, the CLI command) would otherwise widen
    // the column past the page's max-w-3xl instead of scrolling inside its card.
    <div className="grid min-w-0 gap-6">
      <section className="min-w-0 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">MCP server</h2>
            <p className="mt-0.5 max-w-lg text-xs text-muted">
              Lets Claude Code, Claude Desktop, or any MCP client search your
              notes and traverse the graph. It listens on loopback only, requires
              a bearer token, and is read-only — agents can read your knowledge
              base but cannot change it.
            </p>
          </div>
          <Button
            variant={status.enabled ? "outline" : "primary"}
            size="sm"
            disabled={busy}
            onClick={() => void apply(!status.enabled, Number(port) || status.port)}
          >
            {busy && <Spinner className="mr-1.5 h-3.5 w-3.5" />}
            {status.enabled ? "Disable" : "Enable"}
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
              status.running
                ? "border-graph-tag/40 text-graph-tag"
                : "border-border text-muted",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status.running ? "bg-graph-tag" : "bg-muted",
              )}
            />
            {status.running ? `Listening on port ${status.boundPort}` : "Not running"}
          </span>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted">Port</span>
            <Input
              className="w-24"
              value={port}
              disabled={busy}
              onChange={(e) => setPort(e.target.value)}
              onBlur={commitPort}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        </div>

        {status.error && (
          <p className="mt-3 rounded-md border border-border px-3 py-2 text-xs text-graph-citation">
            {status.error}
          </p>
        )}

        <p className="mt-3 break-words text-[11px] text-muted">
          Agents see the workspace that is open right now —{" "}
          <code className="break-all">{status.workspacePath}</code>. Switching
          workspaces restarts Lattice and the server with it.
        </p>
      </section>

      <section className="min-w-0 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Access token</h2>
        <p className="mt-0.5 text-xs text-muted">
          Stored in your OS keychain. Any process on this machine can reach the
          port, so the token is what keeps them out — treat it like a password.
        </p>
        {token ? (
          <>
            <div className="mt-4 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-xs">
                {revealed ? token : "•".repeat(Math.min(token.length, 48))}
              </code>
              {/* shrink-0: without it the flex row steals width from the
                  buttons before the code block truncates. */}
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setRevealed(!revealed)}
              >
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
              <div className="shrink-0">
                <CopyButton value={token} label="Copy" />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={busy}
                onClick={() => void regenerate()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Regenerating breaks any client still using the old token —
              reconnect them with the new one.
            </p>
          </>
        ) : (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted">
            A token is created the first time you enable the server.
          </p>
        )}
      </section>

      {/* The snippets embed the token, so they only exist once there is one. */}
      {token && (
      <section className="min-w-0 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Connect an agent</h2>
        <p className="mt-0.5 text-xs text-muted">
          For Claude Code, run this in a terminal:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-[11px] leading-relaxed">
          {cliCommand}
        </pre>
        <div className="mt-2">
          <CopyButton value={cliCommand} label="Copy command" />
        </div>

        <p className="mt-5 text-xs text-muted">
          For Claude Desktop or any other client, add this to its MCP config:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-[11px] leading-relaxed">
          {jsonConfig}
        </pre>
        <div className="mt-2">
          <CopyButton value={jsonConfig} label="Copy config" />
        </div>
      </section>
      )}

      <section className="min-w-0 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Semantic search check</h2>
        <p className="mt-0.5 max-w-lg text-xs text-muted">
          Over MCP, search queries are embedded by the Rust core rather than the
          in-app pipeline. Everything else works regardless, but this confirms
          the <code>semanticSearch</code> tool can reach your embedding model.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={test.status === "running"} onClick={() => void runTest()}>
            {test.status === "running" && <Spinner className="mr-1.5 h-3.5 w-3.5" />}
            Test embedding
          </Button>
          {test.detail && (
            <span
              className={cn(
                "text-xs",
                test.status === "ok" ? "text-graph-tag" : "text-graph-citation",
              )}
            >
              {test.detail}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
