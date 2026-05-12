import path from "path";

export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".pdf") {
    // Import the internal lib directly to skip pdf-parse's self-test on load,
    // which tries to open ./test/data/05-versions-space.pdf and fails in production.
    const mod = await import("pdf-parse/lib/pdf-parse.js");
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
