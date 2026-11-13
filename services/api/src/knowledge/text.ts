/** Turns uploads into plain text, and plain text into overlapping passages. Pure, no I/O except parsing. */

export class UnsupportedFileError extends Error {}

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json"];
export const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ".pdf", ".docx", ".html", ".htm"];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable text from an HTML page: drops scripts, styles and navigation, keeps paragraph breaks. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
  return { title: decodeBasic(title), text: tidy(text) };
}

const decodeBasic = (s: string) => s.replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

/** Collapses runs of spaces and blank lines so chunk sizes reflect real content. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts text from an uploaded file, chosen by its extension. */
export async function extractText(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (ext === ".pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await pdfText(pdf, { mergePages: false });
    return tidy(text.join("\n\n"));
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return tidy(value);
  }
  if (ext === ".html" || ext === ".htm") return htmlToText(new TextDecoder().decode(bytes)).text;
  if (TEXT_EXTENSIONS.includes(ext)) return tidy(new TextDecoder().decode(bytes));
  throw new UnsupportedFileError(ext);
}

/**
 * Splits text into passages of about `size` characters that overlap by `overlap`, breaking at the
 * nearest paragraph or sentence end so a passage reads on its own when the agent quotes it.
 */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const window = text.slice(start, end);
      // Prefer a paragraph break, then a sentence end, then a space, in the last 40% of the window.
      const floor = Math.floor(size * 0.6);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (cut >= floor) end = start + cut;
      else if (sentence >= floor) end = start + sentence + 1;
      else if (window.lastIndexOf(" ") >= floor) end = start + window.lastIndexOf(" ");
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
    // Don't start a passage in the middle of a word.
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < end) start = space + 1;
  }
  return chunks;
}

const STOP = new Set(
  "a an and are as at be but by for from has have how i in is it its of on or that the their this to was were what when where which who why will with you your".split(
    " ",
  ),
);

/** Lower-cased words without filler, for word matching. Works for any script with spaces. */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}
