import { FilePlus } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button, Card } from "@/components/ui";
import { createNote } from "@/lib/ipc";

/** Shown when a [[wiki-link]] points at a note that doesn't exist yet. */
export function CreateNotePrompt({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);

  async function onCreate() {
    setBusy(true);
    try {
      const document = await createNote(title);
      navigate(`/editor/${document.id}`);
      onRefresh();
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
