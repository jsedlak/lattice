import { getDocument, updateDocument } from "@lattice/db";
import { getBlobBytes } from "./blob";

export interface ParseResult {
  text: string;
  pageCount?: number;
}

/** Parse the bytes of an uploaded document into plain text, branching on mime.
 *  Writes the extracted text back to document.content so uploads share the same
 *  preview/search/chunk path as notes. Returns the text for chunking. */
export async function parseToText(userId: string, documentId: string): Promise<ParseResult> {
  const doc = await getDocument(userId, documentId);
  if (!doc) throw new Error(`Document ${documentId} not found for user`);

  // Notes have no blob — their content is already the text.
  if (doc.kind === "note" || !doc.blobPathname) {
    return { text: doc.content };
  }

  const bytes = await getBlobBytes(doc.blobPathname);
  const mime = doc.mimeType ?? "";
  const name = doc.title.toLowerCase();

  let result: ParseResult;
  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    result = await parsePdf(bytes);
  } else if (
    mime.includes("wordprocessingml") ||
    name.endsWith(".docx")
  ) {
    result = { text: await parseDocx(bytes) };
  } else if (
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  ) {
    result = { text: await parseXlsx(bytes) };
  } else if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    result = { text: bytes.toString("utf-8") };
  } else if (mime.startsWith("image/")) {
    // Images have no extractable text in MVP (no OCR). Keep a placeholder so the
    // document still gets a graph node.
    result = { text: `Image file: ${doc.title}` };
  } else {
    result = { text: bytes.toString("utf-8") };
  }

  await updateDocument(userId, documentId, {
    content: result.text,
    pageCount: result.pageCount,
  });

  return result;
}

async function parsePdf(bytes: Buffer): Promise<ParseResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n\n") : text, pageCount: totalPages };
}

async function parseDocx(bytes: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  return value;
}

async function parseXlsx(bytes: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "buffer" });
  return wb.SheetNames.map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    return `# ${sheetName}\n${csv}`;
  }).join("\n\n");
}
