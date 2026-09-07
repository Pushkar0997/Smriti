# BRIEF — Smriti

*One page. Read in 3 minutes. Rewritten whenever state changes.*

**What this is:** Lets MIT-ADT juniors/seniors ask what a specific professor/subject actually tests — grounded in the batch's own PYQs, notes, and senior interview experiences, not generic textbook content.

**Live at:** https://smriti-indol.vercel.app · **Repo:** https://github.com/Pushkar0997/Smriti

---

## Where things stand

**Milestone:** M0 — Correctness skeleton
**Exit criteria:** a real question about the pilot subject returns a grounded answer with a visible source citation; a question the material doesn't cover returns "not in my material" instead of a guess; it's live at a reachable URL.
**Progress:** 7 of 8 tasks complete (M0-SETUP-01 through 03, M0-ING-01 through 02, M0-RAG-01 through 03, and M0-UI-01 done; M0-DEPLOY-01 built and deployed, pending Pushkar's live verification).

**Last done:** M0-UI-01 built (accessible chat page with in-memory ACCESS_CODE gate, visible citations alongside grounded answers, distinct amber NO_MATCH state, and distinct red error state); M0-DEPLOY-01 built and deployed with 0 secret leaks in build output.
**Next:** Pushkar performs live verification in a private browser window to close M0-DEPLOY-01, completing M0. M1 begins next.

---

## Prompt for the next session

Copy this into any coding agent:

```
Read AGENTS.md, then CONTRACT.md, then spec/plan.md and spec/tasks.md.
Then read the top 3 entries of AGENT_LOG.md.

Tell me which milestone is active and which task you propose next.
Do not write code yet.
```

---

## Three things most likely to break

1. **Gemini free-tier RPM ceiling during a burst** — if several of the 15 test users query in the same minute (likely, since they'll cram before the same exam), Flash-Lite's request-per-minute cap can 429. Mitigated by using Flash-Lite (higher RPM than Flash) plus a lightweight client-side retry queue, but this is the most likely first failure, not a hypothetical one.
2. **Supabase's 7-day inactivity pause** — if the heartbeat cron (M0-SETUP-03) isn't actually wired up and verified, the project goes unreachable mid-lull, exactly when a junior tries to open it.
3. **Retrieval quality on messy source material** — if the pilot subject's PYQs are scanned images or badly formatted, chunking/embedding quality degrades and answers stop being reliably grounded. Check this early with real material (M1), not assumed material.

---

## Where everything is

| Need | File |
|---|---|
| What must never break | `CONTRACT.md` |
| Rules for agents | `AGENTS.md` |
| What happened when | `AGENT_LOG.md` |
| What we're building and why | `spec/product.md` |
| Stack and structure | `spec/architecture.md` |
| Milestones | `spec/plan.md` |
| The backlog | `spec/tasks.md` |
| How correctness is proven | `spec/evals.md` |
| Pre-ship checklist | `spec/smoke.md` |
| Why things are the way they are | `spec/decisions.md` |

---

## Standing rules

- Cost ceiling: **₹0/month** — free tiers only, no paid APIs, no dedicated compute.
- Anti-metric (do not optimise): **link opens / sign-ups that never return.**
- Real metric: **≥5 of 15 test users send 3+ real queries in the pilot subject's exam week.**
