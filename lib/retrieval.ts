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
