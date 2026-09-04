# product.md — Smriti

## 1. One-line definition
Lets an MIT-ADT junior or senior ask what a specific professor/subject actually tests, and get an answer grounded in the batch's own PYQs and notes — not generic textbook content.

## 2. The problem
Every semester, the same PYQs, notes, and placement-interview experiences get re-asked-for and re-typed-from-memory in WhatsApp groups, scattered across screenshots and Drive links, half-lost by the time they reach the next batch of juniors. Generic AI tools (ChatGPT, NotebookLM) can already answer questions *if* someone manually uploads the same material — but nobody has actually aggregated it. The gap isn't the AI capability, it's the curation nobody's done.

## 3. Target user
**Primary:** MIT-ADT juniors and seniors preparing for one specific subject's internal exam, starting with a 10–15 person test group.
**Secondary:** none at M0. Do not build for a second subject or a second college until the pilot passes.
**Explicitly not the target:** students at other colleges, students wanting whole-syllabus tutoring, anyone expecting a general-purpose study chatbot.

## 4. Core promise
> After using this, a junior can ask "what does [professor] actually ask on [topic]?" and get an answer traceable to a real PYQ or note from their own batch — or an honest "not in my material" if it isn't there.

Everything gets measured against that sentence.

## 5. Non-goals
- **Whole-syllabus tutoring** — this answers what's been asked before, it doesn't teach the subject from scratch.
- **Multiple subjects at launch** — one subject, proven, before expanding. Spreading thin across subjects with unproven retrieval quality wastes the pilot.
- **Social/community features** — no student-to-student chat, no comments, no profiles. It's a retrieval tool, not a forum.
- **A real accounts/auth system** — a single shared access link or code gates the 10–15 test group. Building real auth before knowing anyone wants this is over-engineering.
- **Other people's individually-attributed notes** — deferred behind INV-2 in `CONTRACT.md` until attribution accuracy is actually tested. Starting content is the existing shared PYQ drive plus Pushkar's own material only.
- **A mobile app** — web only.

## 6. Success metrics
1. **≥5 of the 15 test users send 3+ real queries** during the pilot subject's exam week — target: pass/fail, checked once.
2. Retrieval correctness on a held-out set of real questions once M1 content lands (see `evals.md`).

**Anti-metric — do not optimise:** link opens or curiosity sign-ups that never return. This can rise while the real thing (people actually replacing their WhatsApp habit with this) doesn't happen at all.

## 7. Kill criteria
Fewer than 5 of 15 test users send 3+ real queries in week 1 of the pilot. If that happens, do not add subjects or polish the UI — the load-bearing assumption (people will open a separate tool instead of asking around) failed, and that needs rethinking before anything else.

## 8. Glossary
- **PYQ** — Previous Year Question(s).
- **Grounded answer** — an answer traceable to a real retrieved source chunk, shown to the user alongside it.
- **Pilot subject** — the single subject M0–M2 are built and tested against.
- **Test group** — the initial 10–15 juniors piloting the pilot subject.
