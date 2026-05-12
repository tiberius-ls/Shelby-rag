// index.js — Shelby RAG Pipeline (single-file version for Replit)
// Paste this as index.js, then create package.json alongside it.

import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ──────────────────────────────────────────────────────────────────
const MOCK_MODE = process.env.SHELBY_MODE !== "live";
const PORT = process.env.PORT || 3000;
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

console.log(`Shelby mode: ${MOCK_MODE ? "MOCK (in-memory)" : "LIVE (testnet)"}`);

// ─── Shelby Layer ─────────────────────────────────────────────────────────────
// In mock mode: stores chunks in memory.
// In live mode: uses @shelby-protocol/sdk to store on testnet.

let shelbyClient;
const mockStore = {};

if (!MOCK_MODE) {
  const { ShelbyNodeClient } = await import("@shelby-protocol/sdk/node");
  const { Network } = await import("@aptos-labs/ts-sdk");
  shelbyClient = new ShelbyNodeClient({
    network: Network.TESTNET,
    apiKey: process.env.SHELBY_API_KEY,
  });
}

async function shelbyUpload(chunk) {
  if (MOCK_MODE) {
    const id = `mock_${Date.now()}_${chunk.index}`;
    mockStore[id] = chunk;
    return id;
  }
  const blob = new Blob([JSON.stringify(chunk)], { type: "application/json" });
  const { blobId } = await shelbyClient.upload(blob);
  return blobId;
}

async function shelbyDownload(blobId) {
  if (MOCK_MODE) return mockStore[blobId];
  const blob = await shelbyClient.download(blobId);
  return JSON.parse(await blob.text());
}

// ─── Chunker ──────────────────────────────────────────────────────────────────
function chunkDocument(text, source, size = 512, overlap = 64) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push({ text: text.slice(i, i + size), source, index: chunks.length });
  }
  return chunks;
}

// ─── Inverted Index ───────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the","a","an","is","in","on","at","to","for","of","and","or","but",
  "with","this","that","it","as","by","from","are","was","were","be",
  "been","have","has","had","do","does","did","will","would","could",
  "should","may","might","can","its","their",
]);

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

const invertedIdx = {};
const blobMeta = {};

function addToIndex(blobId, chunkText, source, index, preview) {
  blobMeta[blobId] = { source, index, preview };
  for (const token of tokenize(chunkText)) {
    if (!invertedIdx[token]) invertedIdx[token] = new Set();
    invertedIdx[token].add(blobId);
  }
}

function searchIndex(query, topK = 5) {
  const scores = {};
  for (const token of tokenize(query)) {
    for (const id of (invertedIdx[token] || [])) {
      scores[id] = (scores[id] || 0) + 1;
    }
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1]).slice(0, topK)
    .map(([blobId, score]) => ({ blobId, score, meta: blobMeta[blobId] }));
}

// ─── RAG Pipeline ─────────────────────────────────────────────────────────────
async function ragQuery(query, topK = 5) {
  const hits = searchIndex(query, topK);

  if (hits.length === 0) {
    return {
      answer: "No relevant documents found. Please upload documents before querying.",
      sources: [], retrievedChunks: [],
    };
  }

  // Retrieve chunks from Shelby in parallel
  const chunks = await Promise.all(hits.map(h => shelbyDownload(h.blobId)));

  // Build context
  const context = chunks.map(c =>
    `[Source: ${c.source}, Chunk #${c.index}]\n${c.text}`
  ).join("\n\n---\n\n");

  // Generate with Claude
  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a precise assistant that answers only from the provided context chunks.
Each chunk is labeled with its source. Cite sources when referencing specific facts.
If the context is insufficient, say so clearly.`,
    messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${query}` }],
  });

  return {
    answer: response.content[0].text,
    sources: hits.map(h => ({ blobId: h.blobId, source: h.meta?.source, score: h.score })),
    retrievedChunks: chunks,
  };
}

// ─── Express Server ───────────────────────────────────────────────────────────
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Shelby RAG Pipeline",
    mode: MOCK_MODE ? "mock" : "live",
    endpoints: ["POST /upload", "POST /query", "GET /documents"],
  });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    const text = req.file.buffer.toString("utf-8");
    const filename = req.file.originalname;
    const chunks = chunkDocument(text, filename);
    const blobs = [];

    for (const chunk of chunks) {
      const blobId = await shelbyUpload(chunk);
      addToIndex(blobId, chunk.text, filename, chunk.index, chunk.text.slice(0, 80) + "...");
      blobs.push({ blobId, chunkIndex: chunk.index });
    }

    res.json({ success: true, filename, chunksStored: blobs.length, blobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/query", async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: "query field required" });
    const result = await ragQuery(query, topK);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/documents", (req, res) => {
  res.json({
    count: Object.keys(blobMeta).length,
    documents: Object.entries(blobMeta).map(([blobId, meta]) => ({ blobId, ...meta })),
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Running on port ${PORT}`);
  console.log(`   POST /upload    — upload a .txt document`);
  console.log(`   POST /query     — ask a question`);
  console.log(`   GET  /documents — list indexed chunks\n`);
});
