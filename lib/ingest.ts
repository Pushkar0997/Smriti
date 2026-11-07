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
 * Default chars-per-token estimate. Gemini embedding tokenizer typically yields
 * ~3.5–4.5 chars/token for English prose; we use a conservative initial estimate.
 * The ratio is recalibrated after the first chunk from real countTokens data.
 */
const INITIAL_CPT_ESTIMATE = 4.0;

/**
 * Split text into chunks conforming strictly to CONTRACT.md:
 * - Tokenizer: Gemini API's own countTokens endpoint (passed via countTokensFn).
 * - Fixed chunk size ceiling: 500 tokens (hard ceiling, never overflows).
 * - Best-effort paragraph boundary splitting; single paragraphs > 500 tokens split mid-paragraph.
 * - 50-token overlap preserved across all splits, including mid-paragraph ones.
 * - Section label: nearest markdown heading if present, otherwise "chunk N" (1-indexed).
 *
 * Optimised (M1-CONTENT-03b): uses adaptive chars-per-token ratio to narrow binary search
 * starting point. Searches outward (exponential probe, then binary) from the estimate.
 * Gemini countTokens still decides every boundary.
 */
export async function chunkText(
  text: string,
  countTokensFn: (text: string) => Promise<number> = countTokens
): Promise<ChunkItem[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: ChunkItem[] = [];
  // Adaptive chars-per-token ratio, recalibrated after each chunk
  let cpt = INITIAL_CPT_ESTIMATE;

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

  /**
   * Find the maximum character length from `source` such that countTokens <= targetTokens.
   * Uses adaptive estimate to probe outward, then binary search to refine.
   *
   * Returns { charLen, tokens } where charLen is the max chars fitting and tokens is the count.
   */
  async function findMaxChars(
    source: string,
    targetTokens: number
  ): Promise<{ charLen: number; tokens: number }> {
    // Heuristic estimate of character position
    const estimate = Math.min(
      Math.floor(targetTokens * cpt),
      source.length
    );

    // If the estimate covers the whole remaining text, just check it
    if (estimate >= source.length) {
      const t = await countTokensFn(source);
      if (t <= targetTokens) {
        return { charLen: source.length, tokens: t };
      }
      // Estimate was too optimistic; the whole text exceeds target
      // Fall through to search below with knowledge that source.length is too much
    }

    // Exponential probe outward from estimate to bracket the true boundary
    let lo: number;
    let hi: number;

    // Check at the estimate point
    const estSlice = source.slice(0, estimate);
    const estTokens = await countTokensFn(estSlice);

    if (estTokens <= targetTokens) {
      // Estimate fits — probe upward to find where it breaks
      lo = estimate;
      hi = source.length;
      let step = Math.max(Math.floor(estimate * 0.25), 100);
      let probe = estimate;
      while (probe < source.length) {
        probe = Math.min(probe + step, source.length);
        const t = await countTokensFn(source.slice(0, probe));
        if (t > targetTokens) {
          hi = probe;
          break;
        }
        lo = probe;
        if (probe >= source.length) {
          return { charLen: source.length, tokens: t };
        }
        step = step * 2;
      }
    } else {
      // Estimate too large — probe downward
      hi = estimate;
      lo = 0;
      let step = Math.max(Math.floor(estimate * 0.25), 100);
      let probe = estimate;
      while (probe > 0) {
        probe = Math.max(probe - step, 1);
        const t = await countTokensFn(source.slice(0, probe));
        if (t <= targetTokens) {
          lo = probe;
          break;
        }
        hi = probe;
        step = step * 2;
      }
    }

    // Binary search within [lo, hi]
    let bestLen = lo;
    let bestTokens = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = await countTokensFn(source.slice(0, mid));
      if (t <= targetTokens) {
        bestLen = mid;
        bestTokens = t;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Verify the best fit if we haven't already
    if (bestTokens === 0 && bestLen > 0) {
      bestTokens = await countTokensFn(source.slice(0, bestLen));
    }

    return { charLen: bestLen, tokens: bestTokens };
  }

  let startIndex = 0;
  let chunkIndex = 1;

  while (startIndex < text.length) {
    const remainingText = text.slice(startIndex);
    if (remainingText.trim().length === 0) {
      break;
    }

    // Check if remaining text fits in one chunk
    const remainingTokens = await countTokensFn(remainingText);
    if (remainingTokens <= CHUNK_SIZE_TOKENS) {
      chunks.push({
        content: remainingText.trim(),
        sectionLabel: getNearestHeading(startIndex, chunkIndex),
        tokenCount: remainingTokens,
      });
      break;
    }

    // Find the maximum character cut fitting 500 tokens
    const { charLen: bestFitEnd } = await findMaxChars(remainingText, CHUNK_SIZE_TOKENS);

    // Try paragraph-boundary splitting within [0, bestFitEnd]
    const candidateSlice = remainingText.slice(0, bestFitEnd);
    const lastParagraphBreak = candidateSlice.lastIndexOf("\n\n");

    let chosenEnd = bestFitEnd;
    if (lastParagraphBreak > 0) {
      const paraSlice = candidateSlice.slice(0, lastParagraphBreak).trimEnd();
      const paraTokens = await countTokensFn(paraSlice);
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
    const chunkTokens = await countTokensFn(chunkContent);

    // Update adaptive chars-per-token ratio
    if (chunkTokens > 0) {
      cpt = chunkContent.length / chunkTokens;
    }

    chunks.push({
      content: chunkContent,
      sectionLabel: getNearestHeading(startIndex, chunkIndex),
      tokenCount: chunkTokens,
    });
    chunkIndex++;

    const chunkAbsEnd = startIndex + chosenEnd;

    // Calculate overlap using heuristic-guided search for suffix of chunkContent
    const overlapEstChars = Math.min(
      Math.floor(CHUNK_OVERLAP_TOKENS * cpt),
      chunkContent.length
    );

    let overlapLen = 0;
    {
      // Start from heuristic estimate and search outward
      const estLen = Math.min(overlapEstChars, chunkContent.length);
      const suffix = chunkContent.slice(chunkContent.length - estLen);
      const estTokens = await countTokensFn(suffix);

      if (estTokens <= CHUNK_OVERLAP_TOKENS) {
        // Probe upward
        overlapLen = estLen;
        let step = Math.max(Math.floor(estLen * 0.5), 50);
        let probe = estLen;
        let probHi = chunkContent.length;
        while (probe < chunkContent.length) {
          probe = Math.min(probe + step, chunkContent.length);
          const s = chunkContent.slice(chunkContent.length - probe);
          const t = await countTokensFn(s);
          if (t > CHUNK_OVERLAP_TOKENS) {
            probHi = probe;
            break;
          }
          overlapLen = probe;
          if (probe >= chunkContent.length) break;
          step = step * 2;
        }
        // Binary refine between overlapLen and probHi
        let bLo = overlapLen;
        let bHi = probHi;
        while (bLo <= bHi) {
          const mid = Math.floor((bLo + bHi) / 2);
          const s = chunkContent.slice(chunkContent.length - mid);
          const t = await countTokensFn(s);
          if (t <= CHUNK_OVERLAP_TOKENS) {
            overlapLen = mid;
            bLo = mid + 1;
          } else {
            bHi = mid - 1;
          }
        }
      } else {
        // Probe downward
        let probLo = 0;
        let step = Math.max(Math.floor(estLen * 0.5), 50);
        let probe = estLen;
        while (probe > 0) {
          probe = Math.max(probe - step, 1);
          const s = chunkContent.slice(chunkContent.length - probe);
          const t = await countTokensFn(s);
          if (t <= CHUNK_OVERLAP_TOKENS) {
            probLo = probe;
            break;
          }
          step = step * 2;
        }
        // Binary refine
        let bLo = probLo;
        let bHi = estLen;
        while (bLo <= bHi) {
          const mid = Math.floor((bLo + bHi) / 2);
          const s = chunkContent.slice(chunkContent.length - mid);
          const t = await countTokensFn(s);
          if (t <= CHUNK_OVERLAP_TOKENS) {
            overlapLen = mid;
            bLo = mid + 1;
          } else {
            bHi = mid - 1;
          }
        }
      }
    }

    // Try snapping overlap start forward to a space boundary
    let nextStart = chunkAbsEnd - overlapLen;
    if (overlapLen > 0 && nextStart < chunkAbsEnd) {
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
