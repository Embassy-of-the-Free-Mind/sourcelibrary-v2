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
 * The discriminator is the SOURCE image's own aspect ratio, read from the
 * bytes on R2 — not any stored flag:
 *   - landscape source (w > h)  -> a real spread; the split is correct.
 *   - portrait source  (w <= h) -> a single leaf; any half-width crop is wrong.
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

/**
 * Classify one page. `broken` means: the source leaf is portrait (a single
 * page) yet the image the reader materializes is substantially narrower.
 */
async function classifyPage(page) {
  const source = page.archived_photo || page.photo_original;
  const [src, shown] = await Promise.all([dims(source), dims(page.cropped_photo)]);
  if (!src) return { page, verdict: 'unreadable-source', source };

  const isSpread = src.w > src.h;
  const rendered = shown || src;
  // A half is ~50% of the source; 0.75 leaves room for gutter overlap and for
  // the near-full-width legacy `cropped/<pageid>.jpg` files, which are fine.
  const isHalved = rendered.w < src.w * 0.75;

  if (isSpread) return { page, verdict: 'spread-ok', src, rendered };
  if (!isHalved) return { page, verdict: 'ok', src, rendered };
  return { page, verdict: 'broken', src, rendered, source };
}

async function scanBook(db, book) {
  const pages = (
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
    .filter((p) => p.page_number > 0)
    // Only pages carrying a crop can be falsely split.
    .filter((p) => p.crop?.xStart !== undefined || p.cropped_photo);

  if (pages.length === 0) return { book, broken: [], checked: 0 };

  const results = await mapLimit(pages, PAGE_CONCURRENCY, classifyPage);
  const broken = results.filter((r) => r.verdict === 'broken').sort((a, b) => a.page.page_number - b.page.page_number);
  const unreadable = results.filter((r) => r.verdict === 'unreadable-source');
  return { book, broken, unreadable, checked: pages.length };
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

  await mapLimit(books, BOOK_CONCURRENCY, async (book) => {
    const { broken, unreadable, checked } = await scanBook(db, book);
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

    report?.write(JSON.stringify({ slug: book.slug, id: book.id, checked, broken: broken.length }) + '\n');

    if (broken.length === 0) {
      if (books.length === 1) console.log(`${book.slug}: ${checked} crop-bearing pages checked, none falsely split.`);
      return;
    }
    console.log(`\n=== ${book.slug} (${book.id})`);
    console.log(`    ${checked} crop-bearing pages checked, ${broken.length} falsely split:`);
    for (const r of broken) {
      console.log(
        `      p${r.page.page_number}: single leaf ${r.src.w}x${r.src.h} rendered as ${r.rendered.w}x${r.rendered.h}` +
          `  crop=${JSON.stringify(r.page.crop)}`,
      );
    }
    if (unreadable?.length) console.log(`    (${unreadable.length} pages whose source could not be read — skipped)`);
    allBroken.push({ book, broken });
  });

  report?.end();
  allBroken.sort((a, b) => (a.book.slug || '').localeCompare(b.book.slug || ''));

  const total = allBroken.reduce((n, b) => n + b.broken.length, 0);
  console.log(`\nTotal falsely split pages: ${total} across ${allBroken.length} book(s)`);

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
