// COPIED VERBATIM from the Lattice web monorepo: packages/ai/src/extract.ts
// (schema + inferred types only; the generateObject call, prompt builder and
// provider imports are intentionally omitted). PARITY-CRITICAL.

import { z } from "zod";

/** Schema the extraction model must conform to (validated by the AI SDK). */
export const ExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["person", "organization", "concept", "place", "event", "other"]),
      description: z.string().optional(),
    }),
  ),
  relationships: z.array(
    z.object({
      from: z.string().describe("entity name"),
      to: z.string().describe("entity name"),
      relation: z.string().describe("short phrase describing the relationship"),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedEntity = Extraction["entities"][number];
export type ExtractedRelationship = Extraction["relationships"][number];
