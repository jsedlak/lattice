"use client";

import { Button, Card } from "@lattice/ui";
import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createNote } from "@/lib/client-api";

/** Shown when a [[wiki-link]] points at a note that doesn't exist yet. */
export function CreateNotePrompt({ title }: { title: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function onCreate() {
    setBusy(true);
    try {
      const { document } = await createNote(title);
      router.push(`/editor?doc=${document.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="flex max-w-sm flex-col items-center gap-3 p-8 text-center">
        <FilePlus className="h-8 w-8 text-faint" />
        <p className="">
          No note titled <span className="font-medium text-graph-link">{title}</span> yet.
        </p>
        <Button onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : `Create "${title}"`}
        </Button>
      </Card>
    </div>
  );
}
