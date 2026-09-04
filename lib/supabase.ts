import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface DocumentRow {
  id: string;
  title: string;
  subject: string;
  uploaded_at: string;
}

export interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  embedding: number[];
  section_label: string;
}

export interface QueryCountRow {
  date: string;
  count: number;
}

export interface MatchChunkResult {
  id: string;
  document_id: string;
  content: string;
  section_label: string;
  document_title: string;
  similarity: number;
}

export function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
