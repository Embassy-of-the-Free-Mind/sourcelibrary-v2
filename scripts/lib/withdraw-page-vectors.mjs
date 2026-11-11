/**
 * PRIOR ART: scripts/migration/add-page-translations-withheld.mjs --move — the statement this
 * reuses, but a one-off CLI keyed to the #4523 set; scripts/maintenance/withhold-*-6117/6388.mjs
 * — the same statement inlined per sweep; src/lib/prune-deleted-book.ts — whole-book removal,
 * which deliberately leaves page_translations alone (the read path gates on book existence).
 * None is callable from a writer that archives or removes ONE book's pages.
 *
 * withdrawPageVectors — when a page is archived (`page_number <= 0`: a spread superseded by its
 * halves, a deduped leaf) or removed from `pages` while its book stays, its `page_translations`
 * row must stop being served (#6270). Otherwise `match_semantic` keeps returning it, linked by its
 * old page number, which now belongs to a different page. The 2026-10-11 window withdrew the
 * 152,987 rows that had piled up; this is what stops new ones.
 *
 * THE MOVE, NOT A DELETE. `embedding` → `embedding_withheld`, `translation` →
 * `translation_withheld`, `withheld_at = now()`, `withheld_reason`. The row stays: it holds
 * reader-facing translation text. Reversible with `--unmove` in the migration script, filtered by
 * reason. Only rows with `withheld_at IS NULL` are touched, so a row already withheld for
 * another reason (#4523, #6117, #6388) keeps that reason and its parked text.
 *
 * Twin: src/lib/withdraw-page-vectors.ts (REST, for API routes). tests/unit/page-vector-withdraw-
 * writers.test.ts fails if a file that archives or removes pages does not call one of them.
 *
 * BEST-EFFORT, LOUD. The Mongo write has already happened when this runs, so it never throws:
 * a failure is logged with the page count and returned. The weekly page-vector-truth sample
 * exits 1 on any archived page with a served vector, which is the backstop.
 */
import pg from 'pg';

/** The reasons the 2026-10-11 window used; `--unmove` filters by them. */
export const WITHDRAW_REASONS = Object.freeze({
  archived: 'archived-page-6270',
  removed: 'page-missing-6270',
});

/** The `--move` statement of add-page-translations-withheld.mjs, reason as $2. */
export const WITHDRAW_SQL = `UPDATE page_translations
     SET translation_withheld = COALESCE(translation_withheld, translation),
         embedding_withheld   = COALESCE(embedding_withheld, embedding),
         translation = '',
         embedding = NULL,
         withheld_at = now(),
         withheld_reason = $2
   WHERE page_id = ANY($1::text[])
     AND withheld_at IS NULL
     AND (embedding IS NOT NULL OR COALESCE(translation,'') <> '')`;

const BATCH = 2000;

/**
 * @param {Iterable<string>} pageIds  the pages' `id` (not `_id`) — page_translations.page_id
 * @param {object} opts
 * @param {'archived'|'removed'} opts.reason  archived = page_number set <= 0; removed = deleted from `pages`
 * @param {string} opts.writer   who called, for the log line (e.g. 'split-book')
 * @param {import('pg').Client} [opts.pg]  reuse an open client; else one is opened from SUPABASE_DB_URL
 * @returns {Promise<{ withdrawn: number, error: string|null }>}
 */
export async function withdrawPageVectors(pageIds, { reason, writer, pg: client } = {}) {
  const ids = [...new Set([...(pageIds || [])].filter((x) => typeof x === 'string' && x))];
  if (!ids.length) return { withdrawn: 0, error: null };
  const label = WITHDRAW_REASONS[reason];
  if (!label) throw new Error(`withdrawPageVectors: reason must be one of ${Object.keys(WITHDRAW_REASONS).join(', ')}`);

  let own = null;
  let withdrawn = 0;
  try {
    if (!client) {
      if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL not set');
      own = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
      await own.connect();
    }
    const c = client || own;
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await c.query(WITHDRAW_SQL, [ids.slice(i, i + BATCH), label]);
      withdrawn += r.rowCount;
    }
    if (withdrawn) console.log(`  [withdraw-page-vectors] ${writer || '?'}: ${withdrawn} page_translations row(s) withheld (${label})`);
    return { withdrawn, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      `  [withdraw-page-vectors] ${writer || '?'}: FAILED for ${ids.length} page(s) (${label}): ${error} — ` +
      `their vectors are still served; re-run with the page ids (#6270)`,
    );
    return { withdrawn, error };
  } finally {
    if (own) await own.end().catch(() => {});
  }
}
