import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  SIMILARITY_THRESHOLD,
  RELEVANCE_MARGIN,
  NO_MATCH_RESPONSE,
  RetrievedChunk,
  groundCheck,
  formatCitations,
  executeGroundedQuery,
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

    it("filters qualifying chunks using RELEVANCE_MARGIN relative to top score", () => {
      // Simulates real scores observed from ARIES fixture query:
      // top score = 0.7620; cutoff = 0.7620 - 0.06 = 0.7020
      const fixtureChunks: RetrievedChunk[] = [
        {
          id: "1",
          documentId: "doc-1",
          content: "ARIES recovery question 3",
          sectionLabel: "Question 3: Comprehensive Analysis of ARIES Crash Recovery Protocol",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.762,
        },
        {
          id: "2",
          documentId: "doc-1",
          content: "Phase 2 Redo phase",
          sectionLabel: "4. Phase 2: The Redo Phase",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.7392,
        },
        {
          id: "3",
          documentId: "doc-1",
          content: "Checkpointing mechanics",
          sectionLabel: "2. Checkpointing Mechanics",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.7148,
        },
        {
          id: "4",
          documentId: "doc-1",
          content: "Write Skew anomaly under Snapshot Isolation",
          sectionLabel: "Question 2: Write Skew Anomaly under Snapshot Isolation",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.6914, // Clears absolute threshold 0.65, but fails topScore - 0.06 (0.7020)
        },
        {
          id: "5",
          documentId: "doc-1",
          content: "Two Phase Locking",
          sectionLabel: "Question 4: Two-Phase Locking (2PL) Variants and Concurrency Guarantees",
          documentTitle: "DBMS-Test-Fixture.md",
          similarity: 0.6702, // Clears absolute threshold 0.65, but fails topScore - 0.06 (0.7020)
        },
      ];

      const result = groundCheck(fixtureChunks, SIMILARITY_THRESHOLD, RELEVANCE_MARGIN);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.topScore, 0.762);

      // Only the 3 genuine ARIES chunks qualify (>= 0.7020)
      assert.strictEqual(result.chunks.length, 3);
      assert.deepStrictEqual(
        result.chunks.map((c) => c.id),
        ["1", "2", "3"]
      );
      assert.deepStrictEqual(result.citations, [
        {
          document: "DBMS-Test-Fixture.md",
          section: "Question 3: Comprehensive Analysis of ARIES Crash Recovery Protocol",
        },
        {
          document: "DBMS-Test-Fixture.md",
          section: "4. Phase 2: The Redo Phase",
        },
        {
          document: "DBMS-Test-Fixture.md",
          section: "2. Checkpointing Mechanics",
        },
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
        { supabaseClient: mockSupabase as unknown as SupabaseClient, matchThreshold: 0.0 }
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
            { supabaseClient: mockSupabaseFailing as unknown as SupabaseClient }
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
        { supabaseClient: mockSupabaseSuccess as unknown as SupabaseClient }
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

      // Verify LLM was invoked with qualifying chunks filtered by RELEVANCE_MARGIN
      assert.strictEqual(llmCallCount, 1, "LLM should have been called for matching query");
      assert.strictEqual(receivedChunks.length, 3, "Expected exactly 3 chunks within RELEVANCE_MARGIN of top score");
      assert.ok(
        receivedChunks[0].similarity >= SIMILARITY_THRESHOLD,
        `Top chunk similarity ${receivedChunks[0].similarity} should be >= ${SIMILARITY_THRESHOLD}`
      );

      // Verify response structure and citations (must exclude Write Skew and 2PL)
      if ("answer" in result) {
        assert.strictEqual(result.answer, "Mocked grounded answer.");
        assert.strictEqual(result.citations.length, 3);
        const sectionLabels = result.citations.map((c) => c.section);
        assert.ok(sectionLabels.includes("Question 3: Comprehensive Analysis of ARIES Crash Recovery Protocol"));
        assert.ok(sectionLabels.includes("4. Phase 2: The Redo Phase"));
        assert.ok(sectionLabels.includes("2. Checkpointing Mechanics"));
        assert.strictEqual(sectionLabels.includes("Question 2: Write Skew Anomaly under Snapshot Isolation"), false);
        assert.strictEqual(sectionLabels.includes("Question 4: Two-Phase Locking (2PL) Variants and Concurrency Guarantees"), false);
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
