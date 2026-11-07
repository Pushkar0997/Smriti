import fs from "node:fs";
import path from "node:path";
import { chunkText } from "../lib/ingest";
import { countTokens, embedChunks } from "../lib/gemini";
import { getSupabaseAdmin } from "../lib/supabase";
import type { ChunkItem } from "../lib/ingest";

/**
 * M1-CONTENT-03 ingestion pipeline script.
 *
 * Reads local/plan.json and local/extracted/*.md, include:true only.
 * Title from plan.json (keeps [DocType] prefix); subject "OS".
 *
 * Modes:
 *   --dry-run: chunk every file, NO embedding/database calls.
 *              Writes local/chunk_report.json and prints summary.
 *   (default): real ingestion with idempotency per title.
 *   --replace: in real mode, deletes existing document's chunks first.
 *
 * Does not write doc_type. Backfill from title prefix after 01b migration.
 */

interface PlanEntry {
  path: string;
  include: boolean;
  docType: string;
  title: string;
  reason?: string;
}

interface FileChunkReport {
  title: string;
  sourcePath: string;
  sourceChars: number;
  chunkCount: number;
  tokenMin: number;
  tokenMax: number;
  tokenAvg: number;
  tokenTotal: number;
  chunksUnder60Tokens: number;
  sampleSectionLabels: string[];
  countTokensCalls: number;
  countTokensChars: number;
  status: "ok" | "error";
  error?: string;
}

interface ChunkReport {
  mode: "dry-run" | "real";
  generatedAt: string;
  subject: string;
  totalFiles: number;
  totalChunks: number;
  totalTokens: number;
  totalSourceChars: number;
  totalCountTokensCalls: number;
  totalCountTokensChars: number;
  callsPerChunk: number;
  charAmplification: number;
  files: FileChunkReport[];
}

// Simple telemetry wrapper for countTokens
function createInstrumentedCountTokens() {
  let calls = 0;
  let chars = 0;

  const fn = async (text: string): Promise<number> => {
    calls++;
    chars += text.length;
    return countTokens(text);
  };

  return {
    countTokens: fn,
    get calls() { return calls; },
    get chars() { return chars; },
    reset() { calls = 0; chars = 0; },
  };
}

async function main() {
  // Ensure environment variables are loaded
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ignored
    }
  }

  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isReplace = args.includes("--replace");
  const subject = "OS";

  // Parse repeatable --only <title-substring>
  const onlyFilters: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && i + 1 < args.length) {
      onlyFilters.push(args[i + 1]);
      i++;
    } else if (args[i].startsWith("--only=")) {
      onlyFilters.push(args[i].slice("--only=".length));
    }
  }

  console.log(`=== Smriti Ingestion Pipeline [${isDryRun ? "DRY-RUN" : "REAL"} MODE] ===\n`);

  // 1. Read plan.json
  const planPath = path.resolve(process.cwd(), "local", "plan.json");
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }
  const plan: PlanEntry[] = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  let included = plan.filter((e) => e.include);
  if (onlyFilters.length > 0) {
    included = included.filter((e) =>
      onlyFilters.some((filter) => e.title.includes(filter))
    );
    console.log(
      `Plan: ${plan.length} total entries, filtered to ${included.length} matching --only [${onlyFilters.join(", ")}].\n`
    );
  } else {
    console.log(`Plan: ${plan.length} entries, ${included.length} included.\n`);
  }

  const extractedDir = path.resolve(process.cwd(), "local", "extracted");
  const fileReports: FileChunkReport[] = [];
  let totalChunks = 0;
  let totalTokens = 0;
  let totalSourceChars = 0;
  let totalCTCalls = 0;
  let totalCTChars = 0;

  const supabase = isDryRun ? null : getSupabaseAdmin();

  for (let fi = 0; fi < included.length; fi++) {
    const entry = included[fi];
    const title = entry.title;

    // Derive extracted filename: replace source extension with .md
    const baseName = entry.path.replace(/\.[^.]+$/, "") + ".md";
    const mdPath = path.resolve(extractedDir, baseName);

    if (!fs.existsSync(mdPath)) {
      console.log(`[${fi + 1}/${included.length}] SKIP (not extracted): ${baseName}`);
      fileReports.push({
        title,
        sourcePath: baseName,
        sourceChars: 0,
        chunkCount: 0,
        tokenMin: 0,
        tokenMax: 0,
        tokenAvg: 0,
        tokenTotal: 0,
        chunksUnder60Tokens: 0,
        sampleSectionLabels: [],
        countTokensCalls: 0,
        countTokensChars: 0,
        status: "error",
        error: "Extracted file not found",
      });
      continue;
    }

    const content = fs.readFileSync(mdPath, "utf-8");
    const sourceChars = content.length;
    totalSourceChars += sourceChars;

    try {
      if (!isDryRun && supabase) {
        // Check if document already exists (idempotency)
        const { data: existing } = await supabase
          .from("documents")
          .select("id")
          .eq("title", title);

        if (existing && existing.length > 0) {
          if (isReplace) {
            console.log(`[${fi + 1}/${included.length}] REPLACING: ${title}`);
            for (const doc of existing) {
              await supabase.from("chunks").delete().eq("document_id", doc.id);
              await supabase.from("documents").delete().eq("id", doc.id);
            }
          } else {
            console.log(`[${fi + 1}/${included.length}] SKIP (exists): ${title}`);
            fileReports.push({
              title,
              sourcePath: baseName,
              sourceChars,
              chunkCount: 0,
              tokenMin: 0,
              tokenMax: 0,
              tokenAvg: 0,
              tokenTotal: 0,
              chunksUnder60Tokens: 0,
              sampleSectionLabels: [],
              countTokensCalls: 0,
              countTokensChars: 0,
              status: "ok",
              error: "Skipped (already exists)",
            });
            continue;
          }
        }
      }

      // Chunk the document
      const instrumented = createInstrumentedCountTokens();
      const chunks: ChunkItem[] = await chunkText(content, instrumented.countTokens);

      const tokenCounts = chunks.map((c) => c.tokenCount);
      const tokenMin = tokenCounts.length > 0 ? Math.min(...tokenCounts) : 0;
      const tokenMax = tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0;
      const tokenTotal = tokenCounts.reduce((a, b) => a + b, 0);
      const tokenAvg = tokenCounts.length > 0 ? Math.round(tokenTotal / tokenCounts.length) : 0;
      const chunksUnder60 = tokenCounts.filter((t) => t < 60).length;

      // Sample section labels: first 3 unique ones
      const uniqueLabels = [...new Set(chunks.map((c) => c.sectionLabel))];
      const sampleLabels = uniqueLabels.slice(0, 3);

      totalChunks += chunks.length;
      totalTokens += tokenTotal;
      totalCTCalls += instrumented.calls;
      totalCTChars += instrumented.chars;

      console.log(
        `[${fi + 1}/${included.length}] ${isDryRun ? "CHUNKED" : "INGESTING"}: ${title} ` +
        `(${sourceChars.toLocaleString()} chars, ${chunks.length} chunks, ` +
        `tokens ${tokenMin}/${tokenAvg}/${tokenMax}, ` +
        `${instrumented.calls} CT calls)`
      );

      if (!isDryRun && supabase) {
        // Insert document
        const { data: doc, error: docError } = await supabase
          .from("documents")
          .insert({ title: title.trim(), subject })
          .select("id, title, subject")
          .single();

        if (docError || !doc) {
          throw new Error(`DB insert document failed: ${docError?.message ?? "unknown"}`);
        }

        // Generate embeddings in batches
        const chunkTexts = chunks.map((c) => c.content);
        const embeddings = await embedChunks(chunkTexts, title.trim());

        if (embeddings.length !== chunks.length) {
          throw new Error(
            `Embedding count mismatch: ${embeddings.length} embeddings for ${chunks.length} chunks`
          );
        }

        // Batch insert chunks (Supabase has a row limit per request; use batches of 50)
        const batchSize = 50;
        for (let ci = 0; ci < chunks.length; ci += batchSize) {
          const batch = chunks.slice(ci, ci + batchSize).map((c, j) => ({
            document_id: doc.id,
            content: c.content,
            embedding: embeddings[ci + j],
            section_label: c.sectionLabel,
          }));

          const { error: chunkError } = await supabase
            .from("chunks")
            .insert(batch);

          if (chunkError) {
            throw new Error(`DB insert chunks batch ${ci} failed: ${chunkError.message}`);
          }
        }

        console.log(`  -> Stored: doc ${doc.id}, ${chunks.length} chunks, ${embeddings.length} embeddings`);
      }

      fileReports.push({
        title,
        sourcePath: baseName,
        sourceChars,
        chunkCount: chunks.length,
        tokenMin,
        tokenMax,
        tokenAvg,
        tokenTotal,
        chunksUnder60Tokens: chunksUnder60,
        sampleSectionLabels: sampleLabels,
        countTokensCalls: instrumented.calls,
        countTokensChars: instrumented.chars,
        status: "ok",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${fi + 1}/${included.length}] ERROR: ${title}: ${msg}`);
      fileReports.push({
        title,
        sourcePath: baseName,
        sourceChars,
        chunkCount: 0,
        tokenMin: 0,
        tokenMax: 0,
        tokenAvg: 0,
        tokenTotal: 0,
        chunksUnder60Tokens: 0,
        sampleSectionLabels: [],
        countTokensCalls: 0,
        countTokensChars: 0,
        status: "error",
        error: msg,
      });
    }
  }

  // Build report
  const callsPerChunk = totalChunks > 0 ? totalCTCalls / totalChunks : 0;
  const charAmplification = totalSourceChars > 0 ? totalCTChars / totalSourceChars : 0;

  const report: ChunkReport = {
    mode: isDryRun ? "dry-run" : "real",
    generatedAt: new Date().toISOString(),
    subject,
    totalFiles: included.length,
    totalChunks,
    totalTokens,
    totalSourceChars,
    totalCountTokensCalls: totalCTCalls,
    totalCountTokensChars: totalCTChars,
    callsPerChunk: Number(callsPerChunk.toFixed(2)),
    charAmplification: Number(charAmplification.toFixed(2)),
    files: fileReports,
  };

  // Write report
  const reportPath = path.resolve(process.cwd(), "local", "chunk_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // Print summary
  console.log("\n=================== INGESTION SUMMARY ===================");
  console.log(`Mode:                    ${report.mode.toUpperCase()}`);
  console.log(`Subject:                 ${subject}`);
  console.log(`Files Processed:         ${report.totalFiles}`);
  console.log(`Total Source Chars:      ${report.totalSourceChars.toLocaleString()}`);
  console.log(`Total Chunks:            ${report.totalChunks}`);
  console.log(`Total Tokens:            ${report.totalTokens.toLocaleString()}`);
  console.log(`countTokens Calls:       ${report.totalCountTokensCalls.toLocaleString()}`);
  console.log(`Calls Per Chunk:         ${report.callsPerChunk}`);
  console.log(`Char Amplification:      ${report.charAmplification}x`);
  console.log("-----------------------------------------------------------");

  const okFiles = fileReports.filter((f) => f.status === "ok" && !f.error?.includes("Skipped"));
  const errorFiles = fileReports.filter((f) => f.status === "error");
  const skippedFiles = fileReports.filter((f) => f.error?.includes("Skipped") || f.error?.includes("not found"));

  console.log(`Succeeded:               ${okFiles.length}`);
  console.log(`Errors:                  ${errorFiles.length}`);
  console.log(`Skipped:                 ${skippedFiles.length}`);

  if (errorFiles.length > 0) {
    console.log("\nErrors:");
    errorFiles.forEach((f) => console.log(`  ${f.title}: ${f.error}`));
  }

  // Per-file summary table
  console.log("\nPer-file breakdown:");
  console.log("  Title | Chars | Chunks | Tokens (min/avg/max) | <60tok | CT calls");
  console.log("  " + "-".repeat(90));
  for (const f of fileReports) {
    if (f.error?.includes("Skipped") || f.error?.includes("not found")) continue;
    if (f.status === "error") continue;
    const truncTitle = f.title.length > 35 ? f.title.slice(0, 32) + "..." : f.title;
    console.log(
      `  ${truncTitle.padEnd(35)} | ${String(f.sourceChars).padStart(6)} | ` +
      `${String(f.chunkCount).padStart(5)} | ${f.tokenMin}/${f.tokenAvg}/${f.tokenMax} | ` +
      `${String(f.chunksUnder60Tokens).padStart(5)} | ${f.countTokensCalls}`
    );
  }

  console.log("\n=========================================================\n");

  if (errorFiles.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Ingestion pipeline failed:", msg);
  process.exit(1);
});

