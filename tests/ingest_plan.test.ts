import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runIngestPlan, PlanEntry } from "../scripts/ingest_plan";
import { SupabaseClient } from "@supabase/supabase-js";

describe("scripts/ingest_plan.ts Safety & Mode Tests", () => {
  const dummyPlan: PlanEntry[] = [
    {
      path: "OS_Sample_Notes.md",
      include: true,
      docType: "Notes",
      title: "[Notes] Unit 1 Introduction",
    },
    {
      path: "OS_TA2_Paper.md",
      include: true,
      docType: "QB",
      title: "[QB] TA-II March 2023 Sample Paper",
    },
  ];

  const dummyFiles: Record<string, string> = {
    "OS_Sample_Notes.md": "# Unit 1 Introduction\n\nOperating System is a resource manager.",
    "OS_TA2_Paper.md": "# TA-II Sample Paper\n\nExplain process scheduling algorithms.",
  };

  const mockCountTokens = async (text: string): Promise<number> => {
    return Math.max(1, Math.ceil(text.length / 4));
  };

  const mockEmbedChunks = async (chunks: string[]): Promise<number[][]> => {
    return chunks.map(() => new Array(768).fill(0.01));
  };

  it("safe by default: no arguments results in dry-run mode and ZERO database writes", async () => {
    let insertCalls = 0;
    let deleteCalls = 0;

    const mockSupabase = {
      from: (table: string) => ({
        select: () => {
          assert.fail(`Supabase select should not be called in dry-run mode, accessed table: ${table}`);
        },
        insert: () => {
          insertCalls++;
          assert.fail(`Supabase insert should NEVER be called in dry-run mode! Table: ${table}`);
        },
        delete: () => {
          deleteCalls++;
          assert.fail(`Supabase delete should NEVER be called in dry-run mode! Table: ${table}`);
        },
      }),
    } as unknown as SupabaseClient;

    const report = await runIngestPlan({
      args: [], // No args passed -> dry-run mode
      plan: dummyPlan,
      extractedFiles: dummyFiles,
      supabaseClient: mockSupabase,
      countTokensFn: mockCountTokens,
      embedChunksFn: mockEmbedChunks,
      writeReportFile: false,
    });

    assert.strictEqual(report.mode, "dry-run");
    assert.strictEqual(insertCalls, 0, "Dry run must perform zero insert writes");
    assert.strictEqual(deleteCalls, 0, "Dry run must perform zero delete writes");
    assert.strictEqual(report.totalFiles, 2);
    assert.ok(report.totalChunks > 0, "Should have chunked files in dry run");
  });

  it("safe by default: passing npm-like flag '--dry-run' performs ZERO database writes", async () => {
    let insertCalls = 0;

    const mockSupabase = {
      from: (table: string) => ({
        select: () => {
          assert.fail(`Supabase select should not be called in dry-run mode, table: ${table}`);
        },
        insert: () => {
          insertCalls++;
          assert.fail(`Supabase insert called! Table: ${table}`);
        },
      }),
    } as unknown as SupabaseClient;

    const report = await runIngestPlan({
      args: ["--dry-run"],
      plan: dummyPlan,
      extractedFiles: dummyFiles,
      supabaseClient: mockSupabase,
      countTokensFn: mockCountTokens,
      embedChunksFn: mockEmbedChunks,
      writeReportFile: false,
    });

    assert.strictEqual(report.mode, "dry-run");
    assert.strictEqual(insertCalls, 0);
  });

  it("real mode requires explicit positional word 'commit' to execute writes", async () => {
    let documentInsertCalls = 0;
    let chunkInsertCalls = 0;
    let selectCalls = 0;

    const mockSupabase = {
      from: (table: string) => ({
        select: (_cols?: string, options?: { count?: string; head?: boolean }) => {
          selectCalls++;
          if (options?.head) {
            // Count query for existing subject documents
            return Promise.resolve({ data: null, count: 5, error: null });
          }
          return {
            eq: () => Promise.resolve({ data: [], error: null }), // No duplicate document exists
          };
        },
        insert: (data: unknown) => {
          if (table === "documents") {
            documentInsertCalls++;
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "mock-doc-123", title: "Mock", subject: "OS" },
                    error: null,
                  }),
              }),
            };
          }
          if (table === "chunks") {
            const count = Array.isArray(data) ? data.length : 1;
            chunkInsertCalls += count;
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    } as unknown as SupabaseClient;

    const report = await runIngestPlan({
      args: ["commit"], // Explicit positional 'commit'
      plan: dummyPlan,
      extractedFiles: dummyFiles,
      supabaseClient: mockSupabase,
      countTokensFn: mockCountTokens,
      embedChunksFn: mockEmbedChunks,
      writeReportFile: false,
    });

    assert.strictEqual(report.mode, "real");
    assert.ok(selectCalls > 0, "Real mode must query existing documents for count and idempotency");
    assert.strictEqual(documentInsertCalls, 2, "Real mode should insert 2 documents");
    assert.ok(chunkInsertCalls > 0, "Real mode should insert chunks");
  });

  it("filters documents with --only and respects --replace in real mode", async () => {
    let documentInsertCalls = 0;
    let deleteCalls = 0;

    const mockSupabase = {
      from: (table: string) => ({
        select: (_cols?: string, options?: { count?: string; head?: boolean }) => {
          if (options?.head) {
            return Promise.resolve({ data: null, count: 1, error: null });
          }
          return {
            // Document already exists
            eq: () => Promise.resolve({ data: [{ id: "existing-doc-99" }], error: null }),
          };
        },
        delete: () => {
          deleteCalls++;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
        insert: () => {
          if (table === "documents") {
            documentInsertCalls++;
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "new-doc-100", title: "[QB] TA-II March 2023 Sample Paper", subject: "OS" },
                    error: null,
                  }),
              }),
            };
          }
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;

    const report = await runIngestPlan({
      args: ["commit", "--only", "TA-II", "--replace"],
      plan: dummyPlan,
      extractedFiles: dummyFiles,
      supabaseClient: mockSupabase,
      countTokensFn: mockCountTokens,
      embedChunksFn: mockEmbedChunks,
      writeReportFile: false,
    });

    assert.strictEqual(report.mode, "real");
    assert.strictEqual(report.totalFiles, 1, "--only should filter down to 1 file");
    assert.strictEqual(deleteCalls, 2, "--replace should delete existing chunks and document");
    assert.strictEqual(documentInsertCalls, 1, "Should insert 1 document");
  });
});
