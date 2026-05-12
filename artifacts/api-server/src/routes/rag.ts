import { Router, type IRouter } from "express";
import multer from "multer";
import { chunkDocument, storeChunk, listDocuments, ragQuery } from "../lib/rag";
import {
  ListDocumentsResponse,
  UploadDocumentResponse,
  QueryDocumentsBody,
  QueryDocumentsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/rag/documents", async (_req, res): Promise<void> => {
  const docs = listDocuments();
  res.json(
    ListDocumentsResponse.parse({
      count: docs.length,
      documents: docs,
    }),
  );
});

router.post(
  "/rag/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const text = req.file.buffer.toString("utf-8");
    const filename = req.file.originalname;
    const chunks = chunkDocument(text, filename);
    const blobs: Array<{ blobId: string; chunkIndex: number }> = [];

    for (const chunk of chunks) {
      const blobId = storeChunk(chunk);
      blobs.push({ blobId, chunkIndex: chunk.index });
    }

    res.json(
      UploadDocumentResponse.parse({
        success: true,
        filename,
        chunksStored: blobs.length,
        blobs,
      }),
    );
  },
);

router.post("/rag/query", async (req, res): Promise<void> => {
  const parsed = QueryDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, topK = 5 } = parsed.data;
  const result = await ragQuery(query, topK ?? 5);

  res.json(QueryDocumentsResponse.parse(result));
});

export default router;
