# architecture.md — Smriti

## 1. Stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language | TypeScript | 5.x | Solo dev, one language across frontend and API routes. |
| Framework | Next.js, App Router | 15.x | Single deploy target on Vercel; API routes keep the Gemini key server-side. |
| Hosting | Vercel | Hobby (free) tier | Zero-cost, git-push deploys, built-in one-click rollback. |
| Database / vector store | Supabase (Postgres + pgvector) | current stable | Free tier covers this project's scale by a wide margin (500MB vs. one subject's worth of text). |
| LLM | The lightest/cheapest free-tier Gemini text model — deliberately not Gemini 3.8 Flash | verify current model name live against AI Studio's model list before M0-RAG-03 | Pro models left the free tier in April 2026. Gemini 3.8 Flash (released Sept 2, 2026) is free-tier but tuned for long-horizon agentic reasoning and spends more tokens per request by design — wrong fit for a short grounded lookup where RPM is the binding constraint (see D-006, D-007). |
| Embeddings | Gemini embedding model, 768-dim (MRL-scaled from 3072 default) | verify current model name live | Smaller dimension trades a little quality for storage/cost headroom, irrelevant at this scale but cheap to pin now. |
| Auth | None — shared access link/code | — | A real accounts system is out of scope until the pilot proves people want this at all (see `product.md` non-goals). |
| Scheduling | Vercel Cron (or GitHub Actions if Vercel Cron needs a paid plan — verify at build time) | — | Heartbeat ping every 3 days to dodge Supabase's 7-day inactivity pause. |

Versions are approximate on purpose where model names are concerned — Google renames/rotates free-tier model availability faster than this document gets updated. Verify against live AI Studio docs before pinning in code.

## 2. Structure

```
smriti/
├── app/
│   ├── api/
│   │   ├── ask/          ← the product API route: embed query, retrieve, ground-check, call LLM, return answer+citations
│   │   └── heartbeat/     ← invoked by the cron job only; performs one trivial DB write to keep Supabase awake. Not a product route — kept separate so nothing about the cron can affect /api/ask.
│   └── page.tsx           ← the single chat UI page — no routing complexity needed at M0
├── lib/
│   ├── retrieval.ts        ← embedding + pgvector similarity search
│   ├── ingest.ts           ← chunking + embedding pipeline for source material (run offline/locally, not a live endpoint)
│   └── gemini.ts            ← thin wrapper around the Gemini API calls, so the model name lives in one place
└── spec/
```

Two API routes, not one: `/api/ask` is the product, `/api/heartbeat` is infrastructure. Otherwise one file per concern, because at this scale a bigger structure is ceremony, not organization.

## 3. Data model

**documents** — one row per source file (a PYQ set, a notes PDF). `id`, `title`, `subject`, `uploaded_at`.
**chunks** — one row per ~500-token chunk. `id`, `document_id` (FK), `content` (text), `embedding` (vector(768)), `section_label` (for citation display).
**query_counts** — one row per day. `date`, `count`. **Never** a row per query with content — that's INV-3.

Expensive to reverse: the chunking strategy (500 tokens, 50 overlap) and embedding dimension (768) — changing either means re-embedding everything. Cheap to reverse: the UI, the exact API route shape.

## 4. Capability register

**Consult before building anything. Never build on an unsupported capability.**

| Capability | Status | Needed for |
|---|---|---|
| Single-subject grounded Q&A with citations | **built (M0-RAG-03)** | the core product |
| "Not in my material" fallback for low-confidence retrieval | **built (M0-RAG-02)** | INV-1 |
| Heartbeat to prevent Supabase pause | **built (M0-SETUP-03)** | uptime during quiet stretches |
| Query-count-only telemetry | **planned — M2, not yet built** | the success metric |
| Multiple subjects | **not supported** | would unblock a real M3, only after the M2 pilot passes |
| User accounts / login | **not supported** | not needed until (if ever) this grows past a shared-link test group |
| Other-branch or named-senior attributed notes | **not supported** | blocked on INV-2 going from dormant to tested — see `decisions.md` D-003 |
| Mobile app | **not supported** | non-goal, see `product.md` |

"planned" means specified but not built — do not treat it as available. Change a row to "built" only in the same commit that lands the implementation.

## 4b. Prompt and access gating — pinned

**LLM prompt shape for `/api/ask`.** The system instruction must state, in substance: answer *only* from the provided context; if the context does not contain the answer, say so rather than using general knowledge; do not invent exam questions, marks, or professor names not present in the context. Retrieved chunks are passed as clearly delimited context, with the user's question last. This is not optional phrasing — it is the prompt-level half of INV-1, complementing the retrieval-level check.

**Access gating (M0/M1).** A single shared passphrase, stored as a Vercel environment variable (`ACCESS_CODE`), checked server-side in the API route. Not a user account, not per-user tokens, no database table. Rotating it means changing one env var. Deliberately minimal — see `product.md` non-goals.

## 5. Scale assumptions
- Building for: 15 users, one subject.
- Revisit at: if M2 passes, revisit for 50–100 users / 2–3 subjects — that's when Supabase's free-tier row limits and Gemini's RPD ceiling start being worth re-checking, not before.
- First thing to break: Gemini RPM during a burst (see `CONTRACT.md`), not storage or RPD.
- Expensive to reverse: chunking strategy and embedding dimension (data model §3).

## 6. Performance budget
An answer should return in under ~5 seconds end-to-end (embed query + vector search + LLM call) on a free-tier call. No hard SLA at this scale, but if it regularly exceeds ~10s the retrieval or prompt size needs checking, not just "wait longer."

## 7. Security and privacy
- Stored about users: nothing identifying. A shared access code gates the test group; no accounts, no names tied to queries.
- Never logged: raw query text (INV-3). Grep deployed logs for this before every deploy — see `smoke.md`.
- Deletion: not applicable at M0 — there's no per-user data to delete, by design (INV-3). If this changes later, this section needs rewriting before it changes.
- Secrets: Gemini API key and Supabase service key live in Vercel's environment variables, never in a tracked file. `.env.local` (gitignored) for local dev.
