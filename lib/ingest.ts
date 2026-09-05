import { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase";
import { countTokens, embedChunks, EMBEDDING_DIM } from "./gemini";

/**
 * Pinned Constants per CONTRACT.md
 */
export const CHUNK_SIZE_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 50;
export { EMBEDDING_DIM };

export interface ChunkItem {
  content: string;
  sectionLabel: string;
  tokenCount: number;
}

export interface IngestDocumentParams {
  title: string;
  subject: string;
  content: string;
}

export interface IngestDocumentResult {
  documentId: string;
  title: string;
  subject: string;
  chunkCount: number;
  chunks: {
    id: string;
    sectionLabel: string;
    tokenCount: number;
  }[];
}

/**
 * Split text into chunks conforming strictly to CONTRACT.md:
 * - Tokenizer: Gemini API's own countTokens endpoint (passed via countTokensFn).
 * - Fixed chunk size ceiling: 500 tokens (hard ceiling, never overflows).
 * - Best-effort paragraph boundary splitting; single paragraphs > 500 tokens split mid-paragraph.
 * - 50-token overlap preserved across all splits, including mid-paragraph ones.
 * - Section label: nearest markdown heading if present, otherwise "chunk N" (1-indexed).
 */
export async function chunkText(
  text: string,
  countTokensFn: (text: string) => Promise<number> = countTokens
): Promise<ChunkItem[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: ChunkItem[] = [];
  const tokenCache = new Map<string, number>();

  async function getTokens(str: string): Promise<number> {
    const trimmed = str.trim();
    if (!trimmed) return 0;
    if (tokenCache.has(str)) {
      return tokenCache.get(str)!;
    }
    const count = await countTokensFn(str);
    tokenCache.set(str, count);
    return count;
  }

  // Extract markdown headings with their character index in the text
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: { index: number; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    headings.push({
      index: match.index,
      title: match[2].trim(),
    });
  }

  function getNearestHeading(charIndex: number, chunkNumber: number): string {
    let nearest: string | null = null;
    for (const h of headings) {
      if (h.index <= charIndex) {
        nearest = h.title;
      } else {
        break;
      }
    }
    return nearest || `chunk ${chunkNumber}`;
  }

  let startIndex = 0;
  let chunkIndex = 1;

  while (startIndex < text.length) {
    const remainingText = text.slice(startIndex);
    if (remainingText.trim().length === 0) {
      break;
    }

    const remainingTokens = await getTokens(remainingText);
    if (remainingTokens <= CHUNK_SIZE_TOKENS) {
      chunks.push({
        content: remainingText.trim(),
        sectionLabel: getNearestHeading(startIndex, chunkIndex),
        tokenCount: remainingTokens,
      });
      break;
    }

    // Binary search for maximum character slice that satisfies token count <= CHUNK_SIZE_TOKENS
    let low = 1;
    let high = remainingText.length;
    let bestFitEnd = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = remainingText.slice(0, mid);
      const tokens = await getTokens(slice);

      if (tokens <= CHUNK_SIZE_TOKENS) {
        bestFitEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // bestFitEnd is the maximum character cut where tokens <= 500
    // Try paragraph-boundary splitting first within [0, bestFitEnd]
    const candidateSlice = remainingText.slice(0, bestFitEnd);
    const lastParagraphBreak = candidateSlice.lastIndexOf("\n\n");

    let chosenEnd = bestFitEnd;
    if (lastParagraphBreak > 0) {
      const paraSlice = candidateSlice.slice(0, lastParagraphBreak).trimEnd();
      const paraTokens = await getTokens(paraSlice);
      // Prefer paragraph break if it retains a meaningful chunk size (at least 50 tokens)
      if (paraTokens >= 50) {
        chosenEnd = lastParagraphBreak;
      }
    }

    if (chosenEnd === bestFitEnd) {
      // If no paragraph boundary or paragraph was too small, try sentence boundary (. ? !\n)
      const lastSentenceBreak = Math.max(
        candidateSlice.lastIndexOf(". "),
        candidateSlice.lastIndexOf("? "),
        candidateSlice.lastIndexOf("! "),
        candidateSlice.lastIndexOf("\n")
      );
      if (lastSentenceBreak > candidateSlice.length * 0.5) {
        chosenEnd = lastSentenceBreak + 1;
      } else {
        // Fallback to word boundary
        const lastSpace = candidateSlice.lastIndexOf(" ");
        if (lastSpace > 0) {
          chosenEnd = lastSpace;
        }
      }
    }

    const chunkContent = remainingText.slice(0, chosenEnd).trim();
    const chunkTokens = await getTokens(chunkContent);

    chunks.push({
      content: chunkContent,
      sectionLabel: getNearestHeading(startIndex, chunkIndex),
      tokenCount: chunkTokens,
    });
    chunkIndex++;

    const chunkAbsEnd = startIndex + chosenEnd;

    // Calculate overlap: find start position for next chunk such that
    // the suffix of chunkContent has <= CHUNK_OVERLAP_TOKENS (50)
    let overlapLow = 1;
    let overlapHigh = chunkContent.length;
    let bestOverlapLen = 0;

    while (overlapLow <= overlapHigh) {
      const mid = Math.floor((overlapLow + overlapHigh) / 2);
      const suffix = chunkContent.slice(chunkContent.length - mid);
      const tokens = await getTokens(suffix);

      if (tokens <= CHUNK_OVERLAP_TOKENS) {
        bestOverlapLen = mid;
        overlapLow = mid + 1;
      } else {
        overlapHigh = mid - 1;
      }
    }

    // Try snapping overlap start forward to a space boundary
    let nextStart = chunkAbsEnd - bestOverlapLen;
    if (bestOverlapLen > 0 && nextStart < chunkAbsEnd) {
      const spaceIdx = text.indexOf(" ", nextStart);
      if (spaceIdx !== -1 && spaceIdx < chunkAbsEnd) {
        nextStart = spaceIdx + 1;
      }
    }

    // Strict forward progress guarantee
    if (nextStart <= startIndex || nextStart >= chunkAbsEnd) {
      nextStart = chunkAbsEnd;
    }

    startIndex = nextStart;
  }

  return chunks;
}

/**
 * Ingest a source document end-to-end:
 * 1. Insert document row into `documents` table.
 * 2. Chunk text via chunkText using Gemini countTokens.
 * 3. Generate 768-dim embeddings via Gemini embedding model.
 * 4. Insert chunks into `chunks` table.
 */
export async function ingestDocument(
  params: IngestDocumentParams,
  supabaseClient?: SupabaseClient
): Promise<IngestDocumentResult> {
  const { title, subject, content } = params;

  if (!title || !title.trim()) {
    throw new Error("Document title is required.");
  }
  if (!subject || !subject.trim()) {
    throw new Error("Document subject is required.");
  }
  if (!content || !content.trim()) {
    throw new Error("Document content is required.");
  }

  // Ensure environment variables are loaded if running offline
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ignored
    }
  }

  const supabase = supabaseClient || getSupabaseAdmin();

  // 1. Chunk text
  const chunks = await chunkText(content, countTokens);
  if (chunks.length === 0) {
    throw new Error("Document content yielded 0 chunks.");
  }

  // 2. Insert document record
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      title: title.trim(),
      subject: subject.trim(),
    })
    .select("id, title, subject, uploaded_at")
    .single();

  if (docError || !doc) {
    throw new Error(`Failed to insert document into Supabase: ${docError?.message ?? "unknown error"}`);
  }

  // 3. Generate embeddings
  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await embedChunks(chunkTexts, title.trim());

  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: generated ${embeddings.length} embeddings for ${chunks.length} chunks.`
    );
  }

  // 4. Insert chunks into pgvector
  const chunkRows = chunks.map((c, i) => ({
    document_id: doc.id,
    content: c.content,
    embedding: embeddings[i],
    section_label: c.sectionLabel,
  }));

  const { data: insertedChunks, error: chunkError } = await supabase
    .from("chunks")
    .insert(chunkRows)
    .select("id, section_label");

  if (chunkError || !insertedChunks) {
    throw new Error(`Failed to insert chunks into Supabase: ${chunkError?.message ?? "unknown error"}`);
  }

  return {
    documentId: doc.id,
    title: doc.title,
    subject: doc.subject,
    chunkCount: insertedChunks.length,
    chunks: insertedChunks.map((ic, i) => ({
      id: ic.id,
      sectionLabel: ic.section_label,
      tokenCount: chunks[i].tokenCount,
    })),
  };
}
