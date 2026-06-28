import { generateObject } from "ai";
import { z } from "zod";
import { extractionSystemPrompt } from "./prompts";
import { chatModel } from "./providers";

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

export function buildExtractPrompt(chunks: { content: string }[]): string {
  const body = chunks.map((c, i) => `--- chunk ${i + 1} ---\n${c.content}`).join("\n\n");
  return `Extract the salient entities and the relationships explicitly stated in the following text.\n\n${body}`;
}

export async function extractGraphFromChunks(
  chunks: { content: string }[],
): Promise<Extraction> {
  if (chunks.length === 0) return { entities: [], relationships: [] };
  const { object } = await generateObject({
    model: chatModel(),
    schema: ExtractionSchema,
    system: extractionSystemPrompt(),
    prompt: buildExtractPrompt(chunks),
  });
  return object;
}
