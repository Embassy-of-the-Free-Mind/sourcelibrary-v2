/**
 * PRIOR ART: scripts/lib/page-revisions.mjs `saveRevisionsBeforeOverwrite` — snapshots the
 * superseded text but records no after-hash, no issue and no reason text, and swallows its
 * own failure (by design: a pipeline write must not block on it). A hand repair is the
 * opposite case: no revision, no write. scripts/maintenance/fix-unclosed-note-tags.mjs —
 * wrote a revision without content_hash, skipped no human edits, re-synced no mirror.
 * scripts/maintenance/restore-withheld-translation.mjs — the mirror re-sync pattern reused
 * below (sync-pages-content.mjs --book).
 *
 * A small, deliberate edit to STORED translation text (a wrong note, a broken tag) — not a
 * new reading. One door for the guards every such repair needs (#5624, #5644):
 *
 *   1. skip a page a human edited (`translation.source: 'manual'` or `edited_by`/`edited_at`);
 *   2. skip a page whose stored text is no longer the text the repair was computed from
 *      (the caller passes `expectBefore`; the update filters on it too, so a concurrent
 *      retranslation between read and write turns into a skip, not a clobber);
 *   3. write the `page_revisions` row FIRST, with the before AND after content_hash, the
 *      reason and the issue — and do not write the page if that insert fails;
 *   4. stamp the new `translation.content_hash` so the page still proves which text it holds.
 *
 * `translation.updated_at` and the engine block are left alone on purpose: the text is still
 * that run's reading with a correction applied, and the revision row is the record of the
 * correction. Mirrors are re-synced by `resyncMirrors()`.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { contentHash } from './write-provenance.mjs';
import { pageEmbeddingInput } from './page-embedding-text.mjs';

export function isHumanEditedTranslation(t) {
  return !!(t && (t.source === 'manual' || t.edited_by || t.edited_at));
}

/**
 * @returns {Promise<{status:'written'|'skipped', why?:string, before_hash?:string, after_hash?:string}>}
 */
export async function repairTranslationText(db, page, next, { expectBefore, source, reason, issue, jobId, apply }) {
  if (!source || !reason || !issue) throw new Error('repairTranslationText: source, reason and issue are required');
  const t = page.translation || {};
  const before = t.data;
  if (typeof before !== 'string' || !before) return { status: 'skipped', why: 'no_translation' };
  if (isHumanEditedTranslation(t)) return { status: 'skipped', why: 'human_edited' };
  if (expectBefore !== undefined && before !== expectBefore) return { status: 'skipped', why: 'text_changed' };
  if (next === before) return { status: 'skipped', why: 'no_change' };
  const beforeHash = contentHash(before);
  const afterHash = contentHash(next);
  if (!apply) return { status: 'dry_run', before_hash: beforeHash, after_hash: afterHash };

  const now = new Date();
  await db.collection('page_revisions').insertOne({
    id: randomBytes(6).toString('hex'),
    page_id: page.id,
    book_id: page.book_id,
    field: 'translation',
    data: before,
    source,
    reason,
    issue,
    job_id: jobId,
    model: t.model,
    prompt_version: t.prompt_version,
    language: t.language,
    original_date: t.updated_at,
    created_at: now,
    content_hash: beforeHash,
    after_content_hash: afterHash,
    ...(t.engine ? { engine: t.engine } : {}),
  });

  const res = await db.collection('pages').updateOne(
    { id: page.id, 'translation.data': before, 'translation.source': { $ne: 'manual' }, 'translation.edited_by': { $in: [null, ''] } },
    { $set: { 'translation.data': next, 'translation.content_hash': afterHash, updated_at: now } },
  );
  if (res.modifiedCount !== 1) return { status: 'skipped', why: `write_raced(matched=${res.matchedCount})`, before_hash: beforeHash, after_hash: afterHash };
  return { status: 'written', before_hash: beforeHash, after_hash: afterHash };
}

/**
 * Re-sync both Supabase mirrors for the repaired pages: the `pages` mirror (whole book, as
 * restore-withheld-translation.mjs does) and the `translation` column of `page_translations`
 * (the search/snippet text; notes are unwrapped into it, so a wrong note is quotable there).
 * The embedding vector is NOT recomputed — a note-sized edit does not move it meaningfully.
 */
export async function resyncMirrors(db, pageIds, { log = console.log } = {}) {
  const pages = await db.collection('pages').find({ id: { $in: pageIds } }, { projection: { id: 1, book_id: 1, 'translation.data': 1 } }).toArray();
  const out = { books_synced: 0, books_failed: 0, pt_updated: 0, pt_absent: 0 };
  for (const bookId of new Set(pages.map((p) => p.book_id))) {
    try {
      execFileSync(process.execPath, ['scripts/workers/sync-pages-content.mjs', `--book=${bookId}`], { stdio: 'pipe', timeout: 300000, env: process.env });
      out.books_synced++;
    } catch (e) { out.books_failed++; log(`${bookId}: Supabase pages mirror sync FAILED — ${String(e.message).slice(0, 160)}`); }
  }
  if (!process.env.SUPABASE_DB_URL) { log('SUPABASE_DB_URL unset — page_translations NOT re-synced'); return out; }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const p of pages) {
      const input = pageEmbeddingInput(p);
      if (!input?.hasTranslation) continue;
      const r = await client.query('UPDATE page_translations SET translation = $1 WHERE page_id = $2', [input.text.slice(0, 50000), p.id]);
      if (r.rowCount) out.pt_updated += r.rowCount; else out.pt_absent++;
    }
  } finally { await client.end(); }
  return out;
}

/** Count opening/closing `<note>` tags and malformed `</note` closers. */
export function noteTagBalance(text) {
  const s = String(text || '');
  const opens = (s.match(/<note>/gi) || []).length;
  const closes = (s.match(/<\/note>/gi) || []).length;
  const malformed = (s.match(/<\/note(?!>)/gi) || []).length;
  return { opens, closes, malformed, balanced: opens === closes && malformed === 0 };
}
