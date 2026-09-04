# AGENTS.md — Smriti

**Read this completely before touching any code.**

---

## 1. Read order

1. `AGENTS.md` — this file
2. `CONTRACT.md` — what must never break
3. `spec/architecture.md` — stack, structure, capabilities
4. `spec/plan.md` — which milestone is active
5. `spec/tasks.md` — the specific task
6. `AGENT_LOG.md` — top 3 entries, for current state

Read `spec/evals.md` before claiming anything works. Read `spec/smoke.md` before any deploy. Read `spec/decisions.md` before proposing an architectural change — it may already have been rejected (in particular D-001 through D-006).

**If a task conflicts with `CONTRACT.md`, the contract wins.** Stop and flag it. Do not silently resolve.

---

## 2. Hard invariants

Never break these without explicit human approval from Pushkar.

### INV-1 — Grounded answers only
No answer is ever generated without a retrieved source chunk above the similarity threshold backing it. Low-confidence or empty retrieval returns the fixed "not in my material" response, never a free-form guess.

### INV-2 — Attribution accuracy (dormant at M0)
Content attributed to a named person is never rewritten while that name stays attached. Currently dormant because the M0/M1 corpus has no third-party attributed content — becomes live and must be tested before any other-branch or named-senior content is added.

### INV-3 — No query content logged
Query counts may be recorded for the usage metric. Query *text* is never persisted or logged anywhere, tied to a user or not.

### INV-4 — Zero recurring cost
Nothing in this stack may incur a per-request or monthly cost. Free tiers only (Vercel, Supabase, Google AI Studio). Do not add a paid service, a dedicated server, or a metered dependency without flagging it to Pushkar first.

---

## 3. Stack — pinned

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript | 5.x |
| Framework | Next.js, App Router | 15.x |
| Hosting | Vercel (free/Hobby tier) | — |
| Database / vector store | Supabase — Postgres + pgvector | current stable |
| LLM | The lightest/cheapest free-tier Gemini text model — NOT Gemini 3.8 Flash, see D-007 | verify current model name live against AI Studio's model list before M0-RAG-03 — names and lineup shift fast, most recently with 3.8 Flash's Sept 2, 2026 release |
| Embeddings | Gemini embedding model, 768-dim (MRL-scaled) | see `architecture.md` |
| Auth | None at M0 — a single shared access link/code gates the test group, not a user account system |

Do not add a dependency without checking: is it needed, is it maintained, does it work in this deployment model, what does it cost on the critical path? Record additions in `spec/decisions.md`.

---

## 4. Working rules

**One task per change.** Do not batch. Do not refactor files you were not asked to touch.

**Report what you changed.** Files created, files modified, exported symbols changed, spec files needing updates, and anything noticed but not fixed.

**Update the spec when reality diverges** — in the same change, not later.

**Do not invent.** If you need a value, a convention or a capability and it is not in `CONTRACT.md` or `spec/architecture.md`, ask. Do not choose one and proceed.

**Prefer improving over adding.** Between a new feature and making an existing one work properly, improve the existing one.

**Never write a real secret into a tracked file.** Not in a test fixture, not in a README example, not commented out, not "temporarily". Secrets live in Vercel's environment variables (and `.env.local`, gitignored, for local dev) and reach the app via `process.env`. If you need a credential to make something work and cannot find one, stop and ask.

**Content is not a coding task.** Aggregating, cleaning, and formatting the PYQs/notes for the pilot subject (M1) has its own acceptance criteria in `spec/tasks.md` — do not treat it as a side effect of building the ingestion script.

---

## 5. Definition of done

- [ ] Build passes clean
- [ ] Acceptance criteria observably met
- [ ] Relevant test in `spec/evals.md` passes
- [ ] `spec/smoke.md` passes for the affected area
- [ ] Spec updated if behaviour diverged
- [ ] `spec/tasks.md` checkbox ticked
- [ ] `AGENT_LOG.md` entry written
- [ ] Committed as `<type>(<scope>): <task-id> <summary>`

"It builds" is not done.

---

## 6. Vocabulary

- **PYQ** — Previous Year Question(s). The core source material type.
- **Grounded answer** — an answer traceable to a real retrieved source chunk, shown to the user alongside it.
- **Test group** — the initial 10–15 juniors piloting the pilot subject.
- **Pilot subject** — the single subject M0/M1/M2 build and test against. Do not generalize to "subjects" plural until M2 passes.

## Budget for metered dependencies

Live calls to Gemini (Flash-Lite, free tier) are provisionally ~30 RPM / ~1,500 RPD — **treat as unverified until checked against the live quota shown in the actual AI Studio project**, since Google no longer publishes one fixed table (see `spec/architecture.md` §6 and D-006). At 15 test users × ~10 queries/day this has comfortable daily headroom; the real risk is per-minute bursts during a shared study session, not the daily ceiling.

Verify live calls **once**, at the end of a task, deliberately. Never probe or iterate against the live Gemini or Supabase service while debugging — reproduce with a mock or fixture and spend the real call only to confirm the fix. If a quota is exhausted while debugging, stop and report it rather than waiting it out.
