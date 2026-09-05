# AGENT_LOG

Append-only. **Newest entry at the top.** Never edit past entries — append corrections as new ones.

Every session writes an entry, including failed sessions. "Noticed, did not fix" may not be empty without a reason.

---

## 2026-09-05 — Antigravity / Session 14 — M0-RAG-02 INV-1 ground-check implementation

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-RAG-02.
**Landed:**
- Implemented `NO_MATCH_RESPONSE` (`{ code: "NO_MATCH", message: "not in my material" } as const`), `formatCitations`, `groundCheck`, and pipeline orchestrator `executeGroundedQuery` in `lib/retrieval.ts`.
- Enforced strict no-third-path architecture: `executeGroundedQuery` runs `groundCheck` on candidate chunks against `SIMILARITY_THRESHOLD = 0.65`. If top chunk is below threshold (or empty), it returns `NO_MATCH_RESPONSE` immediately; the LLM `generateAnswer` function is never called. If top chunk >= 0.65, qualifying chunks and citations are passed to `generateAnswer`, returning `{ answer, citations }`.
- Added test runner script `"test": "tsx --test tests/**/*.test.ts"` in `package.json`.
- Created comprehensive test suite `tests/inv-1.test.ts` for INV-1-T (10/10 tests pass via `npm test`):
  - Unit tests: verified empty chunks return `NO_MATCH_RESPONSE`, low scores return `NO_MATCH_RESPONSE`, top chunk score is strictly evaluated (0.6499 fails, 0.65 passes), citations deduplicate identical document/section labels.
  - No-third-path unit tests: verified mock LLM is never called when retrieval fails or is below threshold; verified retrieval errors bubble up without falling through to LLM (Negative Test N-02); verified LLM is called exactly once when match passes.
  - Live fixture integration tests against persisted DBMS fixture: verified matching DBMS query passes ground-check and invokes LLM mock with citations; verified cellular-respiration query (scoring 0.4576) triggers `NO_MATCH_RESPONSE` with 0 calls to LLM mock.
- Updated `spec/evals.md` (calibrated threshold to 0.65 per D-011 and marked INV-1-T passing) and marked `M0-RAG-02` complete in `spec/tasks.md`.
- Verified clean typecheck (`tsc --noEmit`), lint (`npm run lint`), test suite (`npm test`), and production build (`npm run build`).
**Did not land:** N/A — task is fully complete.
**Blockers:** None.
**Noticed, did not fix:** None.
**Spec changes:** Marked `M0-RAG-02` complete in `spec/tasks.md`, updated `spec/evals.md`.
**Next action:** M0-RAG-03 — Wire `/api/ask`: retrieval → ground-check → LLM call with retrieved context (model per D-007 — verify the lightest free-tier model live against AI Studio, do not assume a name) → return `{ answer, citations }`.

---

## 2026-09-05 — Antigravity / Session 13 — SIMILARITY_THRESHOLD calibration (0.75 -> 0.65)

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** SIMILARITY_THRESHOLD calibration via D-011.
**Landed:** Tested 3 loosely-paraphrased queries against the persisted fixture at `matchThreshold = 0.0` ("why does write-ahead logging need steal and no-force" scored 0.7328, "what's the difference between strict and rigorous two-phase locking" scored 0.7583, "when can you use a sparse index" scored 0.7184). Confirmed the provisional 0.75 threshold was rejecting genuine matches simply due to phrasing variations, while off-topic queries scored 0.4576. Updated `SIMILARITY_THRESHOLD` from 0.75 to 0.65 in `CONTRACT.md` and `lib/retrieval.ts`. Added decision entry D-011 to `spec/decisions.md` and marked D-002 as superseded by D-011 for the threshold value. Updated `spec/tasks.md` for M0-RAG-02. Verified clean lint (`npm run lint`), typecheck (`tsc --noEmit`), and production build (`npm run build`).
**Did not land:** N/A.
**Blockers:** None.
**Noticed, did not fix:** None.
**Spec changes:** Updated `CONTRACT.md`, `spec/decisions.md` (marked D-002 superseded by D-011, added D-011), and `spec/tasks.md` (M0-RAG-02 threshold to 0.65).
**Next action:** M0-RAG-02 — Implement the INV-1 ground-check: if top score < `SIMILARITY_THRESHOLD` (0.65), return the fixed "not in my material" response and skip the LLM call entirely.

---

## 2026-09-05 — Antigravity / Session 12 — M0-RAG-01 retrieval implementation

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-RAG-01.
**Landed:** Created `lib/retrieval.ts` exporting `TOP_K = 5`, `SIMILARITY_THRESHOLD = 0.75`, `RetrievedChunk`, `RetrieveOptions`, and `retrieveChunks(query, options)`. Uses `embedQuery` from `lib/gemini.ts` (RETRIEVAL_QUERY task type, 768-dim) and invokes the `match_chunks` RPC in Supabase passing `match_count: 5` and `match_threshold: 0.75` pinned per `CONTRACT.md`. Mapped returned chunks to camelCase structures with document title, section label, content, and similarity scores. Removed unused import in `scripts/ingest_fixture.ts`. Tested against the persisted DBMS test fixture: confirmed relevant queries (e.g. "Explain the ARIES recovery protocol and its three distinct phases" score 0.7651, "Explain Write Skew anomaly under Snapshot Isolation with an example" score 0.7555) pass the 0.75 threshold and return matching chunks; confirmed unrelated queries (e.g. "How does cellular respiration and the Krebs cycle produce ATP in mitochondria?" top raw score 0.4576) return 0 chunks at threshold 0.75. Confirmed clean lint (`npm run lint`), clean typecheck (`tsc --noEmit`), and clean production build (`npm run build`). Marked `M0-RAG-01` complete in `spec/tasks.md`.
**Did not land:** N/A — task is fully complete.
**Blockers:** None.
**Noticed, did not fix:** `match_chunks` RPC filters rows via SQL `WHERE 1 - (chunks.embedding <=> query_embedding) >= match_threshold`; passing default threshold 0.75 returns only chunks matching or exceeding the threshold. Added `options.matchThreshold` override in `retrieveChunks` allowing callers (such as test suites) to inspect raw similarity scores when needed.
**Spec changes:** Marked `M0-RAG-01` complete in `spec/tasks.md`.
**Next action:** M0-RAG-02 — Implement the INV-1 ground-check: if top score < `SIMILARITY_THRESHOLD` (0.75), return the fixed "not in my material" response and skip the LLM call entirely.

---

## 2026-09-05 — Antigravity / Session 11 — M0-ING-02 fixture ingestion

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-ING-02.
**Landed:** Created `fixtures/test_fixture.json` and `fixtures/test_fixture.md` containing exactly 5 made-up DBMS Q&A pairs (not real PYQs). Configured Question 3 (ARIES crash recovery protocol) with 1,115 tokens to span across multiple chunks and strictly exercise the 50-token overlap logic. Added `scripts/ingest_fixture.ts` and `npm run ingest:fixture` script in `package.json`. Ingested the test fixture into Supabase pgvector (`title: "DBMS-Test-Fixture.md"`), producing 7 chunks total (each strictly <= 500 tokens). Confirmed Question 3 spans across chunks 3, 4, and 5 (and overlapping into adjacent chunks), with 50-token overlap between chunks. Verified 7 chunks persisted in Supabase pgvector table. Verified clean typecheck (`tsc --noEmit`), lint (`npm run lint`), and Next.js production build (`npm run build`). Marked `M0-ING-02` complete in `spec/tasks.md`.
**Did not land:** N/A — task is fully complete.
**Blockers:** None.
**Noticed, did not fix:** None.
**Spec changes:** Marked `M0-ING-02` complete in `spec/tasks.md`.
**Next action:** M0-RAG-01 — Write `lib/retrieval.ts` (embed incoming query, pgvector similarity search, return top-k chunks with scores).

---

## 2026-09-05 — Antigravity / Session 10 — M0-ING-01 implementation

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-ING-01.
**Landed:** Installed `@google/genai`. Verified live Google AI Studio documentation for embedding models and selected `gemini-embedding-001` (stable text embedding model, June 2025, supporting 768-dim MRL output dimensionality, native `RETRIEVAL_DOCUMENT` task type, and `countTokens` support on the exact same model). Created `lib/gemini.ts` as thin wrapper managing client lifecycle, `countTokens`, `embedChunk`, `embedChunks`, and `embedQuery`. Created `lib/ingest.ts` implementing `chunkText` (500 token ceiling, best-effort paragraph splitting, mid-paragraph fallback, 50-token overlap, markdown heading / "chunk N" label detection) and `ingestDocument` (inserts document and chunks into Supabase pgvector). Verified chunking logic with mock tests offline, verified clean typecheck (`tsc --noEmit`), lint (`npm run lint`), and Next.js production build (`npm run build`). Performed one deliberate live end-to-end verification probe against Gemini and Supabase: confirmed countTokens (9 tokens), 768-dim embedding generation, database insertion into `documents` and `chunks`, and clean cascade deletion. Recorded D-010 in `spec/decisions.md` and marked `M0-ING-01` complete in `spec/tasks.md`.
**Did not land:** N/A — task is fully complete.
**Blockers:** None.
**Noticed, did not fix:** None.
**Spec changes:** Added D-010 in `spec/decisions.md` documenting `@google/genai` and `gemini-embedding-001`. Marked `M0-ING-01` complete in `spec/tasks.md`.
**Next action:** M0-ING-02 — Load a test fixture of exactly 5 made-up Q&A pairs (not real PYQs) through the ingestion path, with at least one pair spanning 2+ chunks to exercise overlap behavior.

---

## 2026-09-05 — Antigravity / Session 9 — M0-SETUP-03 closure

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-03 closure.
**Landed:** Marked M0-SETUP-03 in `spec/tasks.md` as fully complete. Heartbeat cron confirmed fully operational: Supabase permissions granted, manual invocation of `/api/heartbeat` with `CRON_SECRET` verified returning 200 with the correct IST date, and keepalive row verified successfully written to `query_counts`. All setup tasks (M0-SETUP-01, M0-SETUP-02, M0-SETUP-03) are now complete.
**Did not land:** N/A — task is fully complete.
**Blockers:** None.
**Noticed, did not fix:** None.
**Spec changes:** Re-ticked `M0-SETUP-03` in `spec/tasks.md` with completion note.
**Next action:** M0-ING-01 — Write `lib/ingest.ts` (chunk text into 500 tokens with 50 overlap per CONTRACT.md using Gemini API countTokens endpoint, embed via Gemini embeddings model with 768-dim, and store in chunks).

---

## 2026-09-04 — Antigravity / Session 8 — M0-SETUP-03 implementation

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-03.
**Landed:** Configured `vercel.json` with daily cron (`0 0 * * *`) targeting `/api/heartbeat`. Created `app/api/heartbeat/route.ts` enforcing `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>` and writing/touching `query_counts` on IST date rollover. Updated `supabase/schema.sql` with explicit `service_role` grants. Verified build and lint pass with 0 errors. Verified local endpoint rejects unauthenticated requests with 401.
**Did not land:** Successful database write during manual invocation currently fails with PostgreSQL error 42501 (`permission denied for table query_counts`) because tables created under `postgres` in Supabase need explicit `service_role` table grants.
**Blockers:** Executing the `GRANT` statements from `supabase/schema.sql` (Section 9) in the Supabase SQL Editor.
**Noticed, did not fix:** Tables created in Supabase SQL Editor require explicit `service_role` grants before PostgREST/service_role keys can read or write.
**Spec changes:** Updated `spec/tasks.md` reflecting daily schedule (`0 0 * * *`) per CONTRACT.md and current status.
**Next action:** Pushkar executes Section 9 grants in Supabase SQL Editor, deploys to Vercel, manually invokes `/api/heartbeat` with `CRON_SECRET` to verify 200 OK and DB write, and closes M0-SETUP-03.

---

## 2026-09-04 — Antigravity / Session 7 — M0-SETUP-02 closure

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-02 closure.
**Landed:** Re-ticked M0-SETUP-02 in `spec/tasks.md` as fully complete. Supabase project created, `supabase/schema.sql` successfully executed in Supabase SQL Editor, all three tables (`documents`, `chunks`, `query_counts`) and functions/indexes verified active, and `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` confirmed configured in `.env.local` and Vercel Production.
**Did not land:** N/A — task is fully complete.
**Blockers:** None for M0-SETUP-03.
**Noticed, did not fix:** `GEMINI_API_KEY` is also configured in Vercel Production env vars.
**Spec changes:** Re-ticked `M0-SETUP-02` in `spec/tasks.md` with confirmation note.
**Next action:** M0-SETUP-03 — Add heartbeat cron hitting `/api/heartbeat` every 3 days and verify manual invocation writes to the DB.

---

## 2026-09-04 — Antigravity / Session 6 — M0-SETUP-02 repo setup

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-02 (repo-side implementation).
**Landed:** Installed `@supabase/supabase-js`. Created `supabase/schema.sql` defining pgvector extension enablement, `documents`, `chunks`, and `query_counts` tables per `architecture.md` §3 and `CONTRACT.md`, plus indexes (including HNSW vector cosine search index), RLS enablement, `match_chunks` similarity search RPC, and atomic `increment_query_count` RPC. Created `lib/supabase.ts` with database row types and admin client helper. Verified clean `npm run build` and `npm run lint`.
**Did not land:** Live execution of SQL migration in Supabase and setting environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), which requires Pushkar's manual Supabase project creation.
**Blockers:** Manual project creation in Supabase and executing `supabase/schema.sql` in the SQL Editor.
**Noticed, did not fix:** `.env.local` and Vercel project environment variables need the Supabase URL and service role key once the project is created.
**Spec changes:** Updated `spec/tasks.md` with status note for `M0-SETUP-02`.
**Next action:** Pushkar creates the Supabase project, executes `supabase/schema.sql`, and sets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and Vercel. Once verified, re-tick M0-SETUP-02 and proceed to M0-SETUP-03.

---

## 2026-09-04 — Antigravity / Session 5 — M0-SETUP-01 closure

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-01 closure.
**Landed:** Re-ticked M0-SETUP-01 in `spec/tasks.md` as fully complete. Production deployment at https://smriti-indol.vercel.app confirmed live and serving the Next.js starter page.
**Did not land:** N/A — task is fully complete.
**Blockers:** None for M0-SETUP-02.
**Noticed, did not fix:** `.gitignore` was updated by user with extra `.vercel` and `.env*` entries.
**Spec changes:** Re-ticked `M0-SETUP-01` in `spec/tasks.md` with live URL note.
**Next action:** M0-SETUP-02 — Create Supabase project, enable pgvector extension, and create documents/chunks/query_counts tables per `architecture.md` §3.

---

## 2026-09-04 — Antigravity / Session 4 — M0 correction

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-01 status correction.
**Landed:** Corrected `spec/tasks.md` to un-tick M0-SETUP-01. Next.js 15 initialization was completed in commit `608405a`; Vercel project connection is to be performed manually via dashboard import and re-ticked once confirmed live.
**Did not land:** Vercel project connection pending manual dashboard import confirmation.
**Blockers:** Vercel dashboard project import confirmation needed to close M0-SETUP-01.
**Noticed, did not fix:** Vercel CLI login was completed by user, but project dashboard connection/import is unverified live.
**Spec changes:** Un-ticked `M0-SETUP-01` in `spec/tasks.md` and added split note referencing commit `608405a`.
**Next action:** Confirm Vercel dashboard import to close M0-SETUP-01, or proceed with M0-SETUP-02 (Supabase project & schema setup).

---

## 2026-09-04 — Antigravity / Session 3 — M0

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-01.
**Landed:** Initialized Next.js 15.5.25 (App Router, TypeScript 5.x, ESLint 9 Flat Config, Vanilla CSS) repository structure. Created `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, and updated `.gitignore`. Verified clean `npm run build` and `npm run lint`.
**Did not land:** Automated Vercel CLI link requires interactive device login; Vercel project can be imported directly via GitHub (`Pushkar0997/Smriti`) or via `vercel link`.
**Blockers:** None for code progress. Vercel project connection/deploy needs dashboard link or Vercel login before M0-DEPLOY-01.
**Noticed, did not fix:** Local environment has no Vercel authentication token or session stored.
**Spec changes:** Ticked M0-SETUP-01 in `spec/tasks.md`.
**Next action:** M0-SETUP-02 — Create Supabase project, enable pgvector extension, and create documents/chunks/query_counts tables per `architecture.md` §3.

---

## 2026-09-04 — Claude (chat) / Session 1 + 2 — Pre-M0

**Milestone:** Pre-M0 — spec written, nothing built yet.
**Tasks attempted:** Intake (Session 1), spec authoring (Session 2).
**Landed:** Full spec system written — `BRIEF.md`, `CONTRACT.md`, `AGENTS.md`, this log, and all of `spec/`. No code yet.
**Did not land:** N/A — no code was in scope for this session.
**Blockers:** None for M0-SETUP tasks. M0-RAG tasks are blocked on M0-SETUP being done first (need the Supabase project and schema before ingestion/retrieval code makes sense).
**Noticed, did not fix:** The similarity threshold (0.75) and chunking parameters in `CONTRACT.md` are reasoned defaults, not measured — flagged provisional, revisit once M1 real content is ingested and retrieval quality can actually be checked against real PYQs.
**Spec changes:** N/A — this is the initial write.
**Next action:** M0-SETUP-01 — init the Next.js repo, connect Vercel and Supabase projects. See `spec/tasks.md`.

---
