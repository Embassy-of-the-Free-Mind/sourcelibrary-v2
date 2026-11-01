#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/reconcile-cover-fields.mjs — its "hotlink" rule moves a cover to R2
 * only when ONE of the two cover fields is already on R2; here both are on the source host, so it has
 * nothing to pick. scripts/maintenance/fix-broken-image-thumb.mjs clears dead R2 thumbs, not external
 * ones. This reuses cover-write.mjs's buildCoverUpdate() so the written shape is the canonical one.
 *
 * rehost-walled-covers — point a book's cover at our R2 copy of the SAME page when the stored cover
 * URL is on a host that browsers cannot load.
 *
 * WHY (#5448, 2026-11-01)
 * Derek saw a broken cover at the top of /search?first_translation=true: Fludd, Utriusque cosmi
 * historia, whose four cover fields all named gallica.bnf.fr while all 848 of its pages were archived.
 * Loaded as an <img> in Chrome, one visible book's cover per host (3 each), 2026-11-01:
 *   fail: gallica.bnf.fr (346 visible books), content.staatsbibliothek-berlin.de (93), mps.lib.harvard.edu (93)
 *   load: e-rara, digitale-sammlungen, Heidelberg, vatlib, cdli, contentdm, Manchester, archive.org,
 *         museumsofindia, Wellcome, Göttingen, SLUB
 * isRenderableCoverUrl() already says a cover must never be written on a source host; these predate it.
 *
 * The cover PAGE does not change (cover_page and thumbnail_source are kept), only where its image is
 * read from. A book whose cover page has no R2 copy is listed and left alone.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/maintenance/rehost-walled-covers.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/rehost-walled-covers.mjs --apply
 *   ... --hosts=gallica.bnf.fr,other.host      # override the walled-host list
 */
import { MongoClient } from 'mongodb';
import { buildCoverUpdate, isRenderableCoverUrl } from '../lib/cover-write.mjs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const HOSTS = (argv.find((a) => a.startsWith('--hosts='))?.split('=')[1]
  ?? 'gallica.bnf.fr,content.staatsbibliothek-berlin.de,mps.lib.harvard.edu').split(',');
const FIELDS = ['thumbnail', 'thumbnail_blob', 'image_display', 'image_thumb'];
const hostRe = new RegExp(`^https?://(?:${HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})/`);

const mc = await MongoClient.connect(process.env.MONGODB_URI);
try {
  const db = mc.db('bookstore');
  const books = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, $or: FIELDS.map((f) => ({ [f]: hostRe })) },
    { projection: { id: 1, slug: 1, title: 1, cover_page: 1, thumbnail_source: 1, ...Object.fromEntries(FIELDS.map((f) => [f, 1])) } },
  ).toArray();
  console.log(`${books.length} visible book(s) with a cover field on ${HOSTS.join(', ')}${APPLY ? '' : ' (dry run)'}`);

  let written = 0;
  const skipped = [];
  for (const b of books) {
    const id = b.id ?? String(b._id);
    const pageNo = b.cover_page ?? 1;
    const page = await db.collection('pages').findOne({ book_id: id, page_number: pageNo });
    const update = page && buildCoverUpdate(page, {
      source: b.thumbnail_source ?? 'pipeline-auto', method: 'rehost-walled-cover', actor: 'script',
      detail: `same page ${pageNo}, read from R2 instead of ${new URL(FIELDS.map((f) => b[f]).find((u) => hostRe.test(u ?? ''))).host} (#5448)`,
    });
    if (!update || !isRenderableCoverUrl(update.image_display) || !isRenderableCoverUrl(update.image_thumb)) {
      skipped.push(`${id} p${pageNo} ${update ? `not on R2: ${update.image_display}` : 'cover page missing'}`);
      continue;
    }
    if (APPLY) {
      // updated_at: the Supabase books_catalog sync is incremental on it, and search renders the
      // catalogue's copy of `thumbnail` — without it the fix reaches the book page but never search.
      const r = await db.collection('books').updateOne({ _id: b._id }, { $set: { ...update, updated_at: new Date() } });
      written += r.modifiedCount;
    } else if (written++ < 3) {
      console.log(`  ${id} p${pageNo}: ${b.image_display} → ${update.image_display}`);
    }
  }
  console.log(`${APPLY ? 'written' : 'would write'}: ${written}; skipped (cover page has no R2 copy): ${skipped.length}`);
  for (const s of skipped.slice(0, 20)) console.log(`  skip ${s}`);
} finally {
  await mc.close();
}
