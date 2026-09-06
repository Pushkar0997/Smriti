# decisions.md — Decision Log

Every non-obvious decision, why, and what was rejected. **This file exists to stop the next agent from re-opening a settled question or reverting a deliberate choice.**

---

## D-001 — Scope: MIT-ADT-specific, not a general research/study tool

**Status:** decided
**Decision:** Built narrowly for MIT-ADT juniors/seniors and one pilot subject, using the college's own PYQs/notes as the data moat.
**Rationale:** Generic "chat with your documents" tools (NotebookLM, Paperguide, SciSpace, Elicit, ChatGPT/Claude Projects, Perplexity Spaces, AnythingLLM) already cover the generic version — the only thing this project can defend is a named audience and data nobody else has aggregated.
**Rejected:**
- *A general research-paper reading agent* — this is `fall-fest-agent`, a separate project; researched and found to compete directly with 8+ funded/free tools.
- *A general AI-engineering RAG-eval tool* — researched, found saturated with funded platforms (Arize Phoenix, LangSmith, Galileo, Braintrust, Langfuse, Ragas, DeepEval) and several already free/open-source; also a B2B sale motion with no owned distribution.
- *A generic exam-prep app* — researched, dominated by funded incumbents (BYJU'S, Unacademy, Toppr) plus academic prototypes; vertical depth was the consistent advice across sources.

**Revisit if:** never, unless the M2 pilot fails and the audience-first premise itself is in question.

---

## D-002 — Grounded-only answers, no ungrounded fallback (INV-1)

**Status:** decided (threshold superseded by D-011)
**Decision:** Low-confidence or empty retrieval returns a fixed "not in my material" message. The LLM is never called to "still be helpful" when retrieval fails.
**Rationale:** The failure mode this blocks — a hallucinated but plausible-sounding wrong answer, given to a real junior before a real exam, under Pushkar's name — is expensive in a way that "the bot said it didn't know" never is.
**Rejected:**
- *Always answer, with a disclaimer when confidence is low* — rejected because disclaimers get skimmed past under exam-week time pressure; a hard refusal is safer than a soft warning here.

**Revisit if:** M1 spot-checking (M1-VERIFY-01) shows the similarity threshold is miscalibrated — too strict (good matches get rejected) or too loose (bad matches get through). Note: The provisional 0.75 threshold was superseded by D-011 (calibrated to 0.65). The never-guess principle is not provisional.

---

## D-003 — Other-branch / named-senior notes deferred, gated behind INV-2

**Status:** decided
**Decision:** M0–M2 use only the existing shared PYQ drive and Pushkar's own PPTs/notes. Individually-attributed content from other people is out of scope until INV-2 (attribution accuracy) has an actual passing test.
**Rationale:** The current corpus has no consent/attribution question — it's either institutional (PYQs) or Pushkar's own. Adding other people's named notes introduces a real attribution-accuracy risk that doesn't exist yet and shouldn't be designed for blind.
**Rejected:**
- *Build the attribution system now, preemptively* — rejected as premature; INV-2 stays written but dormant until there's real attributed content to test it against.

**Revisit if:** the M2 pilot passes and expansion to other branches'/seniors' individually-sourced material is actually being considered.

---

## D-004 — No query content logged by default (INV-3)

**Status:** decided
**Decision:** Query counts are recorded; query text is never persisted or logged anywhere.
**Rationale:** Privacy-minimization by default — the worst-case data leak for this project is a student's query history, so the simplest fix is to never create that data in the first place.
**Rejected:**
- *Log queries for later analysis/improvement* — rejected; the usage metric (query count) doesn't need query content, and the analysis value doesn't outweigh the leak risk for a project this size.

**Revisit if:** never, unless a future milestone has a specific, justified need for query content that's worth reopening this.

---

## D-005 — Next.js + Vercel + Supabase, single deploy target

**Status:** decided
**Decision:** Full-stack Next.js on Vercel (API routes call Gemini server-side), Supabase for Postgres+pgvector. One deploy target, one place secrets live.
**Rationale:** Solo dev, rapid build — fewer moving parts than a separate Python backend + static frontend split. Matches the zero-cost pattern already proven out in `quantum-arcade`.
**Rejected:**
- *Python (FastAPI) backend + separate static frontend* — rejected as more deployment surface area for no benefit at this scale; would only make sense if heavier ML-specific tooling were needed server-side, which it isn't here.

**Revisit if:** the project outgrows serverless function limits (unlikely at 15-user pilot scale).

---

## D-006 — Gemini Flash-Lite as the primary model

**Status:** decided
**Decision:** Use Gemini Flash-Lite (free tier, Google AI Studio) as the primary model for both generation and embeddings, not Flash or Pro.
**Rationale:** Pro models left the free tier entirely in April 2026. Between Flash and Flash-Lite, Flash-Lite reports the higher requests-per-minute ceiling across sources checked, and RPM (burst capacity during a shared study session) is the binding constraint for this project's usage pattern, not requests-per-day.
**Rejected:**
- *Gemini Flash* — rejected as primary because its lower RPM ceiling is more likely to be hit first given how this specific user base (a study group cramming together) will actually use it; kept as a documented fallback option in `architecture.md` if Flash-Lite's real-world quality proves insufficient.
- *Gemini Pro* — not available on the free tier as of April 2026, ruled out by the ₹0/month hard constraint.

**Revisit if:** the live AI Studio quota for the actual project shows materially different numbers than what was found via web research at spec time — Google does not publish one fixed table, so this should be checked, not assumed, before M0-RAG-03.

**Superseded by:** D-007 — the specific model-name guessing here is stale as of Gemini 3.8 Flash's Sept 2, 2026 release; the RPM-over-RPD reasoning still holds and D-007 builds on it.

---

## D-007 — Avoid Gemini 3.8 Flash for this workload despite being the newest free-tier model

**Status:** decided
**Decision:** Do not default to Gemini 3.8 Flash, even though it's current and free-tier. Use the lightest/cheapest free-tier text model available in AI Studio at build time — verify live, do not assume a name.
**Rationale:** 3.8 Flash is tuned for long-horizon agentic/coding reasoning and spends meaningfully more "thinking tokens" per request by design — Google's own guidance recommends staying on a lighter tier for efficiency-first, high-volume, latency-sensitive workloads. Smriti's query pattern (a short grounded lookup, RPM is the binding constraint per D-006) is exactly that case, not the complex-reasoning case 3.8 Flash is built for. Paying its reasoning cost for a task that doesn't need it works directly against the project's own quota scarcity.
**Rejected:**
- *Gemini 3.8 Flash at medium reasoning effort* — rejected; burns more quota than a grounded-lookup task requires, for capability this project doesn't use.
- *Pinning an exact lighter-tier model name now* — rejected; the free-tier lineup and naming has shifted repeatedly in the weeks before this was written. Pin at build time against the live AI Studio model list instead.

**Revisit if:** the live model list at build time shows the lighter tier is gone, or M1 real-content testing shows answer quality genuinely needs 3.8 Flash's extra reasoning — unlikely for a grounded-lookup task, but check before assuming.

---

## D-008 — Spec audit patches (tokenizer, top-k, citation shape, date rollover)

**Status:** decided
**Decision:** Pinned four previously-ambiguous conventions in `CONTRACT.md`: the chunking tokenizer is Gemini's own `countTokens` (not a heuristic), `TOP_K = 5`, `citations` is always a JSON array with string `section` values, and `query_counts` rolls over at IST midnight rather than UTC.
**Rationale:** A read-only spec audit found each of these interpretable two ways. Unpinned conventions are where agents silently diverge across sessions, and the resulting bugs are miserable to find. The IST rollover is a deliberate exception to the UTC-storage rule because the metric measures Indian students' behaviour during an exam week — a UTC rollover would split one late-night cramming session across two rows.
**Rejected:**
- *Character-count or word-count chunking heuristics* — rejected; using a different tokenizer than the one that embeds and bills means chunk sizes don't mean what they say.
- *UTC rollover for `query_counts`, for consistency* — rejected; consistency would produce a misleading metric, and the metric is the whole point of M2.
- *Integer `section` values in citations* — rejected; headings are more useful to a student than a chunk number, and a single string type handles both.

**Revisit if:** M1 real-content testing shows `TOP_K = 5` is too many (context bloat) or too few (missed matches). The others should not need revisiting.

---

## D-009 — Two API routes, not one

**Status:** decided
**Decision:** `/api/ask` (product) and `/api/heartbeat` (cron-invoked keepalive) are separate routes.
**Rationale:** `architecture.md` originally described "the one API route", but Vercel Cron works by making an HTTP request to a route — so the cron needs one. Keeping it separate means nothing about the keepalive can affect the product path.
**Rejected:**
- *Folding the heartbeat into `/api/ask`* — rejected; couples infrastructure to the product path for no benefit.
- *A standalone script outside the app* — rejected; Vercel Cron invokes routes, not scripts, so this wouldn't work in this deployment model.

**Revisit if:** the heartbeat moves to GitHub Actions hitting Supabase's REST API directly, in which case the route becomes unnecessary.

---

## D-010 — Official SDK @google/genai and gemini-embedding-001 for embeddings & token counting

**Status:** decided
**Decision:** Installed `@google/genai` (current official Google GenAI SDK) and selected `gemini-embedding-001` as the verified embedding model for chunk ingestion, token counting, and query retrieval.
**Rationale:** `gemini-embedding-001` is Google's stable text embedding model in the Gemini API (updated June 2025). It explicitly supports 768 output dimensions via Matryoshka Representation Learning (MRL), natively supports `taskType: "RETRIEVAL_DOCUMENT"` and `RETRIEVAL_QUERY`, and supports the `countTokens` endpoint directly on the exact same model that embeds (satisfying CONTRACT.md's requirement that the chunking tokenizer matches the embedding model).
**Rejected:**
- *gemini-embedding-2* — rejected for text-only RAG because it is primarily a multimodal model that aggregates multiple inputs into a single embedding, does not support `taskType` config, and requires prompt task prefix formatting.
- *Legacy SDK @google/generative-ai* — deprecated by Google in favor of `@google/genai`.
- *Character or whitespace heuristic token counting* — rejected per CONTRACT.md pinned convention.

**Revisit if:** Google updates or deprecates `gemini-embedding-001` or introduces a text-specific embedding model with better performance/quota limits.

---

## D-011 — Similarity threshold moved from 0.75 to 0.65

**Status:** decided (supersedes D-002's provisional 0.75 threshold)
**Decision:** `SIMILARITY_THRESHOLD` moved from 0.75 to 0.65 in `CONTRACT.md`'s exact values and in `lib/retrieval.ts`'s exported constant.
**Rationale:** Threshold moved from 0.75 to 0.65 based on M0-RAG-01 paraphrase testing showing real matches scoring as low as 0.7184 (e.g. "when can you use a sparse index" scored 0.7184; "why does write-ahead logging need steal and no-force" scored 0.7328) while off-topic queries scored 0.4576 — 0.75 was rejecting genuine matches simply due to phrasing variation. 0.65 provides ample margin above the ~0.46 off-topic noise floor while safely admitting valid paraphrased queries.
**Rejected:**
- *Retaining 0.75* — rejected because it rejected genuine matches when queries didn't closely match source phrasing.
- *Lowering threshold below 0.60* — rejected as unnecessarily loose; 0.65 preserves robust separation (~0.19) above off-topic noise (~0.46).

**Revisit if:** M1 real-content evaluation (M1-VERIFY-01) shows false positives or false negatives requiring fine-tuning across the pilot subject corpus.

---

## D-012 — Gemini 3.5 Flash-Lite pinned as text generation model for M0-RAG-03

**Status:** decided (builds on D-006 and D-007)
**Decision:** Pinned `gemini-3.5-flash-lite` as the text generation model in `lib/gemini.ts` for grounded answer generation via `generateGroundedAnswer`.
**Rationale:** Verified live against Google AI Studio API at build time. `gemini-2.5-flash-lite` returned a 404 deprecation notice (`"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements."`). Evaluated `gemini-3.5-flash-lite` against `gemini-3.1-flash-lite` and `gemini-3.8-flash`: `gemini-3.5-flash-lite` is Google's recommended Flash-Lite successor, is in the high-RPM efficiency tier, incurs zero thinking token overhead on direct grounded requests (`candidatesTokenCount: 4` on test query), and complies fully with the zero recurring cost constraint (INV-4).
**Rejected:**
- *gemini-3.8-flash* — rejected per D-007 due to heavy thinking-token overhead designed for complex reasoning/coding, which is unneeded for short grounded lookups and burns burst quota.
- *gemini-2.5-flash-lite* — rejected because it returned HTTP 404 / NOT_FOUND for new API keys in AI Studio.
- *gemini-3.1-flash-lite* — rejected in favor of 3.5-flash-lite which is Google's explicitly recommended active production flash-lite endpoint.

**Revisit if:** Google updates or deprecates `gemini-3.5-flash-lite` or changes free-tier limits.

---

## D-013 — Relative relevance margin (RELEVANCE_MARGIN = 0.06) added to qualifying-chunk filtering

**Status:** decided
**Decision:** Pinned `RELEVANCE_MARGIN = 0.06` in `CONTRACT.md`'s exact values and `lib/retrieval.ts`. Updated `groundCheck`'s qualifying chunk filter from `c.similarity >= threshold` to `c.similarity >= Math.max(threshold, topScore - RELEVANCE_MARGIN)`, applying consistently to both the context chunks sent to the LLM and the citations returned to the user.
**Rationale:** Real retrieval data from the ARIES test query demonstrated that while all 5 retrieved chunks cleared the 0.65 absolute similarity floor, only 3 were genuinely part of the ARIES recovery answer (scores: 0.7620 Question 3 ARIES overview, 0.7392 Phase 2 Redo, 0.7148 Checkpointing). The remaining 2 chunks were unrelated DBMS topics that cleared the floor solely due to shared database terminology (0.6914 Write Skew under Snapshot Isolation, 0.6702 Two-Phase Locking). The absolute threshold alone cannot distinguish between content specific to the answer and topically adjacent content in the same domain. Enforcing a relative margin of 0.06 from the top score (`0.7620 - 0.06 = 0.7020`) cleanly keeps the 3 genuine chunks while excluding the 2 off-target chunks.
**Rejected:**
- *Raising absolute SIMILARITY_THRESHOLD above 0.70* — rejected because D-011 showed valid paraphrased queries score around 0.71–0.73, and a higher absolute threshold causes false negatives when queries don't mirror source wording.
- *LLM-prompt-only filtering* — rejected because the unneeded chunks still pollute prompt context, consume context tokens, and show up in user-facing citations if citation generation mirrors retrieval.
- *Different filtering for citations vs LLM context* — rejected because citations must strictly reflect the evidence backing the model's answer.

**Revisit if:** M1 real-content evaluation shows multi-topic answers legitimately spanning chunks with a wider score spread (>0.06).

