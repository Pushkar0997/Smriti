# AGENT_LOG

Append-only. **Newest entry at the top.** Never edit past entries — append corrections as new ones.

Every session writes an entry, including failed sessions. "Noticed, did not fix" may not be empty without a reason.

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
