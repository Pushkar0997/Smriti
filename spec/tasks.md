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
- [ ] **M0-UI-01** Minimal chat page — input box, answer display, visible source citation per answer
- [ ] **M0-DEPLOY-01** First deploy to Vercel; confirm live URL works in a private window; confirm no secret in the built output by grepping `.next/` for the literal values of `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ACCESS_CODE` — zero matches required.

---

## M1 — Real content, one subject

### Content
- [ ] **M1-CONTENT-01** Pull PYQs from the existing Drive link + Pushkar's own PPTs/notes for the pilot subject
- [ ] **M1-CONTENT-02** Clean and format into ingestable text; OCR any scanned PYQs
- [ ] **M1-CONTENT-03** Run through `lib/ingest.ts`. Acceptance: `chunks` row count equals embedding count exactly (no partial failures); zero chunks with empty/null `content`; zero chunks exceeding `CHUNK_SIZE_TOKENS`; total chunk count is within 2x of `(total source tokens / 450)` — a wild deviation means chunking silently misbehaved.

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
