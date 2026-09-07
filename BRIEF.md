# BRIEF — Smriti

*One page. Read in 3 minutes. Rewritten whenever state changes.*

**What this is:** Lets MIT-ADT juniors/seniors ask what a specific professor/subject actually tests — grounded in the batch's own PYQs, notes, and senior interview experiences, not generic textbook content.

**Live at:** https://smriti-indol.vercel.app · **Repo:** https://github.com/Pushkar0997/Smriti

---

## Where things stand

**Milestone:** M0 complete · M1 — Real content, one subject (active next)
**Exit criteria for M0:** Met and verified live (grounded answers, visible citations, "not in my material" INV-1 fallback, in-memory access code gate, reachable production URL).
**Progress:** 8 of 8 M0 tasks complete. M0 is fully closed out.

**Last done:** Live production deployment at https://smriti-indol.vercel.app manually verified by Pushkar in a private browser (access gate, grounded answers, visible citations, INV-1 fallback, and 401 error state all confirmed live). M0-DEPLOY-01 closed.
**Next:** M1-CONTENT-01 — pull PYQs from Drive link and Pushkar's PPTs/notes for the pilot subject (DBMS). Content curation and cleaning, not coding.

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
