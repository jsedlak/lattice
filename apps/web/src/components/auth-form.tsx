"use client";

import { authClient } from "@lattice/auth/client";
import { Button, Card, Input } from "@lattice/ui";
import { Github } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import * as React from "react";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const isSignUp = mode === "sign-up";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Something went wrong.");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Unable to reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onGithub() {
    setError(null);
    await authClient.signIn.social({ provider: "github", callbackURL: next });
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">
        {isSignUp ? "Create your workspace" : "Welcome back"}
      </h1>
      <p className="mt-1  text-muted">
        {isSignUp ? "Start building your knowledge graph." : "Sign in to your workspace."}
      </p>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
        {isSignUp && (
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        )}
        <Input
          type="email"
          placeholder="you@workspace.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={isSignUp ? "new-password" : "current-password"}
        />
        {error && <p className=" text-graph-citation">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? "…" : isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3  text-faint">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="outline" className="w-full" onClick={onGithub} type="button">
        <Github className="h-4 w-4" />
        Continue with GitHub
      </Button>

      <p className="mt-5 text-center  text-muted">
        {isSignUp ? "Already have an account? " : "Don't have an account? "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="text-accent hover:underline">
          {isSignUp ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </Card>
  );
}
