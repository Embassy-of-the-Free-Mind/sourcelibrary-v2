#!/usr/bin/env node
/**
 * Repair pages that were split in half even though their source scan was a
 * SINGLE leaf, not a two-page spread.
 *
 * The shape of the bug (found 2026-08-02 via Corey, on the Weigel
 * `Studium Universale` frontispiece):
 *
 *   BPH photography is mixed within one book — front matter is often shot one
 *   leaf at a time (portrait) while the body is shot as spreads (landscape).
 *   A splitter that applies a uniform 50/50 cut to every page therefore cuts
 *   the individually-shot leaves in half. The reader then renders half a
 *   frontispiece, and the download button hands out that same half.
 *
 * The discriminator is the SOURCE image's aspect ratio measured against THIS
 * BOOK'S OWN leaf ratio, read from the bytes on R2 — not any stored flag, and
 * not an absolute threshold. Absolute tests fail: single-leaf and spread aspect
 * ratios from different books overlap, so `w > h` flagged all 543 correctly
 * split pages of a book whose leaves are tall and narrow. See
 * referenceLeafAspect() below.
 *
 * Two conditions must BOTH hold before a page counts as broken, because either
 * alone misleads in a different direction:
 *   - the source sits at ~1x the book's leaf ratio (it is one leaf, not two);
 *   - the materialized image is actually about half the source width.
 * Sources between 1.25x and 1.75x are ambiguous and are abstained on, never
 * guessed: spot checks found real spreads at 1.32x and 1.40x.
 *
 * Note raw pixel width does NOT work in place of aspect ratio — scan resolution
 * varies within a book (one book references leaves at 3290px and crops sources
 * at 2000px), so widths are not comparable across pages. Aspect ratio is.
 *
 * Nothing was destroyed by the bad split: `archived_photo` still holds the
 * complete leaf, and the canonical `pages/{book}/{NNNN}.jpg` / `-thumb.jpg`
 * variants are full-page resizes of it. Only three fields point at the half —
 * `crop`, `cropped_photo`, and `thumbnail` (which the splitter repointed at
 * the confusingly-named `…-full.jpg`, which IS the half). Clearing them
 * restores the full page through the normal resolver in
 * `src/lib/page-image-url.ts`.
 *
 * Usage:
 *   node scripts/maintenance/fix-false-split-portrait-pages.mjs --book <slug|id>
 *   node scripts/maintenance/fix-false-split-portrait-pages.mjs --book <slug> --apply
 *   node scripts/maintenance/fix-false-split-portrait-pages.mjs --all-bph        # scan
 *   node scripts/maintenance/fix-false-split-portrait-pages.mjs --revert <backup.json>
 *
 * Dry-run by default. Writes a backup next to the repo's scripts/output/ before
 * any change, and `--revert` restores it exactly.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a');
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const APPLY = args.includes('--apply');
const BOOK = arg('--book');
const REVERT = arg('--revert');
const ALL_BPH = args.includes('--all-bph');
const LIMIT = Number(arg('--limit') || 0);
const BOOK_CONCURRENCY = Number(arg('--books-at-once') || 6);
const PAGE_CONCURRENCY = Number(arg('--pages-at-once') || 12);
/** Append every scanned book's verdict here, so a long scan is resumable/inspectable. */
const REPORT = arg('--report');

/** Parse width/height out of a JPEG's SOF marker. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0-SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Read an image's dimensions from its first 128KB. A ranged GET keeps this
 * cheap enough to run over a whole book (the SOF marker is near the head).
 */
async function dims(url) {
  if (!url) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
      if (!r.ok && r.status !== 206) return null;
      return jpegSize(Buffer.from(await r.arrayBuffer()));
    } catch {
      /* retry once — R2 occasionally resets a ranged connection */
    }
  }
  return null;
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const hasCrop = (p) => p.crop?.xStart !== undefined || !!p.cropped_photo;

/** Measure a page's source and, if it carries a crop, its materialized image. */
async function measure(page) {
  const source = page.archived_photo || page.photo_original;
  const [src, shown] = await Promise.all([dims(source), hasCrop(page) ? dims(page.cropped_photo) : null]);
  if (!src) return null;
  return { page, src, shown, ar: src.w / src.h };
}

/**
 * The aspect ratio of ONE leaf of this book.
 *
 * An absolute test cannot work: single-leaf and spread aspect ratios from
 * different books overlap. A book with tall narrow leaves (1415x3106, ar 0.46)
 * produces a genuine spread at 2780x3105 — ar 0.90, still taller than wide.
 * A `w > h` test calls that spread "portrait" and flags all 543 of its
 * correctly-split pages. So the reference must come from the book itself.
 *
 * Two independent references, and they must agree:
 *   - uncropped pages, which are single leaves by definition;
 *   - bimodality of the cropped pages' sources, whose two clusters (single
 *     leaves and spreads) should sit a factor of ~2 apart.
 * Returns null — abstain — when neither exists or they disagree. An
 * unmeasurable is not a zero.
 */
function referenceLeafAspect(measured) {
  const cropped = measured.filter((m) => hasCrop(m.page));
  const uncropped = measured.filter((m) => !hasCrop(m.page));

  const fromUncropped = uncropped.length >= 2 ? median(uncropped.map((m) => m.ar)) : null;

  let fromBimodality = null;
  const ars = cropped.map((m) => m.ar).sort((a, b) => a - b);
  if (ars.length >= 6) {
    const mid = median(ars);
    const lo = median(ars.filter((a) => a < mid));
    const hi = median(ars.filter((a) => a >= mid));
    if (lo > 0 && hi / lo > 1.6 && hi / lo < 2.5) fromBimodality = lo;
  }

  if (fromUncropped !== null && fromBimodality !== null) {
    if (Math.abs(fromBimodality - fromUncropped) / fromUncropped > 0.25) {
      return { ref: null, how: 'uncropped and bimodal references disagree' };
    }
    return { ref: fromUncropped, how: `${uncropped.length} uncropped pages, bimodality agrees` };
  }
  if (fromUncropped !== null) return { ref: fromUncropped, how: `${uncropped.length} uncropped pages` };
  if (fromBimodality !== null) return { ref: fromBimodality, how: `bimodal clusters` };
  return { ref: null, how: 'no single-leaf reference' };
}

async function scanBook(db, book) {
  const all = (
    await db
      .collection('pages')
      .find({ book_id: book.id })
      .project({
        page_number: 1,
        crop: 1,
        cropped_photo: 1,
        archived_photo: 1,
        photo_original: 1,
        display_photo: 1,
        thumbnail: 1,
        image_thumb: 1,
        photo: 1,
        split_from_spread: 1,
      })
      .toArray()
  )
    // Negative page numbers are soft-hidden duplicates; they are not rendered.
    .filter((p) => p.page_number > 0);

  const cropBearing = all.filter(hasCrop);
  if (cropBearing.length === 0) return { book, broken: [], checked: 0 };

  // Measure every cropped page, plus a sample of uncropped ones for the
  // reference — enough for a median without paying for a whole unsplit book.
  const uncroppedSample = all.filter((p) => !hasCrop(p)).slice(0, 30);
  const measured = (await mapLimit([...cropBearing, ...uncroppedSample], PAGE_CONCURRENCY, measure)).filter(Boolean);

  const { ref, how } = referenceLeafAspect(measured);
  if (ref === null) {
    return { book, broken: [], checked: cropBearing.length, undetermined: how };
  }

  // A page is visibly broken only when BOTH hold. Either alone misleads:
  // "source is one leaf" flags spurious-but-unmaterialized crops that render
  // fine, and "rendered is a half" is true of every correct split too, since
  // the crop always removes half the width.
  //
  // Nearest-neighbour between 1x and 2x is NOT good enough: a source at 1.3-1.4x
  // the leaf ratio is closer to 1x, so it gets called a single leaf, but spot
  // checks showed those are real spreads (irregular openings, fold-out plates,
  // or an unrepresentative reference drawn from few uncropped pages). Grick p74
  // at 1.40x and Cooke p57 at 1.32x are both visibly two facing pages. Every
  // verified true positive sits at 0.91-1.08x. So require a decisive 1x and
  // abstain in the dead zone rather than guess.
  //
  // The per-book reference is necessary but NOT sufficient, because "uncropped
  // pages are single leaves" is false: in a partly-split book the unsplit pages
  // may themselves be spreads nobody got to. Sabbathier draws its reference from
  // 24 uncropped pages that are all spreads (bookplate on the left leaf, shelf
  // marks on the right), yielding ref 1.631 — a SPREAD ratio — against which its
  // real spreads at 1.598 read as "single leaves", flagging all 70 pages.
  //
  // So gate on an absolute ceiling too. Book leaves are portrait or near-square
  // in overwhelming majority; a source wider than 1.2 is a spread in practice.
  // Oblong-format books do exist, so this can miss a genuine break in one — an
  // accepted false negative, since missing a repair is recoverable and a wrong
  // write is not.
  const LEAF_AR_CEILING = 1.2;
  const SINGLE_MAX = 1.25;
  const SPREAD_MIN = 1.75;
  const ratio = (m) => m.ar / ref;
  const isSingleLeaf = (m) => ratio(m) <= SINGLE_MAX && m.ar < LEAF_AR_CEILING;
  const isAmbiguous = (m) =>
    m.ar < LEAF_AR_CEILING && ratio(m) > SINGLE_MAX && ratio(m) < SPREAD_MIN;
  const isHalved = (m) => m.shown && m.shown.w < m.src.w * 0.75;

  const croppedMeasured = measured.filter((m) => hasCrop(m.page));
  const broken = croppedMeasured
    .filter((m) => isSingleLeaf(m) && isHalved(m))
    .map((m) => ({ page: m.page, src: m.src, rendered: m.shown }))
    .sort((a, b) => a.page.page_number - b.page.page_number);
  const metadataOnly = croppedMeasured.filter((m) => isSingleLeaf(m) && !isHalved(m)).length;
  const ambiguous = croppedMeasured.filter((m) => isAmbiguous(m) && isHalved(m)).length;

  return { book, broken, checked: cropBearing.length, ref, how, metadataOnly, ambiguous };
}

/**
 * Clearing `crop` + `cropped_photo` makes getPageSource() fall through to the
 * full `archived_photo`, and resolveSized() to the full `display_photo`.
 * `thumbnail` is repointed because the splitter aimed it at the half.
 */
function repairUpdate(page) {
  const set = {};
  if (page.thumbnail && page.thumbnail === page.cropped_photo) {
    const replacement = page.display_photo || page.image_thumb;
    if (replacement) set.thumbnail = replacement;
  }
  return {
    $unset: { crop: '', cropped_photo: '' },
    ...(Object.keys(set).length ? { $set: set } : {}),
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  if (REVERT) {
    const backup = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
    let restored = 0;
    for (const row of backup.pages) {
      const $set = {};
      if (row.before.crop !== undefined) $set.crop = row.before.crop;
      if (row.before.cropped_photo !== undefined) $set.cropped_photo = row.before.cropped_photo;
      if (row.before.thumbnail !== undefined) $set.thumbnail = row.before.thumbnail;
      const res = await db.collection('pages').updateOne({ _id: row._id }, { $set });
      restored += res.modifiedCount;
    }
    console.log(`Reverted ${restored}/${backup.pages.length} pages from ${REVERT}`);
    await client.close();
    return;
  }

  let books = [];
  if (BOOK) {
    const b = await db.collection('books').findOne({ $or: [{ slug: BOOK }, { id: BOOK }] });
    if (!b) {
      console.error(`Book not found: ${BOOK}`);
      process.exit(1);
    }
    books = [b];
  } else if (ALL_BPH) {
    books = await db
      .collection('books')
      .find({ held_by: 'bph', visible: true })
      .project({ id: 1, slug: 1, title: 1 })
      .toArray();
    if (LIMIT) books = books.slice(0, LIMIT);
  } else {
    console.error('Pass --book <slug|id> or --all-bph');
    process.exit(1);
  }

  console.log(`Scanning ${books.length} book(s)${APPLY ? '' : '  [DRY RUN]'}\n`);

  const allBroken = [];
  let done = 0;
  let pagesChecked = 0;
  const started = Date.now();
  const report = REPORT ? fs.createWriteStream(REPORT, { flags: 'a' }) : null;

  const undetermined = [];

  await mapLimit(books, BOOK_CONCURRENCY, async (book) => {
    const { broken, checked, undetermined: why, ref, how, metadataOnly, ambiguous } = await scanBook(db, book);
    done++;
    pagesChecked += checked;

    if (books.length > 1 && done % 50 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((books.length - done) / rate / 60);
      console.log(
        `  … ${done}/${books.length} books, ${pagesChecked} pages checked, ` +
          `${allBroken.reduce((n, b) => n + b.broken.length, 0)} broken so far, ETA ~${eta}m`,
      );
    }
    if (checked === 0) return;

    report?.write(
      JSON.stringify({
        slug: book.slug,
        id: book.id,
        checked,
        broken: broken.length,
        metadataOnly: metadataOnly ?? null,
        ambiguous: ambiguous ?? null,
        ref: ref ?? null,
        undetermined: why ?? null,
      }) + '\n',
    );

    if (why) {
      undetermined.push({ book, why });
      if (books.length === 1) console.log(`${book.slug}: UNDETERMINED — ${why}; abstaining.`);
      return;
    }

    if (broken.length === 0) {
      if (books.length === 1) {
        console.log(
          `${book.slug}: ${checked} crop-bearing pages checked against leaf AR ${ref.toFixed(3)} (${how}); ` +
            `none visibly broken${metadataOnly ? `, ${metadataOnly} with a spurious crop that still renders full` : ''}.`,
        );
      }
      return;
    }
    console.log(`\n=== ${book.slug} (${book.id})`);
    console.log(`    leaf AR ${ref.toFixed(3)} (${how}); ${checked} crop-bearing pages checked`);
    console.log(`    ${broken.length} VISIBLY broken (single leaf rendered as a half):`);
    for (const r of broken) {
      console.log(
        `      p${r.page.page_number}: single leaf ${r.src.w}x${r.src.h} rendered as ${r.rendered.w}x${r.rendered.h}` +
          `  crop=${JSON.stringify(r.page.crop)}`,
      );
    }
    if (metadataOnly) console.log(`    (+${metadataOnly} spurious crops that still render full — not repaired here)`);
    if (ambiguous) console.log(`    (+${ambiguous} ambiguous, source between 1x and 2x the leaf ratio — abstained)`);
    allBroken.push({ book, broken });
  });

  report?.end();
  allBroken.sort((a, b) => (a.book.slug || '').localeCompare(b.book.slug || ''));

  const total = allBroken.reduce((n, b) => n + b.broken.length, 0);
  console.log(`\nTotal visibly broken pages: ${total} across ${allBroken.length} book(s)`);
  if (undetermined.length) {
    console.log(
      `Undetermined (abstained, NOT counted as clean): ${undetermined.length} book(s) — no reliable single-leaf reference.`,
    );
  }

  if (!APPLY || total === 0) {
    if (total > 0) console.log('Re-run with --apply to repair.');
    await client.close();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const backupPath = path.join(outDir, `false-split-repair-${stamp}.json`);

  const backup = { created_at: new Date().toISOString(), pages: [] };
  for (const { book, broken } of allBroken) {
    for (const r of broken) {
      backup.pages.push({
        _id: r.page._id,
        book_id: book.id,
        book_slug: book.slug,
        page_number: r.page.page_number,
        before: {
          crop: r.page.crop,
          cropped_photo: r.page.cropped_photo,
          thumbnail: r.page.thumbnail,
        },
      });
    }
  }
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backup written: ${backupPath}`);

  let modified = 0;
  for (const { broken } of allBroken) {
    for (const r of broken) {
      const res = await db.collection('pages').updateOne({ _id: r.page._id }, repairUpdate(r.page));
      modified += res.modifiedCount;
    }
  }
  console.log(`Repaired ${modified}/${total} pages.`);
  if (modified !== total) console.log('WARNING: modifiedCount did not match the number of targeted pages.');

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
