/**
 * Deterministic, token-aware text chunker shared by notes and uploads so both
 * embed identically. Splits on paragraph/heading boundaries, targets ~600
 * tokens per chunk with ~15% overlap. Token count is approximated as
 * chars / CHARS_PER_TOKEN (good enough for budgeting; avoids a tokenizer dep).
 */

export interface TextChunk {
  ordinal: number;
  content: string;
  tokenCount: number;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_TARGET_TOKENS = 600;
const DEFAULT_OVERLAP_RATIO = 0.15;

export interface ChunkOptions {
  targetTokens?: number;
  overlapRatio?: number;
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapRatio = opts.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.floor(targetChars * overlapRatio);

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split into blocks on blank lines (paragraphs / headings).
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let buf = "";
  let ordinal = 0;

  const flush = (carryOverlap: boolean) => {
    const content = buf.trim();
    if (!content) return;
    chunks.push({ ordinal: ordinal++, content, tokenCount: approxTokens(content) });
    buf = carryOverlap && overlapChars > 0 ? content.slice(-overlapChars) : "";
  };

  for (const block of blocks) {
    // A single oversized block is hard-split by length.
    if (block.length > targetChars) {
      if (buf) flush(true);
      for (let i = 0; i < block.length; i += targetChars - overlapChars) {
        const slice = block.slice(i, i + targetChars);
        chunks.push({ ordinal: ordinal++, content: slice, tokenCount: approxTokens(slice) });
      }
      buf = "";
      continue;
    }

    if (buf.length + block.length + 2 > targetChars) {
      flush(true);
    }
    buf = buf ? `${buf}\n\n${block}` : block;
  }
  flush(false);

  return chunks;
}
