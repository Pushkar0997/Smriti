import fs from "node:fs";
import path from "node:path";
import { ingestDocument } from "../lib/ingest";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  console.log("=== Ingesting Test Fixture for M0-ING-02 ===");

  // Ensure environment variables are loaded
  if (!process.env.GEMINI_API_KEY && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // ignore
    }
  }

  const supabase = getSupabaseAdmin();
  const title = "DBMS-Test-Fixture.md";
  const subject = "Database Management Systems";

  // Check and clean up any previous instance of this test fixture to maintain idempotency
  const { data: existingDocs, error: searchError } = await supabase
    .from("documents")
    .select("id, title")
    .eq("title", title);

  if (searchError) {
    throw new Error(`Failed to check existing documents in Supabase: ${searchError.message}`);
  }

  if (existingDocs && existingDocs.length > 0) {
    console.log(`Found ${existingDocs.length} existing document(s) with title "${title}". Removing old copies...`);
    for (const doc of existingDocs) {
      const { error: delError } = await supabase
        .from("documents")
        .delete()
        .eq("id", doc.id);
      if (delError) {
        throw new Error(`Failed to delete existing document ${doc.id}: ${delError.message}`);
      }
    }
    console.log("Old fixture documents removed.");
  }

  // Read fixture markdown content
  const fixturePath = path.resolve(process.cwd(), "fixtures", "test_fixture.md");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture file not found at: ${fixturePath}`);
  }
  const content = fs.readFileSync(fixturePath, "utf-8");

  console.log(`Reading fixture from: ${fixturePath}`);
  console.log("Running ingestion pipeline (chunking + Gemini embeddings + pgvector insert)...");

  const result = await ingestDocument({
    title,
    subject,
    content,
  }, supabase);

  console.log("\n=== Ingestion Completed Successfully ===");
  console.log(`Document ID: ${result.documentId}`);
  console.log(`Title: ${result.title}`);
  console.log(`Subject: ${result.subject}`);
  console.log(`Total Chunks: ${result.chunkCount}`);
  console.log("\nChunk details:");
  result.chunks.forEach((chunk, index) => {
    console.log(` [${index + 1}] ID: ${chunk.id} | tokens: ${chunk.tokenCount} | label: "${chunk.sectionLabel}"`);
  });

  // Verify in database
  const { data: storedChunks, error: fetchErr } = await supabase
    .from("chunks")
    .select("id, document_id, section_label, content")
    .eq("document_id", result.documentId);

  if (fetchErr || !storedChunks) {
    throw new Error(`Verification query failed: ${fetchErr?.message}`);
  }

  console.log(`\nVerified ${storedChunks.length} chunks stored in Supabase pgvector.`);

  // Verify that Question 3 spanned 2+ chunks
  const q3Chunks = storedChunks.filter(c =>
    c.content.includes("ARIES") ||
    c.content.includes("Analysis Phase") ||
    c.content.includes("Redo Phase") ||
    c.content.includes("Undo Phase") ||
    c.content.includes("Compensation Log Record")
  );

  console.log(`Question 3 (ARIES Protocol) spans ${q3Chunks.length} chunks (>= 2 verified).`);
  if (q3Chunks.length < 2) {
    throw new Error("Expected at least one Q&A pair to span 2+ chunks, but Question 3 spanned less than 2.");
  }

  console.log("=== M0-ING-02 Fixture Ingestion Verified & Persisted ===");
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
