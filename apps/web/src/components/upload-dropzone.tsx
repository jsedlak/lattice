"use client";

import { Spinner } from "@lattice/ui";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { uploadFile } from "@/lib/client-api";

/**
 * Drop a file anywhere in the window to upload it. Shows a full-window overlay
 * while dragging or uploading, then navigates to the new file's detail view.
 */
export function UploadDropzone() {
  const router = useRouter();
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const depth = React.useRef(0);

  React.useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    }
    function onOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault(); // allow drop
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current -= 1;
      if (depth.current <= 0) {
        depth.current = 0;
        setDragging(false);
      }
    }
    async function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        let lastId: string | undefined;
        for (const f of files) {
          const { document } = await uploadFile(f);
          lastId = document.id;
        }
        if (lastId) router.push(`/editor?doc=${lastId}&tab=blobs`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    }

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [router]);

  if (!dragging && !busy && !error) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-8 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-surface px-14 py-12 text-center shadow-xl">
        {busy ? <Spinner className="h-8 w-8" /> : <Upload className="h-8 w-8 text-accent" />}
        <p className=" font-medium">
          {busy ? "Uploading…" : error ? "Upload failed" : "Drop to upload"}
        </p>
        <p className=" text-muted">{error ?? "PDF, Word, Excel, text, or images"}</p>
        {error && (
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-1  text-accent hover:underline"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
