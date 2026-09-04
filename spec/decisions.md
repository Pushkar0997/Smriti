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

**Status:** decided
**Decision:** Low-confidence or empty retrieval returns a fixed "not in my material" message. The LLM is never called to "still be helpful" when retrieval fails.
**Rationale:** The failure mode this blocks — a hallucinated but plausible-sounding wrong answer, given to a real junior before a real exam, under Pushkar's name — is expensive in a way that "the bot said it didn't know" never is.
**Rejected:**
- *Always answer, with a disclaimer when confidence is low* — rejected because disclaimers get skimmed past under exam-week time pressure; a hard refusal is safer than a soft warning here.

**Revisit if:** M1 spot-checking (M1-VERIFY-01) shows the 0.75 threshold is miscalibrated — too strict (good matches get rejected) or too loose (bad matches get through). The threshold itself is provisional; the never-guess principle is not.

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
