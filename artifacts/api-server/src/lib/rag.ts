import fs from "fs";
import path from "path";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";

// ─── Persistence ──────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "chunks.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveStore(): void {
  ensureDataDir();
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(chunkStore).map(([id, chunk]) => [id, chunk]),
      ),
      null,
      2,
    ),
  );
}

function loadStore(): Record<string, Chunk> {
  if (!fs.existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as Record<string, Chunk>;
  } catch {
    logger.warn("Failed to parse chunks.json — starting with empty store");
    return {};
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Chunk {
  text: string;
  source: string;
  index: number;
}

interface BlobMeta {
  source: string;
  index: number;
  preview: string;
}

// ─── In-memory store (loaded from disk at startup) ────────────────────────────
const chunkStore: Record<string, Chunk> = loadStore();

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
const blobMeta: Record<string, BlobMeta> = {};

function addToIndex(blobId: string, chunk: Chunk): void {
  blobMeta[blobId] = {
    source: chunk.source,
    index: chunk.index,
    preview: chunk.text.slice(0, 80) + "...",
  };
  for (const token of tokenize(chunk.text)) {
    if (!invertedIdx[token]) invertedIdx[token] = new Set();
    invertedIdx[token].add(blobId);
  }
}

// Rebuild index from persisted store on startup
for (const [id, chunk] of Object.entries(chunkStore)) {
  addToIndex(id, chunk);
}
logger.info({ chunks: Object.keys(chunkStore).length }, "RAG index loaded");

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
  const id = `chunk_${Date.now()}_${chunk.index}`;
  chunkStore[id] = chunk;
  addToIndex(id, chunk);
  saveStore();
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

  const chunks = hits.map((h) => chunkStore[h.blobId]).filter(Boolean);

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
