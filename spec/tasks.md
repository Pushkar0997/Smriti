# tasks.md — Backlog

One task = one change = one commit. Tick the box and add a one-line note when done.

Task ID format: `M<milestone>-<area>-<number>`

---

## M0 — Correctness skeleton

### Setup
- [ ] **M0-SETUP-01** Init Next.js 15 (App Router, TS) repo, connect to a new Vercel project
- [ ] **M0-SETUP-02** Create Supabase project, enable the `pgvector` extension, create `documents`/`chunks`/`query_counts` tables per `architecture.md` §3
- [ ] **M0-SETUP-03** Add heartbeat cron (Vercel Cron or GitHub Actions — check which is free-tier-viable) hitting Supabase every 3 days; verify it actually fires once before moving on

### Ingestion
- [ ] **M0-ING-01** Write `lib/ingest.ts` — chunk text (500 tokens, 50 overlap per `CONTRACT.md`), embed via Gemini embeddings, store in `chunks`
- [ ] **M0-ING-02** Load a small test fixture (a handful of made-up Q&A pairs, not real PYQs) through the ingestion path

### Retrieval and answering
- [ ] **M0-RAG-01** Write `lib/retrieval.ts` — embed the incoming query, pgvector similarity search, return top-k chunks with scores
- [ ] **M0-RAG-02** Implement the INV-1 ground-check: if top score < `SIMILARITY_THRESHOLD` (0.75), return the fixed "not in my material" response and skip the LLM call entirely
- [ ] **M0-RAG-03** Wire `/api/ask`: retrieval → ground-check → Gemini Flash-Lite call with retrieved context → return `{ answer, citations }`

### UI and deploy
- [ ] **M0-UI-01** Minimal chat page — input box, answer display, visible source citation per answer
- [ ] **M0-DEPLOY-01** First deploy to Vercel; confirm live URL works in a private window; confirm no secret appears in the built output

---

## M1 — Real content, one subject

### Content
- [ ] **M1-CONTENT-01** Pull PYQs from the existing Drive link + Pushkar's own PPTs/notes for the pilot subject
- [ ] **M1-CONTENT-02** Clean and format into ingestable text; OCR any scanned PYQs
- [ ] **M1-CONTENT-03** Run through `lib/ingest.ts`; confirm chunk/embedding counts look sane

### Verification
- [ ] **M1-VERIFY-01** Write 10 real sample questions against the ingested material; spot-check each answer for correct grounding
- [ ] **M1-VERIFY-02** Record results as golden examples in `spec/evals.md`

---

## M2 — Pilot test

- [ ] **M2-PILOT-01** Recruit 10–15 juniors, share the access link/code
- [ ] **M2-PILOT-02** Add query-count-only telemetry (INV-3-compliant) to `query_counts`
- [ ] **M2-PILOT-03** Run through the pilot subject's exam week; record the ≥5-of-15 verdict in `evals.md` §7

---

## Backlog — unscheduled, do not start

- Multi-subject support — deferred until M2 passes (see `plan.md` anti-goals)
- Other-branch / named-senior attributed notes ingestion — gated on INV-2 becoming active and tested (see `decisions.md` D-003)
- Real accounts/auth system — not needed at test-group scale (see `product.md` non-goals)
- Mobile app — non-goal
- UI polish beyond functional — anti-goal until M2 passes
