import { GoogleGenAI } from "@google/genai";
import type { RetrievedChunk } from "./retrieval";

/**
 * Gemini Embedding Model & Configuration
 * Pinned per spec/architecture.md §1 & CONTRACT.md
 * - gemini-embedding-001: Verified from live Google AI Studio documentation (June 2025 stable text embedding model)
 * - EMBEDDING_DIM: 768 (Matryoshka Representation Learning / MRL-scaled down from 3072)
 */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 768;

let geminiClientInstance: GoogleGenAI | null = null;

/**
 * Get or initialize the GoogleGenAI client singleton.
 * Reads GEMINI_API_KEY from environment.
 */
export function getGeminiClient(): GoogleGenAI {
  if (geminiClientInstance) {
    return geminiClientInstance;
  }

  // Load .env.local if running in standalone script / offline execution
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ignored if file does not exist or already loaded
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY: Please ensure GEMINI_API_KEY is set in .env.local or environment variables."
    );
  }

  geminiClientInstance = new GoogleGenAI({ apiKey });
  return geminiClientInstance;
}

/**
 * Count tokens using the Gemini API countTokens endpoint.
 * Pinned in CONTRACT.md: Must use Gemini's own tokenizer, not a character or word-count heuristic.
 */
export async function countTokens(
  text: string,
  model: string = EMBEDDING_MODEL
): Promise<number> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  const client = getGeminiClient();
  const response = await client.models.countTokens({
    model,
    contents: text,
  });

  return response.totalTokens ?? 0;
}

/**
 * Embed a single document chunk or content for retrieval storage.
 * Uses taskType: "RETRIEVAL_DOCUMENT" and outputDimensionality: 768.
 */
export async function embedChunk(
  text: string,
  title?: string
): Promise<number[]> {
  const results = await embedChunks([text], title);
  if (!results || results.length === 0) {
    throw new Error("Failed to generate embedding: empty result returned from Gemini API.");
  }
  return results[0];
}

/**
 * Embed multiple document chunks in batches for retrieval storage.
 * Uses taskType: "RETRIEVAL_DOCUMENT" and outputDimensionality: 768.
 */
export async function embedChunks(
  texts: string[],
  title?: string
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const client = getGeminiClient();
  const batchSize = 20; // Safe batch size for embedding requests
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: EMBEDDING_DIM,
        ...(title ? { title } : {}),
      },
    });

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error(
        `Gemini embedding API returned no embeddings for batch starting at index ${i}.`
      );
    }

    for (const item of response.embeddings) {
      if (!item.values || item.values.length !== EMBEDDING_DIM) {
        throw new Error(
          `Expected embedding dimension ${EMBEDDING_DIM}, but received ${item.values?.length ?? 0}.`
        );
      }
      allEmbeddings.push(item.values);
    }
  }

  return allEmbeddings;
}

/**
 * Embed a user query for similarity search against stored chunks.
 * Uses taskType: "RETRIEVAL_QUERY" and outputDimensionality: 768.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("Cannot embed an empty query.");
  }

  const client = getGeminiClient();
  const response = await client.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: query,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIM,
    },
  });

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding || embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `Expected query embedding dimension ${EMBEDDING_DIM}, but received ${embedding?.length ?? 0}.`
    );
  }

  return embedding;
}

/**
 * Gemini Text Generation Model
 * Pinned per spec/architecture.md §1, D-006, D-007, and live Google AI Studio API verification:
 * - gemini-3.5-flash-lite: Active Flash-Lite production model on Google AI Studio.
 * - Lightest free-tier model with high RPM capacity and zero thinking-token overhead by default.
 */
export const GENERATION_MODEL = "gemini-3.5-flash-lite";

/**
 * System instruction enforcing the prompt-level half of INV-1 per spec/architecture.md §4b:
 * - Model answers ONLY from the provided context chunks.
 * - If the context doesn't contain the answer, say so explicitly rather than using general knowledge.
 * - Must not invent exam questions, marks, or names not present in the context.
 */
export const GROUNDED_ANSWER_SYSTEM_INSTRUCTION = `You are Smriti, an academic study assistant answering exam preparation questions.
Answer the user's question ONLY using the provided source context chunks.
Rules:
1. Rely strictly on the information in the provided context. If the context does not contain the answer, state clearly and explicitly that the material does not contain the answer rather than using outside or general knowledge.
2. Do not invent, extrapolate, or hallucinate exam questions, marks, grading schemes, or professor names that are not present in the context.
3. Be concise, direct, and academically precise.`;

/**
 * Generate a grounded answer from retrieved context chunks using the Gemini Flash-Lite model.
 * Matches LLMGenerateFn signature: (query: string, contextChunks: RetrievedChunk[]) => Promise<string>
 * Pinned per spec/architecture.md §4b & CONTRACT.md
 */
export async function generateGroundedAnswer(
  query: string,
  contextChunks: RetrievedChunk[]
): Promise<string> {
  const client = getGeminiClient();

  const formattedContext = contextChunks
    .map(
      (chunk, index) =>
        `--- BEGIN SOURCE CHUNK ${index + 1} [Document: ${chunk.documentTitle}, Section: ${chunk.sectionLabel}] ---\n${chunk.content}\n--- END SOURCE CHUNK ${index + 1} ---`
    )
    .join("\n\n");

  const promptContent = `Provided Context:\n${formattedContext}\n\nUser Question: ${query}`;

  const response = await client.models.generateContent({
    model: GENERATION_MODEL,
    contents: promptContent,
    config: {
      systemInstruction: GROUNDED_ANSWER_SYSTEM_INSTRUCTION,
    },
  });

  const answer = response.text?.trim();
  if (!answer) {
    throw new Error("Gemini API returned an empty response text.");
  }

  return answer;
}
