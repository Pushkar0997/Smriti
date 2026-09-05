import { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, MatchChunkResult } from "./supabase";
import { embedQuery } from "./gemini";

/**
 * Pinned Retrieval Constants per CONTRACT.md
 */
export const TOP_K = 5;
export const SIMILARITY_THRESHOLD = 0.65;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  sectionLabel: string;
  documentTitle: string;
  similarity: number;
}

export interface RetrieveOptions {
  topK?: number;
  matchThreshold?: number;
  supabaseClient?: SupabaseClient;
}

/**
 * Embed an incoming user query and perform vector cosine similarity search in Supabase pgvector.
 *
 * - Uses embedQuery from lib/gemini.ts (RETRIEVAL_QUERY task type, 768 dimensions).
 * - Invokes match_chunks RPC in Supabase, passing TOP_K = 5 and SIMILARITY_THRESHOLD = 0.65 per CONTRACT.md (D-011).
 * - Returns top-k chunks with their similarity scores and document titles.
 */
export async function retrieveChunks(
  query: string,
  options?: RetrieveOptions
): Promise<RetrievedChunk[]> {
  const trimmed = query?.trim();
  if (!trimmed) {
    throw new Error("Query cannot be empty.");
  }

  // Ensure environment variables are loaded if running offline / scripts
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ignored
    }
  }

  const topK = options?.topK ?? TOP_K;
  const matchThreshold = options?.matchThreshold ?? SIMILARITY_THRESHOLD;
  const supabase = options?.supabaseClient || getSupabaseAdmin();

  // 1. Embed incoming query using RETRIEVAL_QUERY task type
  const queryEmbedding = await embedQuery(trimmed);

  // 2. Call match_chunks RPC in Supabase pgvector
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: topK,
  });

  if (error) {
    throw new Error(`Supabase match_chunks RPC failed: ${error.message}`);
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  // 3. Map to camelCase TypeScript structures
  return data.map((row: MatchChunkResult) => ({
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    sectionLabel: row.section_label,
    documentTitle: row.document_title,
    similarity: typeof row.similarity === "number" ? row.similarity : parseFloat(String(row.similarity)),
  }));
}

/**
 * INV-1 Fixed Fallback Response per CONTRACT.md
 * Returned when retrieval does not return a chunk above SIMILARITY_THRESHOLD.
 * Under INV-1, this response is returned directly and the LLM is NEVER called.
 */
export interface NoMatchResponse {
  readonly code: "NO_MATCH";
  readonly message: "not in my material";
}

export const NO_MATCH_RESPONSE: NoMatchResponse = Object.freeze({
  code: "NO_MATCH",
  message: "not in my material",
});

/**
 * Source citation structure per CONTRACT.md
 * Each element: { document: string, section: string }
 */
export interface Citation {
  document: string;
  section: string;
}

export type GroundCheckResult =
  | {
      passed: true;
      topScore: number;
      chunks: RetrievedChunk[];
      citations: Citation[];
    }
  | {
      passed: false;
      topScore: number;
      response: NoMatchResponse;
    };

/**
 * Format citation elements from retrieved chunks per CONTRACT.md.
 * Deduplicates citations sharing the exact same document and section.
 */
export function formatCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const chunk of chunks) {
    const section = chunk.sectionLabel?.trim() || "chunk";
    const key = `${chunk.documentTitle}::${section}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        document: chunk.documentTitle,
        section,
      });
    }
  }

  return citations;
}

/**
 * INV-1 Ground Check:
 * Evaluates whether retrieved chunks satisfy INV-1 requirements.
 *
 * Rules per CONTRACT.md:
 * - Applied to the TOP-SCORING chunk only:
 *   If the best match is below SIMILARITY_THRESHOLD (or empty), the fallback fires
 *   regardless of what the other chunks scored.
 * - If top chunk score >= SIMILARITY_THRESHOLD: passes, returning all chunks
 *   scoring >= threshold as context, along with structured citations.
 */
export function groundCheck(
  chunks: RetrievedChunk[],
  threshold: number = SIMILARITY_THRESHOLD
): GroundCheckResult {
  if (!chunks || chunks.length === 0) {
    return {
      passed: false,
      topScore: 0,
      response: NO_MATCH_RESPONSE,
    };
  }

  // Find top score among retrieved chunks
  const topScore = Math.max(...chunks.map((c) => c.similarity));

  if (topScore < threshold) {
    return {
      passed: false,
      topScore,
      response: NO_MATCH_RESPONSE,
    };
  }

  // All chunks meeting or exceeding threshold are passed as context and cited
  const qualifyingChunks = chunks.filter((c) => c.similarity >= threshold);

  return {
    passed: true,
    topScore,
    chunks: qualifyingChunks,
    citations: formatCitations(qualifyingChunks),
  };
}

export type LLMGenerateFn = (
  query: string,
  contextChunks: RetrievedChunk[]
) => Promise<string>;

export type GroundedAnswerResult =
  | {
      answer: string;
      citations: Citation[];
    }
  | NoMatchResponse;

/**
 * Executes a grounded query with strict INV-1 enforcement.
 *
 * Enforces the strict NO-THIRD-PATH guarantee:
 * 1. Retrieves candidate chunks via retrieveChunks.
 * 2. Runs groundCheck on the top-scoring chunk against SIMILARITY_THRESHOLD (0.65).
 * 3. Path A (ground-check fails): Returns NO_MATCH_RESPONSE immediately.
 *    The generateAnswer function is NEVER called.
 * 4. Path B (ground-check passes): Invokes generateAnswer with query and qualifying chunks,
 *    returning { answer, citations }.
 *
 * There is no third path: no disclaimer fallback, no ungrounded retry.
 */
export async function executeGroundedQuery(
  query: string,
  generateAnswer: LLMGenerateFn,
  options?: RetrieveOptions
): Promise<GroundedAnswerResult> {
  // 1. Retrieve candidate chunks
  const chunks = await retrieveChunks(query, options);

  // 2. Perform ground-check on the top-scoring chunk against SIMILARITY_THRESHOLD
  const check = groundCheck(chunks, SIMILARITY_THRESHOLD);

  // Path A: Low confidence or empty retrieval -> fixed fallback, zero LLM invocation
  if (!check.passed) {
    return check.response;
  }

  // Path B: Grounded match -> invoke LLM generator with retrieved context
  const answer = await generateAnswer(query, check.chunks);

  return {
    answer,
    citations: check.citations,
  };
}

