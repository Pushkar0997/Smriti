# AGENT_LOG

Append-only. **Newest entry at the top.** Never edit past entries — append corrections as new ones.

Every session writes an entry, including failed sessions. "Noticed, did not fix" may not be empty without a reason.

---

## 2026-09-04 — Antigravity / Session 4 — M0 correction

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-01 status correction.
**Landed:** Corrected `spec/tasks.md` to un-tick M0-SETUP-01. Next.js 15 initialization was completed in commit `608405a`; Vercel project connection is to be performed manually via dashboard import and re-ticked once confirmed live.
**Did not land:** Vercel project connection pending manual dashboard import confirmation.
**Blockers:** Vercel dashboard project import confirmation needed to close M0-SETUP-01.
**Noticed, did not fix:** Vercel CLI login was completed by user, but project dashboard connection/import is unverified live.
**Spec changes:** Un-ticked `M0-SETUP-01` in `spec/tasks.md` and added split note referencing commit `608405a`.
**Next action:** Confirm Vercel dashboard import to close M0-SETUP-01, or proceed with M0-SETUP-02 (Supabase project & schema setup).

---

## 2026-09-04 — Antigravity / Session 3 — M0

**Milestone:** M0 — Correctness skeleton.
**Tasks attempted:** M0-SETUP-01.
**Landed:** Initialized Next.js 15.5.25 (App Router, TypeScript 5.x, ESLint 9 Flat Config, Vanilla CSS) repository structure. Created `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, and updated `.gitignore`. Verified clean `npm run build` and `npm run lint`.
**Did not land:** Automated Vercel CLI link requires interactive device login; Vercel project can be imported directly via GitHub (`Pushkar0997/Smriti`) or via `vercel link`.
**Blockers:** None for code progress. Vercel project connection/deploy needs dashboard link or Vercel login before M0-DEPLOY-01.
**Noticed, did not fix:** Local environment has no Vercel authentication token or session stored.
**Spec changes:** Ticked M0-SETUP-01 in `spec/tasks.md`.
**Next action:** M0-SETUP-02 — Create Supabase project, enable pgvector extension, and create documents/chunks/query_counts tables per `architecture.md` §3.

---

## 2026-09-04 — Claude (chat) / Session 1 + 2 — Pre-M0

**Milestone:** Pre-M0 — spec written, nothing built yet.
**Tasks attempted:** Intake (Session 1), spec authoring (Session 2).
**Landed:** Full spec system written — `BRIEF.md`, `CONTRACT.md`, `AGENTS.md`, this log, and all of `spec/`. No code yet.
**Did not land:** N/A — no code was in scope for this session.
**Blockers:** None for M0-SETUP tasks. M0-RAG tasks are blocked on M0-SETUP being done first (need the Supabase project and schema before ingestion/retrieval code makes sense).
**Noticed, did not fix:** The similarity threshold (0.75) and chunking parameters in `CONTRACT.md` are reasoned defaults, not measured — flagged provisional, revisit once M1 real content is ingested and retrieval quality can actually be checked against real PYQs.
**Spec changes:** N/A — this is the initial write.
**Next action:** M0-SETUP-01 — init the Next.js repo, connect Vercel and Supabase projects. See `spec/tasks.md`.

---
