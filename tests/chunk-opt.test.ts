import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chunkText, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS } from "../lib/ingest";
import { chunkTextLegacy } from "./chunk_text_legacy";
import { isRetryableError, backoffMs } from "../lib/gemini";

// Ensure environment variables are loaded if running offline / tests
if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignored
  }
}

/**
 * Deterministic mock tokenizer: uses a fixed chars-per-token ratio.
 * This lets us test chunking logic without any network calls.
 */
function createMockTokenizer(charsPerToken: number = 4.0) {
  let callCount = 0;
  let totalChars = 0;

  const fn = async (text: string): Promise<number> => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    callCount++;
    totalChars += text.length;
    return Math.max(1, Math.ceil(trimmed.length / charsPerToken));
  };

  return {
    countTokens: fn,
    get callCount() { return callCount; },
    get totalChars() { return totalChars; },
    reset() { callCount = 0; totalChars = 0; },
  };
}

describe("M1-CONTENT-03b: chunkText optimisation & retry hardening", () => {
  // ===================================================================
  // Mock-based invariant tests
  // ===================================================================
  describe("Mock: chunk invariants hold on normal prose (cpt=4.0)", () => {
    const mock = createMockTokenizer(4.0);

    it("every chunk ≤ 500 tokens, forward progress, full coverage", async () => {
      // Generate ~10,000 chars of pseudo-prose
      const text = Array.from({ length: 200 }, (_, i) =>
        `Paragraph ${i}. This is sample content for testing the chunking algorithm with realistic text.`
      ).join("\n\n");

      const chunks = await chunkText(text, mock.countTokens);

      assert.ok(chunks.length > 0, "Should produce at least one chunk");

      // INV: every chunk ≤ 500 tokens
      for (const c of chunks) {
        assert.ok(
          c.tokenCount <= CHUNK_SIZE_TOKENS,
          `Chunk "${c.sectionLabel}" has ${c.tokenCount} tokens, exceeding ${CHUNK_SIZE_TOKENS}`
        );
      }

      // INV: no empty chunks
      for (const c of chunks) {
        assert.ok(c.content.length > 0, "Chunk content must not be empty");
      }

      // INV: coverage — all content from original text appears in chunks (allowing overlap)
      // Simple check: first and last 50 chars of source must appear in some chunk
      const firstChars = text.trim().slice(0, 50);
      const lastChars = text.trim().slice(-50);
      assert.ok(
        chunks[0].content.includes(firstChars),
        "First chunk must contain the start of the text"
      );
      assert.ok(
        chunks[chunks.length - 1].content.includes(lastChars),
        "Last chunk must contain the end of the text"
      );
    });
  });

  describe("Mock: chunk invariants hold on dense numeric tables (cpt=1.5)", () => {
    const mock = createMockTokenizer(1.5); // Very low chars-per-token (dense data)

    it("every chunk ≤ 500 tokens even with dense tokenization", async () => {
      // Dense numeric: lots of short tokens
      const rows = Array.from({ length: 100 }, (_, i) =>
        `| ${i} | ${(i * 7) % 100} | ${(i * 13) % 1000} | 0x${i.toString(16).padStart(4, '0')} |`
      );
      const text = "# Dense Table\n\n| ID | Val | Code | Hex |\n| --- | --- | --- | --- |\n" + rows.join("\n");

      const chunks = await chunkText(text, mock.countTokens);
      assert.ok(chunks.length > 0);

      for (const c of chunks) {
        assert.ok(
          c.tokenCount <= CHUNK_SIZE_TOKENS,
          `Dense chunk has ${c.tokenCount} tokens > ${CHUNK_SIZE_TOKENS}`
        );
        assert.ok(c.content.length > 0);
      }
    });
  });

  describe("Mock: chunk invariants hold on whitespace-heavy text (cpt=10.0)", () => {
    const mock = createMockTokenizer(10.0); // Very high chars-per-token

    it("every chunk ≤ 500 tokens even with inflated char-to-token ratio", async () => {
      // Long whitespace runs and long words
      const text = Array.from({ length: 50 }, (_, i) =>
        `Supercalifragilisticexpialidocious${i}` + "    ".repeat(20) +
        `Antidisestablishmentarianism${i}` + "        ".repeat(10)
      ).join("\n\n");

      const chunks = await chunkText(text, mock.countTokens);
      assert.ok(chunks.length > 0);

      for (const c of chunks) {
        assert.ok(
          c.tokenCount <= CHUNK_SIZE_TOKENS,
          `Whitespace chunk has ${c.tokenCount} tokens > ${CHUNK_SIZE_TOKENS}`
        );
        assert.ok(c.content.length > 0);
      }
    });
  });

  describe("Mock: overlap ≤ 50 tokens between consecutive chunks", () => {
    const mock = createMockTokenizer(4.0);

    it("adjacent chunks share overlap text that fits within 50-token limit", async () => {
      const text = Array.from({ length: 100 }, (_, i) =>
        `Section ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.`
      ).join("\n\n");

      const chunks = await chunkText(text, mock.countTokens);

      for (let i = 0; i < chunks.length - 1; i++) {
        const current = chunks[i].content;
        const next = chunks[i + 1].content;

        // Check if there is overlapping text
        // Find the longest common suffix of current that is a prefix of next
        let overlapLen = 0;
        for (let len = 1; len <= Math.min(current.length, next.length); len++) {
          const suffix = current.slice(current.length - len);
          if (next.startsWith(suffix)) {
            overlapLen = len;
          }
        }

        if (overlapLen > 0) {
          const overlapText = next.slice(0, overlapLen);
          const overlapTokens = await mock.countTokens(overlapText);
          assert.ok(
            overlapTokens <= CHUNK_OVERLAP_TOKENS,
            `Overlap between chunks ${i + 1} and ${i + 2} is ${overlapTokens} tokens > ${CHUNK_OVERLAP_TOKENS}`
          );
        }
      }
    });
  });

  describe("Mock: efficiency targets (≤10 calls/chunk, ≤5x amplification)", () => {
    it("achieves target efficiency on ~80K-char text", async () => {
      const mock = createMockTokenizer(4.0);

      // Generate text similar in size to the largest extracted file
      const text = Array.from({ length: 800 }, (_, i) =>
        `## Section ${i}\n\nThis is paragraph ${i} with substantial content for the chunking algorithm. ` +
        `We need enough text to produce many chunks and measure the call efficiency.`
      ).join("\n\n");

      const chunks = await chunkText(text, mock.countTokens);
      const callsPerChunk = mock.callCount / chunks.length;
      const amplification = mock.totalChars / text.length;

      // Check targets
      assert.ok(
        callsPerChunk <= 10,
        `Calls per chunk: ${callsPerChunk.toFixed(1)} exceeds target of ≤10`
      );
      assert.ok(
        amplification <= 5,
        `Character amplification: ${amplification.toFixed(2)}x exceeds target of ≤5x`
      );
    });
  });

  describe("Mock: edge cases", () => {
    const mock = createMockTokenizer(4.0);

    it("handles empty text", async () => {
      const chunks = await chunkText("", mock.countTokens);
      assert.strictEqual(chunks.length, 0);
    });

    it("handles whitespace-only text", async () => {
      const chunks = await chunkText("   \n\n\t  ", mock.countTokens);
      assert.strictEqual(chunks.length, 0);
    });

    it("handles text that fits in one chunk", async () => {
      const chunks = await chunkText("Hello world.", mock.countTokens);
      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].content, "Hello world.");
    });

    it("handles text exactly at 500 tokens", async () => {
      // With cpt=4.0, 2000 chars = 500 tokens
      const text = "x".repeat(2000);
      const chunks = await chunkText(text, mock.countTokens);
      assert.strictEqual(chunks.length, 1);
    });

    it("handles text just over 500 tokens", async () => {
      // With cpt=4.0, 2004 chars = 501 tokens
      const text = "word ".repeat(401); // 401 * 5 = 2005 chars
      const chunks = await chunkText(text, mock.countTokens);
      assert.ok(chunks.length >= 2, "Should split into at least 2 chunks");
      for (const c of chunks) {
        assert.ok(c.tokenCount <= CHUNK_SIZE_TOKENS);
      }
    });
  });

  // ===================================================================
  // Retry hardening tests
  // ===================================================================
  describe("Retry: isRetryableError classification", () => {
    it("classifies 429 as retryable and is429", () => {
      const result = isRetryableError({ status: 429, message: "" });
      assert.strictEqual(result.retryable, true);
      assert.strictEqual(result.is429, true);
    });

    it("classifies RESOURCE_EXHAUSTED message as retryable and is429", () => {
      const result = isRetryableError({ message: "RESOURCE_EXHAUSTED" });
      assert.strictEqual(result.retryable, true);
      assert.strictEqual(result.is429, true);
    });

    it("classifies 503 as retryable but not is429", () => {
      const result = isRetryableError({ status: 503, message: "" });
      assert.strictEqual(result.retryable, true);
      assert.strictEqual(result.is429, false);
    });

    it("classifies 500 as retryable", () => {
      const result = isRetryableError({ status: 500, message: "" });
      assert.strictEqual(result.retryable, true);
    });

    it("classifies 'fetch failed' as retryable", () => {
      const result = isRetryableError({ message: "fetch failed" });
      assert.strictEqual(result.retryable, true);
    });

    it("classifies ECONNRESET as retryable", () => {
      const result = isRetryableError({ message: "ECONNRESET" });
      assert.strictEqual(result.retryable, true);
    });

    it("classifies EAI_AGAIN (DNS) as retryable", () => {
      const result = isRetryableError({ message: "getaddrinfo EAI_AGAIN" });
      assert.strictEqual(result.retryable, true);
    });

    it("classifies 400 as NOT retryable", () => {
      const result = isRetryableError({ status: 400, message: "Bad Request" });
      assert.strictEqual(result.retryable, false);
    });

    it("classifies 404 as NOT retryable", () => {
      const result = isRetryableError({ status: 404, message: "Not Found" });
      assert.strictEqual(result.retryable, false);
    });

    it("classifies generic TypeError as NOT retryable", () => {
      const result = isRetryableError(new TypeError("Cannot read properties"));
      assert.strictEqual(result.retryable, false);
    });
  });

  describe("Retry: backoffMs returns reasonable values", () => {
    it("attempt 1 returns between baseMs and 1.5x baseMs", () => {
      for (let i = 0; i < 10; i++) {
        const delay = backoffMs(1, 1000);
        assert.ok(delay >= 1000 && delay <= 1500, `attempt 1: ${delay}ms out of range`);
      }
    });

    it("attempt 3 returns between 4000 and 6000", () => {
      for (let i = 0; i < 10; i++) {
        const delay = backoffMs(3, 1000);
        assert.ok(delay >= 4000 && delay <= 6000, `attempt 3: ${delay}ms out of range`);
      }
    });

    it("delays increase with attempt number", () => {
      const d1 = backoffMs(1, 1000);
      const d4 = backoffMs(4, 1000);
      // d4 base is 8000, d1 base is 1000, so even with worst-case jitter d4 > d1
      assert.ok(d4 > d1, `attempt 4 (${d4}ms) should be > attempt 1 (${d1}ms)`);
    });
  });

  // ===================================================================
  // Equivalence tests (live — only on the two specified files)
  // ===================================================================
  describe("Live Equivalence: DBMS fixture", () => {
    it("new chunkText matches legacy on DBMS fixture", async () => {
      const fixturePath = path.resolve(process.cwd(), "fixtures", "test_fixture.md");
      if (!fs.existsSync(fixturePath)) {
        console.log("SKIP: fixtures/test_fixture.md not found");
        return;
      }
      const content = fs.readFileSync(fixturePath, "utf-8");
      const { countTokens: liveCountTokens } = await import("../lib/gemini");

      const [newChunks, legacyChunks] = await Promise.all([
        chunkText(content, liveCountTokens),
        chunkTextLegacy(content, liveCountTokens),
      ]);

      // Check same count
      assert.strictEqual(
        newChunks.length,
        legacyChunks.length,
        `Chunk count mismatch: new=${newChunks.length}, legacy=${legacyChunks.length}`
      );

      // Check content matches
      for (let i = 0; i < newChunks.length; i++) {
        assert.strictEqual(
          newChunks[i].content,
          legacyChunks[i].content,
          `Chunk ${i + 1} content differs`
        );
        assert.strictEqual(
          newChunks[i].sectionLabel,
          legacyChunks[i].sectionLabel,
          `Chunk ${i + 1} section label differs`
        );
      }

      // Invariants still hold regardless
      for (const c of newChunks) {
        const verified = await liveCountTokens(c.content);
        assert.ok(verified <= CHUNK_SIZE_TOKENS, `Chunk exceeds 500 tokens: ${verified}`);
      }
    });
  });

  describe("Live Equivalence: UNIT-III.md", () => {
    it("new chunkText matches legacy on UNIT-III.md (or invariants hold)", async () => {
      const filePath = path.resolve(process.cwd(), "local", "extracted", "UNIT-III.md");
      if (!fs.existsSync(filePath)) {
        console.log("SKIP: local/extracted/UNIT-III.md not found");
        return;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const { countTokens: liveCountTokens } = await import("../lib/gemini");

      const [newChunks, legacyChunks] = await Promise.all([
        chunkText(content, liveCountTokens),
        chunkTextLegacy(content, liveCountTokens),
      ]);

      // Report differences if any
      const differences: string[] = [];
      const maxLen = Math.max(newChunks.length, legacyChunks.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= newChunks.length || i >= legacyChunks.length) {
          differences.push(`Chunk ${i + 1}: ${i >= newChunks.length ? "missing in new" : "missing in legacy"}`);
          continue;
        }
        if (newChunks[i].content !== legacyChunks[i].content) {
          differences.push(
            `Chunk ${i + 1}: content differs (new: ${newChunks[i].content.length} chars / ${newChunks[i].tokenCount} tokens, legacy: ${legacyChunks[i].content.length} chars / ${legacyChunks[i].tokenCount} tokens)`
          );
        }
      }

      if (differences.length > 0) {
        console.log(`Equivalence differences (${differences.length}):`);
        differences.forEach(d => console.log(`  ${d}`));
      }

      // Invariants MUST hold regardless of differences
      for (const c of newChunks) {
        const verified = await liveCountTokens(c.content);
        assert.ok(verified <= CHUNK_SIZE_TOKENS, `Chunk exceeds 500 tokens: ${verified}`);
        assert.ok(c.content.length > 0, "Empty chunk");
      }

      // Coverage: first and last chars of source appear
      const trimmedContent = content.trim();
      assert.ok(
        newChunks[0].content.includes(trimmedContent.slice(0, 30)),
        "New chunks must cover start of text"
      );
      assert.ok(
        newChunks[newChunks.length - 1].content.includes(trimmedContent.slice(-30)),
        "New chunks must cover end of text"
      );
    });
  });
});

