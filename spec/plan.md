# plan.md — Milestones

Sequential. Do not start M(n+1) before M(n)'s exit criteria are met.

**Currently active: M0.**

---

## M0 — Correctness skeleton ⏱ a few days at 10hrs/week · cost ₹0

Prove the grounded-Q&A path works end to end, deployed and reachable, before spending any time on real content or real users.

**Deliverables**
- Next.js repo, Vercel + Supabase projects connected
- pgvector schema (`documents`, `chunks`, `query_counts`)
- Ingestion script for a small test fixture (not real PYQs yet)
- `/api/ask` route: embed → retrieve → ground-check (INV-1) → Gemini call → answer + citation
- Heartbeat cron wired and verified running
- Minimal chat UI
- First live deploy

**Exit criteria**
- [ ] A question matching test-fixture content returns a grounded answer with a real citation
- [ ] A question not covered by the fixture returns the fixed "not in my material" response, not a generated guess
- [ ] Heartbeat cron has actually fired at least once, confirmed in Supabase logs
- [ ] Live at a Vercel URL, reachable in a private browser window

**Risk:** building the whole pipeline before checking Gemini/Supabase free-tier signup friction wastes time if either has an unexpected gate (e.g. billing details required even for "free"). Check both can actually be created with no card before M0-SETUP-02.

---

## M1 — Real content, one subject ⏱ mostly non-code, pace depends on material quality

This is content work, not code work — treat it as its own milestone with its own acceptance criteria, not a side effect of M0.

**Deliverables**
- 30–50 PYQs/notes for the pilot subject, pulled from the existing Drive link and Pushkar's own PPTs/notes
- Material cleaned/formatted into ingestable text (OCR if any PYQs are scanned images)
- Ingested into the M0 pipeline
- Retrieval spot-checked against 10 real sample questions

**Exit criteria**
- [ ] Real material ingested, chunk count and embedding count match expectations
- [ ] 8 of 10 spot-check questions return correctly grounded answers (2 genuine misses are fine and informative — 10 of 10 this early is more likely a too-easy test set than a working system)

---

## M2 — Pilot test ⏱ one exam week

**Deliverables**
- Access shared with 10–15 real juniors
- Query-count telemetry live (INV-3-compliant — counts only)
- Verdict recorded in `evals.md` against the ≥5-of-15 threshold

**Exit criteria**
- [ ] Pilot ran through the full exam week
- [ ] Verdict recorded — PASS, PARTIAL, or fail, with the actual count, not a rounded-up impression

---

## Sequencing rules
- M0 blocks everything — no content work makes sense against a pipeline that hasn't been proven end to end.
- M1 blocks M2 — don't recruit test users before there's real content to test against.
- Do not skip straight to M2 recruitment because it feels like the "real" milestone — an unproven pipeline (M0) or thin content (M1) makes the pilot's result meaningless either way.

## Anti-goals for the current stage

Things that will feel productive and are not, until M2 is complete:

- Polishing the chat UI beyond "functional and readable"
- Building support for a second subject
- Designing an accounts/login system nobody asked for yet
- Writing the pitch/README copy for this project — there's no result to point to yet (see `positioning-lens` guidance from earlier: don't publish the claim before there's proof)

If you find yourself doing one of these, check which milestone is active.
