#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/fix-external-thumbnails.mjs — same goal, but it matches the cover by exact URL (an IA
// cover URL never equals the page's `photo`), so it falls back to page 1 blind (colour cards, blank boards) and writes
// only `thumbnail`. scripts/maintenance/repoint-provider-thumbs-to-r2.mjs — the page-level twin (pages.image_thumb).
// scripts/lib/cover-write.mjs buildCoverUpdate / selectFallbackCoverPage — the canonical writer and fallback, used here.
/**
 * Repoint archive.org BookReader covers at the R2 copy of the SAME leaf (#7743).
 *
 * WHY. ~6.4K visible books store their cover as `archive.org/download/<id>/page/nN/…`. That endpoint serves IA's master
 * whatever size it names (measured 2026-10-29), so cards cannot show it and fall back to IA's 180px item thumbnail
 * (PR #7740). In a 300-book sample, 299 already held every one of their first 25 pages on R2 (`archived_photo`), so
 * nothing needs downloading: the cover only has to point at our copy.
 *
 * WHICH PAGE. The leaf the stored cover names (`/page/nN/`), found as the page whose `photo` is that same IA leaf —
 * someone or something chose it. If that page is junk by page_type (colour card, blank, digitizer insert) or no page
 * matches, selectFallbackCoverPage over the first 30 pages (title page, then frontispiece, then first usable).
 *
 * SAFETY. Writes only when the chosen page's cover URL is on R2, book-scoped (isBookScopedUrl) and answers 200 to a
 * HEAD. The old value goes to field_provenance.thumbnail.previous; one sweep_log row per book. Dry run unless --apply.
 * Checkpointed (--state=FILE), so an interruption costs one book.
 *
 *   node --env-file=.env.production.local scripts/maintenance/repoint-ia-covers-to-r2-7743.mjs [--limit=N] [--apply]
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';
import { buildCoverUpdate, isRenderableCoverUrl, resolvePageCoverUrl, selectFallbackCoverPage } from '../lib/cover-write.mjs';
import { isBookScopedUrl } from '../lib/r2-key.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'repoint-ia-covers-7743';
const APPLY = process.argv.includes('--apply');
const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const LIMIT = Number(arg('limit', 0));
const STATE = arg('state', `/tmp/${SWEEP}.done`);
const IA_COVER = /^https:\/\/archive\.org\/download\/([^/?#]+)\/page\/n(\d+)\//;
const JUNK_TYPES = new Set(['blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata', 'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target']);

const done = new Set(fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').split('\n').filter(Boolean) : []);
const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 120000 });
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, thumbnail: { $regex: '^https://archive\\.org/download/' } },
  { projection: { id: 1, title: 1, thumbnail: 1, image_display: 1 } },
).toArray();
const todo = books.filter((b) => !done.has(b.id) && !isRenderableCoverUrl(b.image_display));
console.log(`${books.length} books with an IA BookReader cover; ${todo.length} to do${APPLY ? '' : ' (dry run)'}`);

const tally = { written: 0, same_leaf: 0, fallback: 0, no_r2: 0, not_scoped: 0, head_fail: 0, no_pages: 0 };
const head = async (url) => { try { return (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })).ok; } catch { return false; } };

let n = 0;
for (const b of todo) {
  if (LIMIT && n >= LIMIT) break;
  n++;
  const leaf = b.thumbnail.match(IA_COVER);
  const pages = await db.collection('pages').find(
    { book_id: b.id, page_number: { $lte: 30 } },
    { projection: { _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, image_thumb: 1, thumbnail_blob: 1, split_from_spread: 1, crop: 1, page_type: 1 } },
  ).sort({ page_number: 1 }).toArray();
  if (!pages.length) { tally.no_pages++; continue; }

  let page = leaf && pages.find((p) => String(p.photo || '').includes(`/download/${leaf[1]}/page/n${leaf[2]}/`) || String(p.photo || '').endsWith(`/download/${leaf[1]}/page/n${leaf[2]}.jpg`));
  let how = 'same-leaf';
  if (!page || JUNK_TYPES.has(String(page.page_type || ''))) { page = selectFallbackCoverPage(pages); how = 'fallback'; }

  const url = resolvePageCoverUrl(page);
  const skip = (why) => { tally[why]++; if (n <= 20 || tally[why] <= 5) console.log(`  skip ${b.id} p${page.page_number}: ${why} ${String(url).slice(0, 80)}`); };
  if (!isRenderableCoverUrl(url)) { skip('no_r2'); continue; }
  if (!isBookScopedUrl(url, b.id)) { skip('not_scoped'); continue; }
  if (!(await head(url))) { skip('head_fail'); continue; }

  const update = buildCoverUpdate(page, { source: SWEEP, method: how, actor: 'script', confidence: how === 'same-leaf' ? 0.95 : 0.7, detail: `#7743 R2 copy of the IA cover leaf` });
  // A dotted key, so the book's other field_provenance entries survive the $set.
  update['field_provenance.thumbnail'] = { ...update.field_provenance.thumbnail, previous: b.thumbnail };
  delete update.field_provenance;
  update.updated_at = new Date();
  tally[how === 'same-leaf' ? 'same_leaf' : 'fallback']++;
  if (n <= 10) console.log(`  ${how} ${b.id} p${page.page_number} ${String(b.title || '').slice(0, 40)} -> ${url}`);
  if (!APPLY) continue;

  await db.collection('books').updateOne({ id: b.id, thumbnail: b.thumbnail }, { $set: update });
  await recordSweepActions(db, [{ sweep: SWEEP, book_id: b.id, action: 'cover-repointed-to-r2', detail: { page: page.page_number, how, previous: b.thumbnail, url } }]);
  fs.appendFileSync(STATE, `${b.id}\n`);
  tally.written++;
  if (tally.written % 250 === 0) console.log(`  ${tally.written} written`, JSON.stringify(tally));
}

console.log(JSON.stringify(tally));
await client.close();
