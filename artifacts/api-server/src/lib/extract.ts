import path from "path";

export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".pdf") {
    // pdf-parse v1 is CJS; dynamic import wraps it in { default: fn }
    const mod = await import("pdf-parse");
    const pdfParse = mod.default ?? mod;
    const result = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
    return result.text;
  }

  if (ext === ".docx" || ext === ".doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Plain text variants: .txt, .md, .mdx, .csv, .json, .yaml, .yml, .xml, .html, etc.
  return buffer.toString("utf-8");
}
