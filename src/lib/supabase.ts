/**
 * Shared Supabase client for Source Library.
 *
 * Two clients:
 *   - supabase: read-only anon client (catalog lookups, public queries)
 *   - supabaseAdmin: service-role client (analytics writes, DDL)
 *
 * Usage:
 *   import { supabase, supabaseAdmin } from '@/lib/supabase';
 *   const { data } = await supabase.from('ustc_editions').select('sn,title').eq('sn', 12345);
 *   await supabaseAdmin.from('gemini_usage').insert(row);
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Exported for backward compat with files that build PostgREST URLs manually.
// New code should use the supabase client directly.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_ANON_KEY && typeof window === 'undefined') {
  console.warn('SUPABASE_ANON_KEY not set — Supabase queries will fail');
}

// Read-only anon client (safe for server + client)
// Use a placeholder key during build to avoid crash — requests will fail but build succeeds.
// At runtime on Vercel, the real key is always available.
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY || 'build-placeholder',
  { auth: { persistSession: false } },
);

// Service-role client for writes (server-only, optional)
export const supabaseAdmin: SupabaseClient | null = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

/**
 * Helper: query USTC editions by Supabase auto-increment ID.
 * Note: `id` is the Supabase row ID, NOT the USTC serial number (`sn`).
 */
export async function getUstcEditionById(id: number) {
  const { data } = await supabase
    .from('ustc_editions')
    .select('sn, title, author_1, year, language_1, place')
    .eq('id', id)
    .single();
  return data;
}

/**
 * Helper: search USTC enrichments by English title (uses trigram index).
 */
export async function searchUstcEnrichments(query: string, limit = 20) {
  const { data } = await supabase
    .from('ustc_enrichments')
    .select('id, english_title, std_title, original_author, detected_language')
    .ilike('english_title', `%${query}%`)
    .limit(limit);
  return data || [];
}
