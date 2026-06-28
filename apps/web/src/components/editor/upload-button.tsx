"use client";

import { Spinner, cn } from "@lattice/ui";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { uploadFile } from "@/lib/client-api";

export function UploadButton({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { document } = await uploadFile(file);
      router.push(`/editor?doc=${document.id}&tab=blobs`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong py-2  text-muted hover:bg-surface-raised hover:text-foreground",
        )}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        Upload file
      </button>
      {error && <p className="mt-1  text-graph-citation">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.png,.jpg,.jpeg"
        onChange={onChange}
      />
    </div>
  );
}
