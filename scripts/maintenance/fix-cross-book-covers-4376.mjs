#!/usr/bin/env node
/**
 * Covers that point at another book's image — issue #4376 (#3362 survivors).
 *
 * WHAT WAS WRONG
 * --------------
 * Each book below carries a cover URL whose R2 key does not contain its own
 * book id, which is the #3362 shape: a key that is not book-scoped is shared by
 * construction, and nothing downstream can notice, because R2 serves a real,
 * complete, 200-OK JPEG for it. Two were surfaced by `assertBookScopedKey`
 * during the cover-card backfill (#4344), which refused to derive a card
 * variant from either key; the other three by the cover lane this same PR adds
 * to `scripts/audit/r2-key-book-scope.mjs`, which had only ever looked at pages.
 * All five images below were opened and read on 2026-09-02.
 *
 *   69bfbeb294e521147a83f245  "Complete Works VI — Against Plethon…"   [VISIBLE]
 *       archived/undefined/1.jpg — an `undefined`-keyed artifact of #3362.
 *       Renders Google's "This is a digital copy of a book…" boilerplate leaf:
 *       some other book's front matter on a Greek Gennadios Scholarios volume.
 *
 *   69a02781bd4078a454714f6d  "Theologia germanica"                     [VISIBLE]
 *       cropped/69a02781bd4078a454714f6f/… — one character off its own id, and
 *       book …f6f is real. Renders the title page of *The Third Booke of the
 *       Authour… Threefold Life of Man* (Behmen, London 1650) — which is …f6f's
 *       own title. Wrong twice over: another book's key, another work's page.
 *
 *   6974b644457dd8909910b9ef  "Archaeologiae philosophicae…"            [VISIBLE]
 *       pages/6974b644457dd8909910b9ed/0007-full.jpg — and …9ed is a real,
 *       visible book ("Arcanum hermeticae philosophiae opus") that owns that
 *       key. This is a live collision: the catalogue currently shows Arcanum's
 *       title page on Archaeologiae's card.
 *
 *   697c8e0f4733b2a5648ad8bf  "Das Geheimnis aller Geheimnisse…"        [VISIBLE]
 *       pages/697c8e0f4733b2a5648ad8bd/0002-full.jpg — …8bd is a real, visible
 *       book ("Gott"). The object happens to hold the right picture today, so
 *       nothing looks wrong; that is the whole hazard. "Gott" writing its own
 *       page 2 would silently replace this book's cover.
 *
 *   69aeab1767e6731bc1365f75  "Geschichte und Klassenbewußtsein"        [hidden]
 *       pages/undefined/0007-thumb.jpg on image_thumb + thumbnail_blob. A
 *       second `undefined` survivor — #4376 called …f245 the only one, which
 *       was true of the `archived/undefined/` prefix it searched.
 *
 * WHY A NAMED TABLE AND NOT A RULE
 * --------------------------------
 * `reconcile-cover-fields.mjs` (#4346) deliberately refuses to guess for this
 * shape. For four of the five there is nothing to guess: the book's own
 * recorded `cover_page` already carries a correctly book-scoped image, and the
 * mis-keyed URL was copied onto the book from a *different* field of the same
 * page. Only …f6d needs a judgement — its cover_page 14 has no book-scoped
 * variant at all — and that one was made by reading the page (see its `why`).
 * Five audited decisions, written down; not a heuristic loosed on the corpus.
 *
 * SAFETY
 * ------
 * Dry-run by default. Per book, before writing, this asserts:
 *   - the book's current cover really is the mis-scoped URL on record (so a
 *     later fix, by hand or by another sweep, is never silently overwritten);
 *   - the replacement page exists, and is the page_type recorded in the table;
 *   - the replacement URL is book-scoped (`assertBookScopedKey`) — the fix is
 *     not allowed to reintroduce the bug it is repairing;
 *   - the replacement URL actually loads (HTTP 200).
 * It writes through `buildCoverUpdate()` so all four cover fields move
 * together, and records a `sweep_log` row per book (field-sprawl invariant).
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/maintenance/fix-cross-book-covers-4376.mjs
 *   node --env-file=.env.production.local scripts/maintenance/fix-cross-book-covers-4376.mjs --apply
 *
 * After --apply: `node scripts/maintenance/backfill-cover-cards.mjs` to build the
 * 500px card variants (buildCoverUpdate clears `image_card` by contract), then
 * POST the two slugs to /api/admin/revalidate.
 */
import { MongoClient } from 'mongodb';
import { buildCoverUpdate, resolvePageCoverUrl, isRenderableCoverUrl } from '../lib/cover-write.mjs';
import { assertBookScopedKey, isBookScopedUrl } from '../lib/r2-key.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'cross-book-covers-4376';

/**
 * The two audited decisions. `expect_cover` pins what we believe is on record;
 * a mismatch aborts that book rather than writing over someone else's fix.
 */
const FIXES = [
  {
    book_id: '69bfbeb294e521147a83f245',
    expect_cover: 'https://images.sourcelibrary.org/archived/undefined/1.jpg',
    page_number: 1,
    expect_page_type: 'title-page',
    why: 'the book\'s own single page — its publisher cover plate, "Gennadius Scholarius '
       + 'Complete Works / VOLUME 6" — under a correctly book-scoped archived/ key',
  },
  {
    book_id: '69a02781bd4078a454714f6d',
    expect_cover: 'https://images.sourcelibrary.org/cropped/69a02781bd4078a454714f6f/69a02a0c75873c3b8b8a8e6e.jpg',
    // NOT the recorded cover_page (14). p14's only image is the mis-keyed crop
    // itself, so it cannot be repaired in place. p13 is the same right-hand half
    // of the same spread under a correct key and would preserve the current
    // picture exactly — but the current picture is another work's title page.
    // p9 is this volume's own.
    page_number: 9,
    expect_page_type: 'title-page',
    why: 'p9 is this book\'s actual title page — "THEOLOGIA Germanica. LIBELLVS AVREVS… '
       + 'BASILEAE, PER IOANnem Oporinum" — and its crop is already keyed under this '
       + 'book\'s own id, unlike the p14 crop it replaces',
  },
  {
    book_id: '6974b644457dd8909910b9ef',
    expect_cover: 'https://images.sourcelibrary.org/pages/6974b644457dd8909910b9ed/0007-full.jpg',
    page_number: 7,
    expect_page_type: 'title-page',
    why: 'the recorded cover_page, unchanged — p7\'s own `photo` is already book-scoped '
       + '("ARCHÆOLOGIÆ Philosophicæ… LONDINI… M.DC.XCII"); only the book document had '
       + 'picked up p7\'s mis-keyed `cropped_photo` instead',
  },
  {
    book_id: '697c8e0f4733b2a5648ad8bf',
    expect_cover: 'https://images.sourcelibrary.org/pages/697c8e0f4733b2a5648ad8bd/0002-full.jpg',
    page_number: 2,
    expect_page_type: 'title-page',
    why: 'the recorded cover_page, unchanged — p2\'s own `photo` is already book-scoped '
       + 'and holds the same title page ("Das Geheimnis aller Geheimniße… Leipzig, 1788")',
  },
  {
    book_id: '69aeab1767e6731bc1365f75',
    expect_cover: 'https://images.sourcelibrary.org/pages/undefined/0007-thumb.jpg',
    page_number: 1,
    // A split-spread page from an era that did not set page_type.
    expect_page_type: null,
    why: 'the recorded cover_page, unchanged — p1 carries book-scoped `photo` and '
       + '`thumbnail_blob`, so re-deriving the cover from it clears the shared '
       + '`pages/undefined/` thumb without changing which page is shown',
  },
];

async function loads(url) {
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
    return r.ok;
  } catch { return false; }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const Books = db.collection('books');
const Pages = db.collection('pages');

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

let applied = 0, skipped = 0;

for (const fix of FIXES) {
  // Look up by `id` OR `_id`: 16,343 books carry a re-minted `_id`, and both of
  // these do — an `_id`-only lookup finds neither. Pages join on `book_id`,
  // which is the `id`.
  const book = await Books.findOne(
    { $or: [{ id: fix.book_id }, { _id: fix.book_id }] },
    { projection: { id: 1, title: 1, visible: 1, cover_page: 1, thumbnail_source: 1,
                    image_display: 1, image_thumb: 1, image_card: 1, image_full: 1,
                    thumbnail: 1, thumbnail_blob: 1 } },
  );
  const label = `${fix.book_id} "${String(book?.title || '?').slice(0, 45)}"`;
  const bail = (reason) => { console.log(`  SKIP ${label}\n       ${reason}\n`); skipped++; };

  if (!book) { bail('book not found'); continue; }

  // Already fixed, or moved on. Either way this script has nothing to say.
  const current = [book.image_display, book.thumbnail, book.image_thumb, book.thumbnail_blob]
    .filter(u => typeof u === 'string');
  if (!current.includes(fix.expect_cover)) {
    bail(`cover no longer matches the audited value — expected\n         ${fix.expect_cover}\n       `
       + `but found\n         image_display=${book.image_display}\n         thumbnail=${book.thumbnail}\n       `
       + 'left alone: someone else may have fixed this already');
    continue;
  }
  if (book.thumbnail_source === 'manual') {
    bail('cover was picked by a human (thumbnail_source: manual) — not overruling it');
    continue;
  }

  const page = await Pages.findOne(
    { book_id: book.id, page_number: fix.page_number },
    { projection: { page_number: 1, page_type: 1, photo: 1, photo_original: 1, crop: 1,
                    split_from_spread: 1, cropped_photo: 1, enhanced_photo: 1,
                    archived_photo: 1, image_thumb: 1, thumbnail_blob: 1 } },
  );
  if (!page) { bail(`page ${fix.page_number} not found`); continue; }
  if ((page.page_type ?? null) !== (fix.expect_page_type ?? null)) {
    bail(`page ${fix.page_number} is page_type "${page.page_type}", expected "${fix.expect_page_type}" — `
       + 'the page series has changed since this fix was audited');
    continue;
  }

  const url = resolvePageCoverUrl(page);
  if (!url) { bail(`page ${fix.page_number} has no usable image URL`); continue; }
  if (!isRenderableCoverUrl(url)) { bail(`replacement is not on a renderable host: ${url}`); continue; }
  try {
    // The whole point of the repair: refuse to write a key that is not this
    // book's. `assertBookScopedKey` takes the key, not the URL.
    assertBookScopedKey(new URL(url).pathname.replace(/^\//, ''), book.id, SWEEP);
  } catch (e) { bail(`replacement is not book-scoped — ${e.message}`); continue; }
  if (!await loads(url)) { bail(`replacement URL does not load: ${url}`); continue; }

  // Keep an existing thumb variant when it is genuinely this book's and still
  // live. `buildCoverUpdate` reads `page.image_thumb` first, so seeding it here
  // preserves the small derived thumb instead of pointing `image_thumb` at a
  // full-size scan. Only ever from a book-scoped, loading URL — a mis-keyed
  // thumb is exactly what we are here to remove.
  let preserved = null;
  if (!page.image_thumb && !page.thumbnail_blob) {
    const candidate = [book.image_thumb, book.thumbnail_blob]
      .find(u => typeof u === 'string' && u !== fix.expect_cover
        && isRenderableCoverUrl(u) && isBookScopedUrl(u, book.id));
    if (candidate && await loads(candidate)) preserved = candidate;
  }

  const update = buildCoverUpdate(preserved ? { ...page, image_thumb: preserved } : page, {
    source: SWEEP,
    method: 'cross-book-cover-repair',
    actor: 'script',
    detail: fix.why,
  });
  if (!update) { bail('buildCoverUpdate returned null'); continue; }

  console.log(`  ${APPLY ? 'FIX ' : 'WOULD FIX '} ${label}`);
  console.log(`       drop  ${fix.expect_cover}`);
  console.log(`       keep  ${url}   (p${page.page_number}, ${page.page_type})`);
  if (preserved) console.log(`       thumb ${preserved}   (preserved — already book-scoped)`);
  console.log(`       why   ${fix.why}`);

  if (!APPLY) { console.log(); continue; }

  // No $unset alongside: `buildCoverUpdate` already carries `image_card: null`,
  // and setting + unsetting the same path makes Mongo reject the whole write.
  await Books.updateOne({ _id: book._id }, { $set: { ...update, updated_at: new Date() } });
  await recordSweepAction(db, {
    sweep: SWEEP,
    book_id: book.id,
    action: 'cover-rekeyed-to-own-book',
    detail: { from: fix.expect_cover, to: url, page_number: page.page_number, why: fix.why },
  });
  applied++;
  console.log(`       written\n`);
}

console.log(`\n${APPLY ? 'fixed' : 'would fix'}: ${APPLY ? applied : FIXES.length - skipped}   skipped: ${skipped}`);
if (APPLY && applied) {
  console.log('\nNext:');
  console.log('  node scripts/maintenance/backfill-cover-cards.mjs   # rebuild the 500px card variants');
  console.log('  node scripts/audit/r2-key-book-scope.mjs --covers   # confirm the class is clear');
}

await client.close();
