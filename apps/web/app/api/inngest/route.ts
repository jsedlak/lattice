import { functions, inngest } from "@lattice/ingest";
import { serve } from "inngest/next";

export const { GET, POST, PUT } = serve({ client: inngest, functions });

// Ingestion parses PDFs/docx and calls AI providers — needs the Node runtime
// and a generous timeout.
export const runtime = "nodejs";
export const maxDuration = 300;
