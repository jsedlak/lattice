import { extractGraph } from "./extract";
import { ingestDocument } from "./ingest";

/** All Inngest functions, registered by the /api/inngest serve endpoint. */
export const functions = [ingestDocument, extractGraph];

export { ingestDocument, extractGraph };
