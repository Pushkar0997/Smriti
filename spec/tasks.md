# tasks.md — Backlog

One task = one change = one commit. Tick the box and add a one-line note when done.

Task ID format: `M<milestone>-<area>-<number>`

---

## M0 — Correctness skeleton

### Setup
- [x] **M0-SETUP-01** Init Next.js 15 (App Router, TS) repo, connect to a new Vercel project (Next.js 15.5 initialized; Vercel deployment confirmed live at https://smriti-indol.vercel.app)
- [x] **M0-SETUP-02** Create Supabase project, enable the `pgvector` extension, create `documents`/`chunks`/`query_counts` tables per `architecture.md` §3 (schema.sql executed in Supabase SQL Editor; all tables created; env vars configured)
- [x] **M0-SETUP-03** Add heartbeat cron hitting `/api/heartbeat` daily (`0 0 * * *` per CONTRACT.md). Acceptance: a **manual invocation** of the route succeeds AND writes to the DB (do not wait for the schedule), AND the cron appears registered in the Vercel dashboard with a valid schedule. (Cron registered in vercel.json; manual invocation verified returning 200 with IST date and writing row to query_counts)

### Ingestion
- [x] **M0-ING-01** Write `lib/ingest.ts` — chunk text (500 tokens, 50 overlap per `CONTRACT.md`), embed via Gemini embeddings, store in `chunks` (Implemented lib/gemini.ts and lib/ingest.ts using verified model gemini-embedding-001 with 768-dim MRL embeddings and Gemini countTokens tokenizer; end-to-end verified with live API and Supabase pgvector)
- [x] **M0-ING-02** Load a test fixture of **exactly 5 made-up Q&A pairs** (not real PYQs) through the ingestion path. At least one pair must be long enough to span 2+ chunks, so overlap behaviour is actually exercised. (Created fixtures/test_fixture.json, fixtures/test_fixture.md, and scripts/ingest_fixture.ts; ingested 5 made-up DBMS Q&A pairs into Supabase yielding 7 chunks; Question 3 spanned 3+ chunks exercising the 50-token overlap; verified stored in pgvector)

### Retrieval and answering
- [x] **M0-RAG-01** Write `lib/retrieval.ts` — embed the incoming query, pgvector similarity search, return top-k chunks with scores (Implemented retrieveChunks calling embedQuery and Supabase match_chunks RPC with TOP_K=5 and SIMILARITY_THRESHOLD=0.75; verified against persisted DBMS fixture with matching queries scoring >= 0.75 and unrelated queries scoring < 0.46)
- [x] **M0-RAG-02** Implement the INV-1 ground-check: if top score < `SIMILARITY_THRESHOLD` (0.65 per D-011), return the fixed "not in my material" response and skip the LLM call entirely (Implemented groundCheck, formatCitations, and executeGroundedQuery in lib/retrieval.ts; enforces strict no-third-path guarantee; verified with tests/inv-1.test.ts passing 10/10 unit and live fixture evaluations)
- [x] **M0-RAG-03** Wire `/api/ask`: retrieval → ground-check → LLM call with retrieved context (model per D-007 — verify the lightest free-tier model live against AI Studio, do not assume a name) → return `{ answer, citations }` (Verified gemini-3.5-flash-lite live after 2.5-flash-lite 404 deprecation notice; added generateGroundedAnswer to lib/gemini.ts with strict prompt-level grounding; wired app/api/ask/route.ts checking ACCESS_CODE; verified live against DBMS fixture with 200 grounded answer + citations and NO_MATCH for cellular respiration query)

### UI and deploy
- [x] **M0-UI-01** Minimal chat page — input box, answer display, visible source citation per answer (Built app/page.tsx with in-memory access code gate, question input box, active loading indicator, grounded answers with visible document/section citations, distinct amber NO_MATCH state for INV-1 fallback, and distinct red error state with 401 recovery; zero browser storage used per INV-3)
- [x] **M0-DEPLOY-01** First deploy to Vercel; confirm live URL works in a private window; confirm zero secret leakage by structurally verifying server-only env vars (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCESS_CODE`, `CRON_SECRET`) are never referenced in client code or static bundles (Manually verified live at https://smriti-indol.vercel.app by Pushkar in a private browser: access code entry works, in-domain query returns grounded answer with visible citations, off-topic query returns distinct "not in my material" state, and wrong access code returns distinct error state; all 4 confirmed live)

---

## M1 — Real content, one subject

### Content & Triage
- [ ] **M1-CONTENT-01** Pilot subject source material for Operating Systems (OS) gathered locally. Collection complete; remaining work is inventory, triage, and extraction.
- [x] **M1-CONTENT-01a** Read-only inventory script and manifest generator (`scripts/inventory.ts` + `npm run inventory`). Acceptance: Recursively walks a folder path without modifying or moving source files; writes `local/manifest.json` and prints a formatted summary table; records relative path, type, size, slide/page count, SHA-256, duplicate group id, and text layer detection for PDFs; includes blank `"tier"` and `"include"` fields for human curation; `local/` gitignored per AGENTS.md. (Implemented in scripts/inventory.ts and verified against local throwaway test corpus covering text PDFs, scanned image PDFs, exact duplicates, PPTX, DOCX, and images; writes local/manifest.json and readable table)
- [ ] **M1-CONTENT-01b** Subject filter on retrieval & schema update (scheduled right before OS ingestion). Acceptance: `match_chunks` RPC gains an optional `target_subject text default null` parameter (drop old function signature first in Supabase migration to avoid PostgREST overload ambiguity); nullable `documents.doc_type text` column added (`QB` | `Slides` | `Notes` | `Assignment` | `Worked`) in the same SQL migration (no retrieval behavior change yet); `retrieveChunks` in `lib/retrieval.ts` and `/api/ask` pass the active subject (`'OS'`); DBMS fixture stays retrievable by tests but not from live `/api/ask`; UI sample buttons and header subtitle in `app/page.tsx` updated to stay honest.
- [ ] **M1-CONTENT-02** Clean and format into ingestable text; OCR any scanned PYQs
- [x] **M1-CONTENT-02a** Extraction pipeline from triage plan to verbatim markdown (`scripts/extract.ts` + `npm run extract`). Acceptance: Consumes `local/plan.json` array of `{ path, include, docType, title }` relative to a source directory; outputs one markdown file per included source under `local/extracted/<relPath>.md` with strict `# <title>` and `## Slide N: <title>` or `## Page N` structure; extracts text-layer PDFs deterministically per page via `pdfjs-dist/legacy`; extracts PPTX slide titles/content and DOCX headings/tables via `jszip`; processes image-only PDFs and PNGs through Gemini vision OCR (`gemini-3.5-flash-lite`) prompted to transcribe verbatim, format markdown tables, tag figures as `[diagram: <few words>]` and unreadable words as `[illegible]`, without solving or summarizing; idempotent/resumable per file with `--force` override; 429 exponential backoff retry; file errors do not abort batch; writes `local/extraction_report.json` tracking characters, pages, near-empty pages, OCR usage, and low-text / high-non-alpha warnings; never logs extracted text or secrets; `local/` remains gitignored. (Implemented in scripts/extract.ts; verified on throwaway suite across text PDF, PPTX, DOCX, image-only PDF, and PNG; generates local/extracted/*.md and local/extraction_report.json with idempotency and resume support)
- [x] **M1-CONTENT-03a** Ingestion scale test. Acceptance: Ingest the single largest extracted file as a throwaway document and report countTokens calls, embedding calls, wall time, and any 429s encountered, plus the same numbers projected to the full plan. Then delete the throwaway document from Supabase. Optimize chunkText only if the numbers justify it. (Live scale test executed on largest extracted file `OS_UNIT-3_UNIT-4_Combined Notes.md` [85,763 chars]; produced 63 chunks in 359.92s with 1,708 countTokens calls [~27.1 calls/chunk], 6.89M chars sent to countTokens, 4 embedding API calls, 0 429s; projected to 7,295 calls and 25.6 mins across all 25 files; teardown in finally block verified 0 leftover documents and 0 leftover chunks in Supabase; optimization recommended before full batch ingestion per report)
- [ ] **M1-CONTENT-03b** Optimise `chunkText` without changing its output. Acceptance: (1) Measured on the largest extracted file: ≤10 countTokens calls per chunk and ≤5× character amplification (total chars sent to countTokens / source chars). (2) Gemini countTokens still decides every boundary per CONTRACT.md; heuristic may only narrow the search start. (3) Every emitted chunk verified via countTokens ≤ 500 tokens, overlap ≤ 50 tokens, forward progress guaranteed, concatenated chunks cover the full source. (4) Legacy implementation preserved in tests/ only; equivalence asserted on DBMS fixture and `local/extracted/UNIT-III.md` — any difference reported and invariants hold regardless. (5) Mock-based tests for invariants including edge cases (dense numeric tables with low chars/token, long whitespace runs with high chars/token). (6) lib/gemini.ts `countTokens` and `embedChunks` hardened with exponential backoff + jitter on 429, 5xx, and network errors, bounded attempts, never logging request content — mock-tested, permanent.
- [ ] **M1-CONTENT-03** Ingestion pipeline script (`scripts/ingest_plan.ts` + `npm run ingest:plan`). Reads `local/plan.json` and `local/extracted/*.md`, include:true only; title from plan.json (keeps [DocType] prefix); subject "OS"; does not write doc_type. `--dry-run`: chunks every file with NO embedding/database calls, writes `local/chunk_report.json` with per-file chunk count, token min/avg/max, chunks under 60 tokens, sample section labels, prints summary. Real mode: idempotent per title (skip if document exists; `--replace` deletes document's chunks first), resumable, per-file error isolation, batched inserts and embeddings. Acceptance: `chunks` row count equals embedding count exactly (no partial failures); zero chunks with empty/null `content`; zero chunks exceeding `CHUNK_SIZE_TOKENS`; total chunk count is within 2× of `(total source tokens / 450)` — a wild deviation means chunking silently misbehaved.

### Verification
- [ ] **M1-VERIFY-01** Write 10 real sample questions against the ingested material; spot-check each answer for correct grounding
- [ ] **M1-VERIFY-02** Record results as golden examples in `spec/evals.md`

---

## M2 — Pilot test

- [ ] **M2-PILOT-01** Recruit 10–15 juniors, share the access link/code
- [ ] **M2-PILOT-02** Add query-count-only telemetry (INV-3-compliant) to `query_counts`
- [ ] **M2-PILOT-03** Run through the pilot subject's exam week; record the ≥5-of-15 verdict in `evals.md` §7. A **real query** = a question about the pilot subject's content, sent by a test user who is not Pushkar. Excluded: blank/whitespace submissions, obvious testing-the-bot pokes ('hi', 'are you real'), and anything Pushkar sent himself.

---

## Backlog — unscheduled, do not start

- Multi-subject support — deferred until M2 passes (see `plan.md` anti-goals)
- Other-branch / named-senior attributed notes ingestion — gated on INV-2 becoming active and tested (see `decisions.md` D-003)
- Real accounts/auth system — not needed at test-group scale (see `product.md` non-goals)
- Mobile app — non-goal
- UI polish beyond functional — anti-goal until M2 passes
