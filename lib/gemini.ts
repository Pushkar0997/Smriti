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
 * Maximum retry attempts for transient API errors (429, 5xx, network).
 */
const MAX_RETRIES = 4;

/**
 * Classify an error as retryable (429, 5xx, or network failure).
 * Never logs request content per AGENTS.md / INV-3 spirit.
 */
function isRetryableError(err: unknown): { retryable: boolean; is429: boolean } {
  const errObj = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : null;
  const status = errObj ? (errObj.status ?? errObj.statusCode) : undefined;
  const msg: string = typeof errObj?.message === "string" ? errObj.message : String(err ?? "");

  const is429 =
    status === 429 ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED");

  const is5xx =
    (typeof status === "number" && status >= 500 && status < 600) ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("INTERNAL") ||
    msg.includes("The service is currently unavailable");

  const isNetwork =
    msg.includes("fetch failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENETUNREACH") ||
    msg.includes("EAI_AGAIN") ||
    msg.includes("socket hang up") ||
    msg.includes("getaddrinfo");

  return { retryable: is429 || is5xx || isNetwork, is429 };
}

/**
 * Compute exponential backoff delay with jitter.
 * Base delay doubles each attempt; jitter adds up to 50% of base.
 */
function backoffMs(attempt: number, baseMs: number = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * exponential * 0.5);
  return exponential + jitter;
}

/**
 * Count tokens using the Gemini API countTokens endpoint.
 * Pinned in CONTRACT.md: Must use Gemini's own tokenizer, not a character or word-count heuristic.
 *
 * Retries with exponential backoff + jitter on 429, 5xx, and network errors.
 * Never logs request content.
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.countTokens({
        model,
        contents: text,
      });
      return response.totalTokens ?? 0;
    } catch (err: unknown) {
      const { retryable } = isRetryableError(err);
      if (retryable && attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs(attempt))
        );
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but TypeScript needs it
  return 0;
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

type EmbedContentResponse = Awaited<ReturnType<GoogleGenAI["models"]["embedContent"]>>;

/**
 * Embed multiple document chunks in batches for retrieval storage.
 * Uses taskType: "RETRIEVAL_DOCUMENT" and outputDimensionality: 768.
 *
 * Retries each batch with exponential backoff + jitter on 429, 5xx, and network errors.
 * Never logs request content.
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

    let response: EmbedContentResponse | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch,
          config: {
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBEDDING_DIM,
            ...(title ? { title } : {}),
          },
        });
        break;
      } catch (err: unknown) {
        const { retryable } = isRetryableError(err);
        if (retryable && attempt < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, backoffMs(attempt, 2000))
          );
          continue;
        }
        throw err;
      }
    }

    if (!response?.embeddings || response.embeddings.length === 0) {
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

  let response: EmbedContentResponse | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: query,
        config: {
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: EMBEDDING_DIM,
        },
      });
      break;
    } catch (err: unknown) {
      const { retryable } = isRetryableError(err);
      if (retryable && attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs(attempt))
        );
        continue;
      }
      throw err;
    }
  }

  const embedding = response?.embeddings?.[0]?.values;
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

// Exported for testing retry logic
export { isRetryableError, backoffMs, MAX_RETRIES };
