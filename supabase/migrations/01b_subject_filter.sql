-- Migration 01b: Subject Filter & Document Type Support
-- Idempotent and safe to re-run

-- 1. Add nullable doc_type column to documents
alter table documents add column if not exists doc_type text;

-- 2. Add check constraint for allowed document types if not present
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_doc_type_check'
  ) then
    alter table documents add constraint documents_doc_type_check
      check (doc_type is null or doc_type in ('QB', 'Slides', 'Notes', 'Assignment', 'Worked'));
  end if;
end $$;

-- 3. Backfill doc_type from title prefix ("[QB] ...") for existing rows
-- DBMS fixture ("DBMS-Test-Fixture.md") does not match any prefix and remains null
update documents
set doc_type = case
  when title like '[QB]%' then 'QB'
  when title like '[Slides]%' then 'Slides'
  when title like '[Notes]%' then 'Notes'
  when title like '[Assignment]%' then 'Assignment'
  when title like '[Worked]%' then 'Worked'
  else null
end
where (doc_type is null or doc_type != case
  when title like '[QB]%' then 'QB'
  when title like '[Slides]%' then 'Slides'
  when title like '[Notes]%' then 'Notes'
  when title like '[Assignment]%' then 'Assignment'
  when title like '[Worked]%' then 'Worked'
  else null
end) and title like '[%]%';

-- 4. Drop old match_chunks signature to prevent PostgREST overload ambiguity
drop function if exists match_chunks(vector, double precision, integer);
drop function if exists match_chunks(vector, float, int);

-- 5. Recreate match_chunks with target_subject as the LAST parameter with default null
-- Null target_subject preserves 100% backward compatibility (no subject filter)
create or replace function match_chunks (
  query_embedding vector(768),
  match_threshold float default 0.75,
  match_count int default 5,
  target_subject text default null
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
    and (target_subject is null or documents.subject = target_subject)
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Explicitly re-grant execute to service_role
-- A recreated function in Postgres loses previous grants (prevents 42501 insufficient_privilege)
grant execute on function match_chunks(vector, double precision, integer, text) to service_role;
grant execute on function match_chunks(vector, float, int, text) to service_role;
