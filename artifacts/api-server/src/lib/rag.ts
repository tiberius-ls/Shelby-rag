import { anthropic } from "@workspace/integrations-anthropic-ai";

// ─── In-memory store ──────────────────────────────────────────────────────────
interface Chunk {
  text: string;
  source: string;
  index: number;
}

const mockStore: Record<string, Chunk> = {};

// ─── Chunker ──────────────────────────────────────────────────────────────────
export function chunkDocument(
  text: string,
  source: string,
  size = 512,
  overlap = 64,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push({ text: text.slice(i, i + size), source, index: chunks.length });
  }
  return chunks;
}

// ─── Inverted Index ───────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "in", "on", "at", "to", "for", "of", "and", "or",
  "but", "with", "this", "that", "it", "as", "by", "from", "are", "was",
  "were", "be", "been", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "its", "their",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

const invertedIdx: Record<string, Set<string>> = {};

interface BlobMeta {
  source: string;
  index: number;
  preview: string;
}

const blobMeta: Record<string, BlobMeta> = {};

function addToIndex(
  blobId: string,
  chunkText: string,
  source: string,
  index: number,
  preview: string,
): void {
  blobMeta[blobId] = { source, index, preview };
  for (const token of tokenize(chunkText)) {
    if (!invertedIdx[token]) invertedIdx[token] = new Set();
    invertedIdx[token].add(blobId);
  }
}

function searchIndex(
  query: string,
  topK = 5,
): Array<{ blobId: string; score: number; meta: BlobMeta }> {
  const scores: Record<string, number> = {};
  for (const token of tokenize(query)) {
    for (const id of invertedIdx[token] ?? []) {
      scores[id] = (scores[id] ?? 0) + 1;
    }
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([blobId, score]) => ({ blobId, score, meta: blobMeta[blobId] }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function storeChunk(chunk: Chunk): string {
  const id = `mock_${Date.now()}_${chunk.index}`;
  mockStore[id] = chunk;
  addToIndex(id, chunk.text, chunk.source, chunk.index, chunk.text.slice(0, 80) + "...");
  return id;
}

export function listDocuments(): Array<BlobMeta & { blobId: string }> {
  return Object.entries(blobMeta).map(([blobId, meta]) => ({ blobId, ...meta }));
}

export async function ragQuery(
  query: string,
  topK = 5,
): Promise<{ answer: string; sources: Array<{ blobId: string; source?: string; score: number }> }> {
  const hits = searchIndex(query, topK);

  if (hits.length === 0) {
    return {
      answer: "No relevant documents found. Please upload documents before querying.",
      sources: [],
    };
  }

  const chunks = hits.map((h) => mockStore[h.blobId]).filter(Boolean);

  const context = chunks
    .map((c) => `[Source: ${c.source}, Chunk #${c.index}]\n${c.text}`)
    .join("\n\n---\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are a precise assistant that answers only from the provided context chunks.
Each chunk is labeled with its source. Cite sources when referencing specific facts.
If the context is insufficient, say so clearly.`,
    messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${query}` }],
  });

  const block = response.content[0];
  const answer = block.type === "text" ? block.text : "";

  return {
    answer,
    sources: hits.map((h) => ({
      blobId: h.blobId,
      source: h.meta?.source,
      score: h.score,
    })),
  };
}
