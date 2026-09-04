# CONTRACT — Smriti

**The correctness core. An agent that reads only this file must not be able to break the domain.**

Precedence: this file outranks every other document. If something here conflicts with a task, the task is wrong — stop and flag it.

---

## Invariants

### INV-1 — Grounded answers only

**Rule:** Every answer returned to a user must be traceable to a retrieved source chunk, and that chunk (or an identifiable reference to it — document name + section) must be shown alongside the answer. If retrieval does not return a chunk above the similarity threshold for the question asked, the system responds with a fixed "not in my material" message and does not call the LLM to generate a free-form answer.
**Why:** This tool tells real juniors what their professor actually asks, days before a real exam, under Pushkar's name and QQuEST's credibility. A plausible-sounding hallucinated answer presented as real is not a bug caught in code review — it's a junior walking into an exam prepared for the wrong thing.
**Violated by:** Calling the LLM with the user's question and *no* retrieved context as a fallback "to still be helpful" when retrieval comes back empty or low-confidence. This is the single most tempting shortcut in RAG systems and the one this invariant exists to block.
**Detected by:** `evals.md` INV-1-T — assert that a query with no matching source in the test corpus returns the fixed fallback string, never a generated answer.

### INV-2 — Attribution accuracy (dormant at M0)

**Rule:** If a piece of content is attributed to a named individual (a senior's note, an interview account), the system must never alter, paraphrase, or reassign that content while keeping the name attached.
**Why:** Misattributing content to a real person by name is a real-world harm to that person, not just a data-quality bug.
**Violated by:** Summarizing or rewriting an attributed note for retrieval and leaving the original name on the rewritten version.
**Detected by:** `evals.md` INV-2-T. **Status: dormant** — the M0/M1 corpus (shared PYQ drive + Pushkar's own PPTs/notes) has no individually-attributed third-party content. This invariant activates — and must have a passing test — before any other-branch or named-senior content is ingested. See D-003 in `decisions.md`.

### INV-3 — No query content logged

**Rule:** The system may count that a query happened (for the usage metric in `product.md`) but must never store the text of a user's query, or any user-identifying data alongside it, in any persistent store or log.
**Why:** Privacy-minimization by default — the worst-case leak for this project is a student's query history. If it's never stored, it can't leak.
**Violated by:** Adding "just for debugging" query logging to a serverless function and forgetting to remove it before the pilot.
**Detected by:** `evals.md` INV-3-T — grep deployed function logs and the Supabase schema for any column or log line capable of holding raw query text.

### INV-4 — Zero recurring cost

**Rule:** No component of this system may incur a per-request or monthly monetary cost. Free tiers only (Vercel Hobby, Supabase Free, Google AI Studio free tier). Adding any paid service, dedicated server, managed queue, or metered dependency requires explicit human approval first.
**Why:** ₹0/month is a hard architectural constraint, not a preference — it rules out entire classes of otherwise-reasonable solutions, and an agent that doesn't know this will cheerfully propose a Redis cache or a background worker.
**Violated by:** Adding a dependency that has a free trial rather than a free tier, or one that's free at low volume and silently meters above a threshold.
**Detected by:** `evals.md` INV-4-T — a dependency review at each milestone close: every service in the stack is either free-tier-permanent or flagged. Not automatable; this is a human check at milestone boundaries, and is recorded as such.

---

## Pinned conventions

| Concern | Decision |
|---|---|
| Timezone | All timestamps stored UTC; rendered in IST (Asia/Kolkata) only at the UI layer. |
| Date format | ISO 8601 everywhere in storage and API responses (`2026-09-04T00:00:00Z`). |
| IDs | UUID v4 for all row IDs (Supabase default via `gen_random_uuid()`). |
| Source citation format | Every grounded answer returns `citations` — always a JSON **array**, even when it holds one element (never a bare object, never named `citation` singular). Each element: `{ "document": string, "section": string }`. `document` is the source filename as stored in `documents.title`. `section` is always a **string**, never an integer — use the nearest markdown/PDF heading text if one exists, otherwise the literal string `"chunk N"` where N is the chunk's index within its document. Example: `[{ "document": "DBMS-2024-endsem.pdf", "section": "chunk 7" }]`. |
| Chunking | Fixed-size chunks of 500 tokens with 50-token overlap. **Tokenizer: the Gemini API's own `countTokens` endpoint** — not a character/4 heuristic, not a whitespace word count, not cl100k. Using the same tokenizer that bills and embeds is the only way chunk sizes mean what they say. Precedence when rules conflict: the 500-token ceiling is hard and always wins; paragraph-boundary splitting is best-effort within it. A single paragraph exceeding 500 tokens is split mid-paragraph rather than allowed to overflow. The 50-token overlap is preserved across every split, including mid-paragraph ones. |
| `query_counts` date rollover | Rolls over at **IST (Asia/Kolkata) midnight**, not UTC midnight. The metric measures Indian students' study behaviour during an exam week; a UTC rollover would split a single late-night cramming session across two rows and make the metric misleading. The `date` column stores the IST calendar date as a plain `date` type. This is the one deliberate exception to the UTC-storage rule above, and it is deliberate — do not "fix" it. |
| Retrieval top-k | `TOP_K = 5`. Retrieve the 5 highest-scoring chunks; the INV-1 ground-check applies to the **top-scoring** chunk only (if the best match is below threshold, the fallback fires regardless of what the other four scored). All chunks above threshold are passed to the LLM as context and cited. |
| Error shape | `{ code: SCREAMING_SNAKE, message: string }` — e.g. `{ code: "NO_MATCH", message: "not in my material" }`. |
| Naming | camelCase in TypeScript, snake_case in Postgres/Supabase. |
| Similarity threshold | Cosine similarity ≥ 0.75 counts as a match for INV-1. Below this, INV-1's fallback fires. (Provisional — revisit once M1 real content shows what threshold actually separates good from bad matches; see D-002.) |
| Units | Embedding dimension: 768 (Gemini embedding model, MRL-scaled down from the 3072 default for storage/cost). |
| Encoding | UTF-8, NFC normalised, for all ingested text. |

---

## Exact values

```
SIMILARITY_THRESHOLD = 0.75        # provisional, see D-002 — revisit after M1 content lands
TOP_K                = 5
CHUNK_SIZE_TOKENS    = 500
CHUNK_OVERLAP_TOKENS = 50
EMBEDDING_DIM         = 768
HEARTBEAT_INTERVAL_DAYS = 1        # daily — Vercel Hobby's cron floor is once/day anyway, and daily gives more margin under Supabase's 7-day pause than every-3-days did, for free       # must stay under Supabase's 7-day pause window
```

---

## Reference examples

| Input | Expected output |
|---|---|
| A question directly matching a real ingested PYQ | Grounded answer + citation naming that PYQ's document/section. |
| A question about a topic not in the pilot subject's material (e.g. asking about a different subject entirely) | `{ code: "NO_MATCH", message: "not in my material" }` — no generated guess. |
| A question phrased differently but semantically matching an ingested note | Grounded answer + citation — proves retrieval isn't doing exact-string matching. |

---

## Never do this

- **Never call the LLM without retrieved context as a fallback for a low-confidence match** — because it silently converts a "not in my material" case into a hallucinated answer presented as real. Return the fixed fallback instead.
- **Never store raw query text** — because the only reason to is convenience debugging, and the leak risk outweighs it. Use request counts only.
- **Never rewrite attributed content while keeping the original name on it** — because it's misattribution to a real, named person. Either keep content verbatim or strip the attribution.
- **Never commit a real API key** — not in a test fixture, not in a README example, not commented out. Keys live in Vercel's environment variables and Supabase's project settings, never in a tracked file.

---

## Changing this file

Requires explicit human approval from Pushkar. An agent proposing a change here stops and asks; it does not edit and report.
