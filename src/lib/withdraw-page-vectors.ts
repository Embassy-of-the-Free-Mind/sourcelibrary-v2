/**
 * PRIOR ART: scripts/lib/withdraw-page-vectors.mjs — the same move over direct postgres, which
 * API routes do not have; src/lib/prune-deleted-book.ts — whole-book removal, which deliberately
 * leaves page_translations alone.
 *
 * When an API route removes a page while its book stays (page delete, split reset, reimport), its
 * `page_translations` row must stop being served (#6270): park `embedding` and `translation` in
 * the `*_withheld` columns, set `withheld_at` / `withheld_reason`. Never delete the row — it holds
 * reader-facing translation text. Same reasons and same rule (only `withheld_at IS NULL` rows) as
 * the script twin; read its header for the why.
 *
 * REST cannot copy one column into another, so this reads the served values and writes them back
 * per row. Best-effort: the Mongo write has happened, so it never throws; failures are logged.
 */
import { supabaseAdmin } from '@/lib/supabase';

export const WITHDRAW_REASONS = {
  archived: 'archived-page-6270',
  removed: 'page-missing-6270',
} as const;

const CHUNK = 100; // ids per `in.()` filter — keeps the URL short

interface Row {
  page_id: string;
  translation: string | null;
  embedding: string | null;
  translation_withheld: string | null;
  embedding_withheld: string | null;
}

export async function withdrawPageVectors(
  pageIds: Iterable<string>,
  { reason, writer }: { reason: keyof typeof WITHDRAW_REASONS; writer: string },
): Promise<{ withdrawn: number; error: string | null }> {
  const ids = [...new Set([...pageIds].filter(x => typeof x === 'string' && x))];
  if (!ids.length) return { withdrawn: 0, error: null };
  const label = WITHDRAW_REASONS[reason];
  let withdrawn = 0;
  try {
    if (!supabaseAdmin) throw new Error('supabaseAdmin unavailable');
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabaseAdmin
        .from('page_translations')
        .select('page_id, translation, embedding, translation_withheld, embedding_withheld')
        .in('page_id', ids.slice(i, i + CHUNK))
        .is('withheld_at', null);
      if (error) throw new Error(error.message);
      const now = new Date().toISOString();
      for (const r of (data || []) as Row[]) {
        if (r.embedding == null && !r.translation) continue;
        const { error: e } = await supabaseAdmin
          .from('page_translations')
          .update({
            translation_withheld: r.translation_withheld ?? r.translation,
            embedding_withheld: r.embedding_withheld ?? r.embedding,
            translation: '',
            embedding: null,
            withheld_at: now,
            withheld_reason: label,
          })
          .eq('page_id', r.page_id)
          .is('withheld_at', null);
        if (e) throw new Error(e.message);
        withdrawn++;
      }
    }
    if (withdrawn) console.log(`[withdraw-page-vectors] ${writer}: ${withdrawn} page_translations row(s) withheld (${label})`);
    return { withdrawn, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      `[withdraw-page-vectors] ${writer}: FAILED for ${ids.length} page(s) (${label}): ${error} — ` +
      'their vectors are still served; withdraw them with scripts/lib/withdraw-page-vectors.mjs (#6270)',
    );
    return { withdrawn, error };
  }
}
