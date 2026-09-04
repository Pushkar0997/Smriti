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

---

## Pinned conventions

| Concern | Decision |
|---|---|
| Timezone | All timestamps stored UTC; rendered in IST (Asia/Kolkata) only at the UI layer. |
| Date format | ISO 8601 everywhere in storage and API responses (`2026-09-04T00:00:00Z`). |
| IDs | UUID v4 for all row IDs (Supabase default via `gen_random_uuid()`). |
| Source citation format | `{ "document": "<filename>", "section": "<heading or chunk index>" }` returned alongside every grounded answer. |
| Error shape | `{ code: SCREAMING_SNAKE, message: string }` — e.g. `{ code: "NO_MATCH", message: "not in my material" }`. |
| Naming | camelCase in TypeScript, snake_case in Postgres/Supabase. |
| Chunking | Fixed-size chunks of ~500 tokens with ~50-token overlap, split on paragraph boundaries where possible. Stated explicitly because "chunk the document" is otherwise interpreted a different way by every agent that touches it. |
| Similarity threshold | Cosine similarity ≥ 0.75 counts as a match for INV-1. Below this, INV-1's fallback fires. (Provisional — revisit once M1 real content shows what threshold actually separates good from bad matches; see D-002.) |
| Units | Embedding dimension: 768 (Gemini embedding model, MRL-scaled down from the 3072 default for storage/cost). |
| Encoding | UTF-8, NFC normalised, for all ingested text. |

---

## Exact values

```
SIMILARITY_THRESHOLD = 0.75        # provisional, see D-002 — revisit after M1 content lands
CHUNK_SIZE_TOKENS    = 500
CHUNK_OVERLAP_TOKENS = 50
EMBEDDING_DIM         = 768
HEARTBEAT_INTERVAL_DAYS = 3        # must stay under Supabase's 7-day pause window
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
