-- Smriti — Supabase Schema (M0-SETUP-02)
-- Architecture reference: spec/architecture.md §3 & CONTRACT.md

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Documents table: one row per source file (a PYQ set, a notes PDF)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null,
  uploaded_at timestamptz not null default timezone('utc'::text, now())
);

-- 3. Chunks table: one row per ~500-token chunk with 768-dim embedding
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  content text not null,
  embedding vector(768) not null,
  section_label text not null
);

-- 4. Query counts table: daily query counts only (INV-3: never store query content)
-- Rollover is at IST midnight per CONTRACT.md
create table if not exists query_counts (
  date date primary key,
  count integer not null default 0
);

-- 5. Indexes
create index if not exists idx_chunks_document_id on chunks(document_id);
create index if not exists idx_chunks_embedding on chunks using hnsw (embedding vector_cosine_ops);

-- 6. Enable Row Level Security (RLS) on all tables
-- Server-side calls using SUPABASE_SERVICE_ROLE_KEY bypass RLS.
alter table documents enable row level security;
alter table chunks enable row level security;
alter table query_counts enable row level security;

-- 7. Function: match_chunks for vector cosine similarity search
create or replace function match_chunks (
  query_embedding vector(768),
  match_threshold float default 0.75,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_label text,
  document_title text,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.document_id,
    chunks.content,
    chunks.section_label,
    documents.title as document_title,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  join documents on documents.id = chunks.document_id
  where 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- 8. Function: increment_query_count for atomic daily query counting (INV-3 compliant)
create or replace function increment_query_count(query_date date)
returns void
language sql
as $$
  insert into query_counts (date, count)
  values (query_date, 1)
  on conflict (date)
  do update set count = query_counts.count + 1;
$$;
