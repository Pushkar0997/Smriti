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
 * Usage:
 *   npx tsx scripts/ingest_plan.ts [commit] [--replace] [--only <substring>]
 *   npm run ingest:plan
 *
 * Modes:
 *   (default / no args): DRY-RUN mode. Safe by default. Chunks every file,
 *                        NO embedding or database writes. Writes local/chunk_report.json.
 *   commit:              REAL ingestion mode. Requires explicit positional word "commit".
 *                        Generates embeddings and writes to Supabase.
 *   --replace:           In real mode, deletes existing document's chunks first.
 *   --only <substring>:  Repeatable filter to process only matching document titles.
 *
 * NOTE ON NPM FLAGS (AGENTS.md):
 *   Never gate writes behind npm-defined flags like --dry-run, --force, etc.
 *   npm consumes its own flags before scripts see them.
 *   When passing flags like --only or --replace directly with commit, run:
 *   `npx tsx scripts/ingest_plan.ts commit --only "..." --replace`
 *
 * Does not write doc_type. Backfill from title prefix after 01b migration.
 */

export interface PlanEntry {
  path: string;
  include: boolean;
  docType: string;
  title: string;
  reason?: string;
}

export interface FileChunkReport {
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

export interface ChunkReport {
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
function createInstrumentedCountTokens(customCountTokens?: (text: string) => Promise<number>) {
  let calls = 0;
  let chars = 0;
  const countFn = customCountTokens ?? countTokens;

  const fn = async (text: string): Promise<number> => {
    calls++;
    chars += text.length;
    return countFn(text);
  };

  return {
    countTokens: fn,
    get calls() { return calls; },
    get chars() { return chars; },
    reset() { calls = 0; chars = 0; },
  };
}

export interface RunIngestPlanOptions {
  args?: string[];
  plan?: PlanEntry[];
  extractedFiles?: Record<string, string>;
  supabaseClient?: ReturnType<typeof getSupabaseAdmin> | null;
  countTokensFn?: (text: string) => Promise<number>;
  embedChunksFn?: (chunks: string[], title: string) => Promise<number[][]>;
  writeReportFile?: boolean;
  subject?: string;
}

export async function runIngestPlan(options: RunIngestPlanOptions = {}): Promise<ChunkReport> {
  // Ensure environment variables are loaded
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ignored
    }
  }

  const args = options.args ?? process.argv.slice(2);
  const isRealMode = args.includes("commit");
  const isDryRun = !isRealMode;
  const isReplace = args.includes("--replace");
  const subject = options.subject ?? "OS";

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

  // Database client (null in dry-run mode unless explicitly passed)
  const supabase = isDryRun
    ? null
    : (options.supabaseClient ?? getSupabaseAdmin());

  // First output line states MODE; in real mode it also prints how many documents with same subject already exist
  if (isDryRun) {
    console.log("MODE: DRY-RUN (safe mode, zero database writes. Pass positional 'commit' to write)");
  } else {
    let existingSubjectDocCount = 0;
    if (supabase) {
      try {
        const { count, error } = await supabase
          .from("documents")
          .select("*", { count: "exact", head: true })
          .eq("subject", subject);
        if (!error && typeof count === "number") {
          existingSubjectDocCount = count;
        }
      } catch {
        // Fallback to 0 if count query fails
      }
    }
    console.log(
      `MODE: REAL (${existingSubjectDocCount} documents with subject '${subject}' already exist in database)`
    );
  }

  console.log(`=== Smriti Ingestion Pipeline [${isDryRun ? "DRY-RUN" : "REAL"} MODE] ===\n`);

  // 1. Read plan
  let plan: PlanEntry[];
  if (options.plan) {
    plan = options.plan;
  } else {
    const planPath = path.resolve(process.cwd(), "local", "plan.json");
    if (!fs.existsSync(planPath)) {
      throw new Error(`Plan file not found: ${planPath}`);
    }
    plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  }

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

  for (let fi = 0; fi < included.length; fi++) {
    const entry = included[fi];
    const title = entry.title;

    // Derive extracted filename: replace source extension with .md
    const baseName = entry.path.replace(/\.[^.]+$/, "") + ".md";

    let content: string;
    if (options.extractedFiles && baseName in options.extractedFiles) {
      content = options.extractedFiles[baseName];
    } else {
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
      content = fs.readFileSync(mdPath, "utf-8");
    }

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
      const instrumented = createInstrumentedCountTokens(options.countTokensFn);
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
        const embedFn = options.embedChunksFn ?? embedChunks;
        const embeddings = await embedFn(chunkTexts, title.trim());

        if (embeddings.length !== chunks.length) {
          throw new Error(
            `Embedding count mismatch: ${embeddings.length} embeddings for ${chunks.length} chunks`
          );
        }

        // Batch insert chunks (batches of 50)
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

  // Write report if requested (default true when not explicitly false)
  if (options.writeReportFile !== false) {
    const reportPath = path.resolve(process.cwd(), "local", "chunk_report.json");
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    } catch {
      // Ignored if local/ does not exist in testing
    }
  }

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

  return report;
}

if (process.argv[1] && process.argv[1].endsWith("ingest_plan.ts")) {
  runIngestPlan().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Ingestion pipeline failed:", msg);
    process.exit(1);
  });
}
