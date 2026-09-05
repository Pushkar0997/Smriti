import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIMILARITY_THRESHOLD,
  NO_MATCH_RESPONSE,
  RetrievedChunk,
  groundCheck,
  formatCitations,
  executeGroundedQuery,
  retrieveChunks,
  LLMGenerateFn,
} from "../lib/retrieval";

// Ensure environment variables are loaded if running offline / tests
if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignored
  }
}

describe("INV-1: Grounded answers only", () => {
  describe("Unit: groundCheck() & formatCitations()", () => {
    it("returns NO_MATCH when chunk array is empty", () => {
      const result = groundCheck([]);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.topScore, 0);
      assert.deepStrictEqual(result.response, {
        code: "NO_MATCH",
        message: "not in my material",
      });
      assert.deepStrictEqual(result.response, NO_MATCH_RESPONSE);
    });

    it("returns NO_MATCH when top score is below SIMILARITY_THRESHOLD (0.65)", () => {
      const lowChunks: RetrievedChunk[] = [
        {
          id: "1",
          documentId: "doc-1",
          content: "Cellular respiration produces ATP.",
          sectionLabel: "Biology",
          documentTitle: "biology.pdf",
          similarity: 0.4576,
        },
        {
          id: "2",
          documentId: "doc-1",
          content: "Glycolysis occurs in cytoplasm.",
          sectionLabel: "Biology",
          documentTitle: "biology.pdf",
          similarity: 0.412,
        },
      ];

      const result = groundCheck(lowChunks);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.topScore, 0.4576);
      assert.deepStrictEqual(result.response, NO_MATCH_RESPONSE);
    });

    it("evaluates top-scoring chunk only: fails if top score is 0.6499 (< 0.65)", () => {
      const borderlineChunks: RetrievedChunk[] = [
        {
          id: "1",
          documentId: "doc-1",
          content: "Borderline match.",
          sectionLabel: "Section 1",
          documentTitle: "notes.pdf",
          similarity: 0.6499,
        },
        {
          id: "2",
          documentId: "doc-1",
          content: "Another borderline match.",
          sectionLabel: "Section 2",
          documentTitle: "notes.pdf",
          similarity: 0.63,
        },
      ];

      const result = groundCheck(borderlineChunks);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.topScore, 0.6499);
      assert.deepStrictEqual(result.response, NO_MATCH_RESPONSE);
    });

    it("passes when top score meets or exceeds SIMILARITY_THRESHOLD (0.65)", () => {
      const mixedChunks: RetrievedChunk[] = [
        {
          id: "1",
          documentId: "doc-1",
          content: "ARIES recovery analysis phase.",
          sectionLabel: "3. ARIES Crash Recovery Protocol",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.765,
        },
        {
          id: "2",
          documentId: "doc-1",
          content: "Low relevance chunk from another section.",
          sectionLabel: "1. ACID Properties",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.52,
        },
      ];

      const result = groundCheck(mixedChunks);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.topScore, 0.765);
      // Only chunks >= threshold are kept as context and cited
      assert.strictEqual(result.chunks.length, 1);
      assert.strictEqual(result.chunks[0].id, "1");
      assert.deepStrictEqual(result.citations, [
        {
          document: "DBMS-Test-Fixture.md",
          section: "3. ARIES Crash Recovery Protocol",
        },
      ]);
    });

    it("formatCitations deduplicates identical document and section labels", () => {
      const duplicateChunks: RetrievedChunk[] = [
        {
          id: "1",
          documentId: "doc-1",
          content: "Chunk 1",
          sectionLabel: "Heading A",
          documentTitle: "doc.md",
          similarity: 0.8,
        },
        {
          id: "2",
          documentId: "doc-1",
          content: "Chunk 2",
          sectionLabel: "Heading A",
          documentTitle: "doc.md",
          similarity: 0.75,
        },
        {
          id: "3",
          documentId: "doc-1",
          content: "Chunk 3",
          sectionLabel: "Heading B",
          documentTitle: "doc.md",
          similarity: 0.7,
        },
      ];

      const citations = formatCitations(duplicateChunks);
      assert.deepStrictEqual(citations, [
        { document: "doc.md", section: "Heading A" },
        { document: "doc.md", section: "Heading B" },
      ]);
    });
  });

  describe("Unit: executeGroundedQuery() No-Third-Path enforcement", () => {
    it("never calls LLM function when retrieval yields no chunks above threshold", async () => {
      let llmCalled = false;
      let llmCallCount = 0;

      const mockLLM: LLMGenerateFn = async () => {
        llmCalled = true;
        llmCallCount++;
        return "This should never be generated.";
      };

      // Mock client that returns empty or low-scoring chunks
      const mockSupabase = {
        rpc: async () => ({
          data: [
            {
              id: "low-1",
              document_id: "doc-x",
              content: "Completely off-topic content",
              section_label: "Section X",
              document_title: "offtopic.md",
              similarity: 0.42,
            },
          ],
          error: null,
        }),
      };

      const result = await executeGroundedQuery(
        "Off topic query",
        mockLLM,
        { supabaseClient: mockSupabase as any, matchThreshold: 0.0 }
      );

      // Assert NO_MATCH response
      assert.deepStrictEqual(result, {
        code: "NO_MATCH",
        message: "not in my material",
      });

      // Assert LLM function was NEVER invoked
      assert.strictEqual(llmCalled, false, "LLM was called when retrieval was below threshold!");
      assert.strictEqual(llmCallCount, 0);
    });

    it("surfaces retrieval errors and never falls through to LLM (Negative Test N-02)", async () => {
      let llmCalled = false;

      const mockLLM: LLMGenerateFn = async () => {
        llmCalled = true;
        return "Should never run.";
      };

      const mockSupabaseFailing = {
        rpc: async () => ({
          data: null,
          error: { message: "Simulated network failure to vector database" },
        }),
      };

      await assert.rejects(
        async () => {
          await executeGroundedQuery(
            "Any query",
            mockLLM,
            { supabaseClient: mockSupabaseFailing as any }
          );
        },
        /Supabase match_chunks RPC failed: Simulated network failure/
      );

      assert.strictEqual(llmCalled, false, "LLM was called after retrieval failure!");
    });

    it("calls LLM function exactly once when retrieval passes ground-check", async () => {
      let llmCallCount = 0;
      let passedQuery = "";
      let passedChunksCount = 0;

      const mockLLM: LLMGenerateFn = async (query, chunks) => {
        llmCallCount++;
        passedQuery = query;
        passedChunksCount = chunks.length;
        return "The three phases of ARIES are Analysis, Redo, and Undo.";
      };

      const mockSupabaseSuccess = {
        rpc: async () => ({
          data: [
            {
              id: "aries-1",
              document_id: "doc-1",
              content: "ARIES Recovery: Analysis, Redo, Undo.",
              section_label: "3. ARIES Crash Recovery Protocol",
              document_title: "DBMS-Test-Fixture.md",
              similarity: 0.78,
            },
          ],
          error: null,
        }),
      };

      const result = await executeGroundedQuery(
        "Explain ARIES phases",
        mockLLM,
        { supabaseClient: mockSupabaseSuccess as any }
      );

      assert.strictEqual(llmCallCount, 1);
      assert.strictEqual(passedQuery, "Explain ARIES phases");
      assert.strictEqual(passedChunksCount, 1);
      assert.deepStrictEqual(result, {
        answer: "The three phases of ARIES are Analysis, Redo, and Undo.",
        citations: [
          {
            document: "DBMS-Test-Fixture.md",
            section: "3. ARIES Crash Recovery Protocol",
          },
        ],
      });
    });
  });

  describe("Integration: Live fixture evaluation (persisted M0-ING-02 fixture)", () => {
    it("passes ground-check for DBMS fixture query and provides grounded citations", async () => {
      let llmCallCount = 0;
      let receivedChunks: RetrievedChunk[] = [];

      const mockLLM: LLMGenerateFn = async (_query, chunks) => {
        llmCallCount++;
        receivedChunks = chunks;
        return "Mocked grounded answer.";
      };

      const query = "Explain the ARIES recovery protocol and its three distinct phases";
      const result = await executeGroundedQuery(query, mockLLM);

      // Verify LLM was invoked with qualifying chunks
      assert.strictEqual(llmCallCount, 1, "LLM should have been called for matching query");
      assert.ok(receivedChunks.length > 0, "Expected at least 1 chunk to pass threshold");
      assert.ok(
        receivedChunks[0].similarity >= SIMILARITY_THRESHOLD,
        `Top chunk similarity ${receivedChunks[0].similarity} should be >= ${SIMILARITY_THRESHOLD}`
      );

      // Verify response structure
      if ("answer" in result) {
        assert.strictEqual(result.answer, "Mocked grounded answer.");
        assert.ok(result.citations.length > 0);
        assert.strictEqual(result.citations[0].document, "DBMS-Test-Fixture.md");
      } else {
        assert.fail("Expected grounded answer result, got NO_MATCH fallback");
      }
    });

    it("fails ground-check for cellular respiration query and NEVER calls LLM", async () => {
      let llmCallCount = 0;

      const mockLLM: LLMGenerateFn = async () => {
        llmCallCount++;
        return "Ungrounded guess that should never happen.";
      };

      const query = "How does cellular respiration and the Krebs cycle produce ATP in mitochondria?";
      const result = await executeGroundedQuery(query, mockLLM);

      // Assert exact NO_MATCH fallback
      assert.deepStrictEqual(result, {
        code: "NO_MATCH",
        message: "not in my material",
      });

      // Assert LLM was never called
      assert.strictEqual(
        llmCallCount,
        0,
        "INV-1 VIOLATION: LLM was invoked for off-topic query below SIMILARITY_THRESHOLD!"
      );
    });
  });
});
