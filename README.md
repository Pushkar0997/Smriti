# 🧠 Smriti (स्मृति) — Citation-Grounded Academic RAG for MIT-ADT

[![Live App](https://img.shields.io/badge/Live_Deployment-smriti--indol.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://smriti-indol.vercel.app)
[![Next.js 15.5](https://img.shields.io/badge/Next.js-15.5_App_Router-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Supabase pgvector](https://img.shields.io/badge/Supabase-pgvector-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](supabase/schema.sql)
[![License: MIT](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](LICENSE)

**Smriti** lets an MIT-ADT University undergraduate ask what a specific subject or exam actually tests and receive an answer strictly grounded in the batch's own **Previous Year Questions (PYQs), lecture slides, and curated notes** — never generic textbook filler or ungrounded LLM hallucinations.

🌐 **Live Production App:** [https://smriti-indol.vercel.app](https://smriti-indol.vercel.app)

---

## 🎯 Why Smriti Exists

Every semester, the same PYQs, unit notes, and exam patterns get re-requested in WhatsApp groups, scattered across screenshots and Google Drive folders, and half-lost before reaching the next batch. Generic AI assistants can answer questions *if* a student manually uploads the right PDFs every session, and standard RAG wrappers routinely hallucinate textbook answers when retrieval comes back weak.

Smriti solves both problems by pairing a **curated, subject-scoped ingestion pipeline** with **hard retrieval invariants** enforced in code and verified by automated contract tests (`CONTRACT.md`).

---

## 🛡️ Hard Architectural Invariants (`CONTRACT.md`)

Smriti is built using **Spec-Driven Development** (`BRIEF.md` → `CONTRACT.md` → `spec/` → `tests/`). Three non-negotiable invariants govern the runtime:

| Invariant ID | Name | Runtime Enforcement & Test Verification |
| :--- | :--- | :--- |
| **`INV-1`** | **Grounded Answers Only (No Third Path)** | Every query in [`lib/retrieval.ts`](lib/retrieval.ts) runs vector similarity search against Supabase `pgvector`. If the top chunk score is below `SIMILARITY_THRESHOLD` (`0.65`), `/api/ask` immediately returns `{ code: "NO_MATCH", message: "not in my material" }` and **never invokes the LLM**. Verified by `INV-1-T` in [`tests/inv-1.test.ts`](tests/inv-1.test.ts). |
| **`REL-GAP`** | **Relevance Gap Filtering** | Even among chunks clearing the absolute threshold, only chunks within `RELEVANCE_MARGIN` (`0.06`) of the top-scoring chunk are passed to [`lib/gemini.ts`](lib/gemini.ts) (`gemini-3.5-flash-lite`) and surfaced as user citations. Verified by `REL-GAP-T`. |
| **`INV-2`** | **Visible Source Citations** | Every generated response must render explicit document and section provenance badges (`formatCitations()`) alongside the answer in [`app/page.tsx`](app/page.tsx). |
| **`INV-3`** | **Zero Query Logging & In-Memory Auth** | Raw student questions are never written to database tables (`query_counts` stores aggregate counters only) or server logs, and the `ACCESS_CODE` gate lives strictly in React in-memory state (zero `localStorage`, `sessionStorage`, or cookie persistence). |

---

## 🏗️ System Architecture & Repository Layout

```text
Smriti/
├── app/
│   ├── api/
│   │   ├── ask/route.ts          # POST /api/ask: Access gate → Embed → pgvector → INV-1 Ground-Check → Gemini
│   │   └── heartbeat/route.ts    # Cron heartbeat keeping free-tier Supabase active during quiet windows
│   ├── layout.tsx                # Root Next.js 15 App Router layout
│   └── page.tsx                  # Minimal workstation UI with 3 distinct states (Grounded, NO_MATCH, Error)
├── lib/
│   ├── retrieval.ts              # embedQuery(), retrieveChunks(), groundCheck(), REL-GAP filtering
│   ├── gemini.ts                 # Strict prompt-level INV-1 system instructions & generation client
│   └── supabase.ts               # Server-only Supabase service-role client
├── scripts/
│   ├── inventory.ts              # M1-CONTENT-01a: Read-only course material scanner & manifest generator
│   ├── extract.ts                # M1-CONTENT-02a: Verbatim markdown extraction from triaged PDFs/PPTs
│   └── ingest_plan.ts            # M1-CONTENT-03: Safe-by-default (dry-run) chunking & embedding pipeline
├── supabase/
│   ├── schema.sql                # pgvector extension, documents, chunks,query_counts & match_chunks RPC
│   └── migrations/               # Subject-scoped retrieval migrations (01b_subject_filter.sql)
├── spec/                         # SDD specifications (product.md, architecture.md, decisions.md, evals.md)
└── tests/
    └── inv-1.test.ts             # 11/11 unit & fixture contract tests for INV-1, REL-GAP, and citation formatting
```

---

## 🚀 Getting Started Locally

### 1. Prerequisites
- **Node.js** `>= 20.x`
- A **Supabase** project with `pgvector` enabled (run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor)
- A **Google AI Studio** API key (`GEMINI_API_KEY`)

### 2. Installation & Environment Setup

```bash
git clone https://github.com/Pushkar0997/Smriti.git
cd Smriti
npm install
```

Copy `.env.example` to `.env.local` and populate the server-only environment variables (none of these are ever prefixed with `NEXT_PUBLIC_`):

```ini
GEMINI_API_KEY=your_ai_studio_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ACCESS_CODE=your_batch_access_code
CRON_SECRET=your_vercel_cron_secret
```

### 3. Run Development Server & Contract Tests

```bash
# Start Next.js development server on http://localhost:3000
npm run dev

# Run the INV-1 / REL-GAP contract test suite (11/11 tests)
npm test

# Run ESLint type & lint verification
npm run lint
```

---

## 📚 Corpus Ingestion Pipeline (Milestone 1: Operating Systems)

Course materials are ingested through a three-stage, auditable pipeline rather than blind bulk uploads:

1. **Inventory (`scripts/inventory.ts`)**: Scans raw semester directories and outputs a deterministic file manifest.
2. **Extraction (`scripts/extract.ts`)**: Converts approved items from the triage plan into structured, section-delimited Markdown.
3. **Ingestion (`scripts/ingest_plan.ts`)**: Runs in **dry-run mode by default**; pass `commit` explicitly to chunk, embed (with exponential backoff retry hardening), and upsert into Supabase `documents` and `chunks` (25 OS documents / 261 chunks).

---

## 📄 License

Released under the [MIT License](LICENSE).
