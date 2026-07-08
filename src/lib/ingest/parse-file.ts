/**
 * Upload parsing — mirrors packages/ingest/src/parse.ts, adapted from Node
 * Buffers to browser ArrayBuffers (unpdf/mammoth/xlsx all run in a webview).
 * Mime/extension branching kept identical so the same file parses the same way
 * on web and desktop.
 */
import type { Doc } from "@/lib/types";

export interface ParseResult {
  text: string;
  pageCount?: number;
}

export async function parseFileToText(doc: Doc, bytes: ArrayBuffer): Promise<ParseResult> {
  const mime = doc.mimeType ?? "";
  const name = doc.title.toLowerCase();

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return parsePdf(bytes);
  }
  if (mime.includes("wordprocessingml") || name.endsWith(".docx")) {
    return { text: await parseDocx(bytes) };
  }
  if (
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  ) {
    return { text: await parseXlsx(bytes) };
  }
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: new TextDecoder().decode(bytes) };
  }
  if (mime.startsWith("image/")) {
    // Images have no extractable text in MVP (no OCR). Keep a placeholder so
    // the document still gets a graph node.
    return { text: `Image file: ${doc.title}` };
  }
  return { text: new TextDecoder().decode(bytes) };
}

async function parsePdf(bytes: ArrayBuffer): Promise<ParseResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n\n") : text, pageCount: totalPages };
}

async function parseDocx(bytes: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: bytes });
  return value;
}

async function parseXlsx(bytes: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    return `# ${sheetName}\n${csv}`;
  }).join("\n\n");
}
