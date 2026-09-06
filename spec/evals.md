# evals.md — Evaluation

## 1. How to run

```
npm test
```

Must pass before any deploy. Non-zero exit on failure.

Tolerances: cosine similarity comparisons use the exact `SIMILARITY_THRESHOLD = 0.65` from `CONTRACT.md` (calibrated per D-011) — no fuzzing.

## 2. Golden values

**Provisional — empty until M1.** Fabricating example Q&A pairs now, before real PYQs are ingested, would produce golden values that test nothing real. Fill this table during M1-VERIFY-01/02 with actual questions against actual ingested content, not before.

| ID | Input | Expected |
|---|---|---|
| G-01 | *(to be filled from M1 real content)* | |

## 3. Invariant tests

One per invariant in `CONTRACT.md`.

| ID | Invariant | Assertion |
|---|---|---|
| INV-1-T | Grounded answers only | A query with no matching chunk above threshold returns `{ code: "NO_MATCH", message: "not in my material" }`, and the LLM is never called for that request (assert via mock — the LLM function must not be invoked). **Implemented in `tests/inv-1.test.ts` (passing).** |
| REL-GAP-T | Relevance gap filtering | Given a top-scoring chunk and a set of candidate chunks clearing the absolute threshold, only chunks within `RELEVANCE_MARGIN` (0.06) of the top score qualify for LLM context and user citations. Off-target chunks separated by a relevance gap are excluded. **Implemented in `tests/inv-1.test.ts` (passing).** |
| INV-2-T | Attribution accuracy | **Dormant at M0/M1** — no test exists yet because no attributed content exists yet. Must be written and passing before any task ingests other-branch or named-senior content (see D-003). |
| INV-3-T | No query content logged | Grep the deployed Vercel function logs and the full Supabase schema for any field or log statement capable of holding raw query text. Fails if found. |
| INV-4-T | Zero recurring cost | **Human check at each milestone close, not automated.** Enumerate every external service the stack calls. Each must be permanently free-tier, not free-trial. Record the list and the verdict in §7 alongside the milestone verdict. Fails if any service is metered, trial-based, or requires a card to keep working. |

## 4. Negative tests

**More important than positive tests.** These catch regressions positive tests miss.

| ID | Assertion |
|---|---|
| N-01 | A question entirely unrelated to the pilot subject's material (e.g. asking about a different subject) is **rejected** with the fixed fallback, not answered from the LLM's general knowledge. |
| N-02 | A query embedding call that fails (simulated network error) does not silently fall through to an ungrounded LLM answer — it surfaces an error to the user instead. |
| N-03 | An attempt to log or persist raw query text anywhere in the request path fails the INV-3-T check. |

## 5. Telemetry
Query counts only, per `query_counts` (date, count). No per-query row, no content, no user identifier. Free-tier budget: trivial at this scale — 15 users × a few queries/day is a handful of row updates, nowhere near Supabase's free-tier limits.

## 6. Pre-deploy gate
- [ ] Tests pass
- [ ] Build clean
- [ ] `smoke.md` passes
- [ ] No draft/placeholder content reachable in production
- [ ] No secret in the build output (grep for key prefixes)

## 7. Recorded verdicts

*Written **after** a milestone, not before.*

**PASS only where a test or a recorded live result backs it. Never round up a PARTIAL.**

### Not yet run — no milestone closed

No verdicts recorded yet. First entry goes here after M0's exit criteria are checked against a real deploy, not before.
