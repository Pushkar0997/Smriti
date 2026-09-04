# architecture.md — Smriti

## 1. Stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language | TypeScript | 5.x | Solo dev, one language across frontend and API routes. |
| Framework | Next.js, App Router | 15.x | Single deploy target on Vercel; API routes keep the Gemini key server-side. |
| Hosting | Vercel | Hobby (free) tier | Zero-cost, git-push deploys, built-in one-click rollback. |
| Database / vector store | Supabase (Postgres + pgvector) | current stable | Free tier covers this project's scale by a wide margin (500MB vs. one subject's worth of text). |
| LLM | Gemini Flash-Lite, Google AI Studio free tier | verify current model name live — names shift (e.g. `gemini-2.0-flash-lite` or successor) | Pro models left the free tier in April 2026; Flash-Lite has the higher RPM ceiling of the remaining free options, which matters more than RPD here (see D-006). |
| Embeddings | Gemini embedding model, 768-dim (MRL-scaled from 3072 default) | verify current model name live | Smaller dimension trades a little quality for storage/cost headroom, irrelevant at this scale but cheap to pin now. |
| Auth | None — shared access link/code | — | A real accounts system is out of scope until the pilot proves people want this at all (see `product.md` non-goals). |
| Scheduling | Vercel Cron (or GitHub Actions if Vercel Cron needs a paid plan — verify at build time) | — | Heartbeat ping every 3 days to dodge Supabase's 7-day inactivity pause. |

Versions are approximate on purpose where model names are concerned — Google renames/rotates free-tier model availability faster than this document gets updated. Verify against live AI Studio docs before pinning in code.

## 2. Structure

```
smriti/
├── app/
│   ├── api/
│   │   └── ask/          ← the one API route: embed query, retrieve, ground-check, call LLM, return answer+citation
│   └── page.tsx           ← the single chat UI page — no routing complexity needed at M0
├── lib/
│   ├── retrieval.ts        ← embedding + pgvector similarity search
│   ├── ingest.ts           ← chunking + embedding pipeline for source material (run offline/locally, not a live endpoint)
│   └── gemini.ts            ← thin wrapper around the Gemini API calls, so the model name lives in one place
├── scripts/
│   └── heartbeat.ts        ← the Supabase keepalive ping, invoked by the cron job
└── spec/
```

One file per concern, because at this scale a bigger structure is ceremony, not organization.

## 3. Data model

**documents** — one row per source file (a PYQ set, a notes PDF). `id`, `title`, `subject`, `uploaded_at`.
**chunks** — one row per ~500-token chunk. `id`, `document_id` (FK), `content` (text), `embedding` (vector(768)), `section_label` (for citation display).
**query_counts** — one row per day. `date`, `count`. **Never** a row per query with content — that's INV-3.

Expensive to reverse: the chunking strategy (500 tokens, 50 overlap) and embedding dimension (768) — changing either means re-embedding everything. Cheap to reverse: the UI, the exact API route shape.

## 4. Capability register

**Consult before building anything. Never build on an unsupported capability.**

| Capability | Status | Needed for |
|---|---|---|
| Single-subject grounded Q&A with citations | supported (M0 target) | the core product |
| "Not in my material" fallback for low-confidence retrieval | supported (M0 target) | INV-1 |
| Heartbeat to prevent Supabase pause | supported (M0 target) | uptime during quiet stretches |
| Query-count-only telemetry | supported (M2 target) | the success metric |
| Multiple subjects | **not supported** | would unblock a real M3, only after the M2 pilot passes |
| User accounts / login | **not supported** | not needed until (if ever) this grows past a shared-link test group |
| Other-branch or named-senior attributed notes | **not supported** | blocked on INV-2 going from dormant to tested — see `decisions.md` D-003 |
| Mobile app | **not supported** | non-goal, see `product.md` |

## 5. Scale assumptions
- Building for: 15 users, one subject.
- Revisit at: if M2 passes, revisit for 50–100 users / 2–3 subjects — that's when Supabase's free-tier row limits and Gemini's RPD ceiling start being worth re-checking, not before.
- First thing to break: Gemini RPM during a burst (see `CONTRACT.md`), not storage or RPD.
- Expensive to reverse: chunking strategy and embedding dimension (data model §3).

## 6. Performance budget
An answer should return in under ~5 seconds end-to-end (embed query + vector search + LLM call) on a free-tier Flash-Lite call — no hard SLA at this scale, but if it regularly exceeds ~10s the retrieval or prompt size needs checking, not just "wait longer."

## 7. Security and privacy
- Stored about users: nothing identifying. A shared access code gates the test group; no accounts, no names tied to queries.
- Never logged: raw query text (INV-3). Grep deployed logs for this before every deploy — see `smoke.md`.
- Deletion: not applicable at M0 — there's no per-user data to delete, by design (INV-3). If this changes later, this section needs rewriting before it changes.
- Secrets: Gemini API key and Supabase service key live in Vercel's environment variables, never in a tracked file. `.env.local` (gitignored) for local dev.
