#!/usr/bin/env node
/**
 * Second half of the false-split repair (#3562).
 *
 * `fix-false-split-portrait-pages.mjs` clears `crop` and `cropped_photo`, which
 * makes `resolveSized()` in src/lib/page-image-url.ts fall through to the
 * pre-sized R2 variant `display_photo`. That is correct ONLY when the variant
 * is a resize of the full leaf.
 *
 * For part of the corpus it is not: the splitter also wrote the cropped HALF to
 * the canonical `pages/{book}/{NNNN}.jpg` slot. Those pages then still render a
 * half after the crop fields are cleared — the repair looks applied and changes
 * nothing a reader sees. Found by spot-checking repaired pages by eye; four of
 * eight sampled were still halves.
 *
 * The tell is dimensional, and worth knowing: a genuine display variant is
 * bounded at 1200px wide. These are the half at NATIVE height (858x3039 against
 * a 1734x3039 source), because they were written as a crop rather than a resize.
 * The robust test is still aspect ratio — a variant whose aspect is ~half the
 * source's is a half of it.
 *
 * Fix: unset the offending `display_photo` / `image_thumb` / `thumbnail`. With
 * no pre-sized variant left, `resolveSized()` proxies from `archived_photo`
 * (the intact full leaf) through /api/image, which is correct and cached.
 *
 * Usage:
 *   node scripts/maintenance/fix-half-display-variants.mjs --backup <repair.json>
 *   node scripts/maintenance/fix-half-display-variants.mjs --backup <f.json> --apply
 *   node scripts/maintenance/fix-half-display-variants.mjs --revert <backup.json>
 *
 * Dry-run by default; writes its own backup and supports --revert.
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a');
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const APPLY = args.includes('--apply');
const BACKUP_IN = arg('--backup');
const REVERT = arg('--revert');
const CONCURRENCY = Number(arg('--concurrency') || 12);

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

async function dims(url) {
  if (!url) return null;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
      if (!r.ok && r.status !== 206) return null;
      return jpegSize(Buffer.from(await r.arrayBuffer()));
    } catch {
      /* retry once */
    }
  }
  return null;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** True when `variant` is about half the source's aspect ratio, i.e. a half of it. */
function isHalfOf(srcDims, variantDims) {
  if (!srcDims || !variantDims) return false;
  const sa = srcDims.w / srcDims.h;
  const va = variantDims.w / variantDims.h;
  return Math.abs(va - sa / 2) < Math.abs(va - sa);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  if (REVERT) {
    const b = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
    let n = 0;
    for (const row of b.pages) {
      const $set = {};
      for (const f of ['display_photo', 'image_thumb', 'thumbnail']) {
        if (row.before[f] !== undefined) $set[f] = row.before[f];
      }
      if (Object.keys($set).length) {
        n += (await db.collection('pages').updateOne({ _id: new ObjectId(row._id) }, { $set })).modifiedCount;
      }
    }
    console.log(`Reverted ${n}/${b.pages.length} pages`);
    await client.close();
    return;
  }

  if (!BACKUP_IN) {
    console.error('Pass --backup <false-split-repair-*.json>');
    process.exit(1);
  }

  const src = JSON.parse(fs.readFileSync(BACKUP_IN, 'utf8'));
  // NOTE: the repair backup serialises _id as a hex string; Mongo stores an
  // ObjectId. Querying with the raw string matches NOTHING and returns a
  // clean-looking zero. Cast every time.
  const ids = src.pages.map((p) => new ObjectId(p._id));
  const pages = await db
    .collection('pages')
    .find({ _id: { $in: ids } })
    .project({ page_number: 1, book_id: 1, archived_photo: 1, photo_original: 1, display_photo: 1, image_thumb: 1, thumbnail: 1 })
    .toArray();

  if (pages.length !== ids.length) {
    console.log(`WARNING: backup lists ${ids.length} pages but only ${pages.length} matched.`);
  }
  console.log(`Checking ${pages.length} repaired pages${APPLY ? '' : '  [DRY RUN]'}\n`);

  const results = await mapLimit(pages, CONCURRENCY, async (p) => {
    const source = p.archived_photo || p.photo_original;
    const [s, d, t, th] = await Promise.all([
      dims(source),
      dims(p.display_photo),
      dims(p.image_thumb),
      dims(p.thumbnail),
    ]);
    if (!s) return null;
    const bad = {};
    if (isHalfOf(s, d)) bad.display_photo = p.display_photo;
    if (isHalfOf(s, t)) bad.image_thumb = p.image_thumb;
    if (isHalfOf(s, th)) bad.thumbnail = p.thumbnail;
    return Object.keys(bad).length ? { page: p, bad, src: s, disp: d } : null;
  });

  const affected = results.filter(Boolean).sort((a, b) => a.page.page_number - b.page.page_number);
  console.log(`Pages whose pre-sized variant is ALSO a half: ${affected.length} of ${pages.length}`);
  const byBook = {};
  for (const a of affected) (byBook[a.page.book_id] ||= []).push(a);
  console.log(`Across ${Object.keys(byBook).length} books.\n`);
  for (const a of affected.slice(0, 12)) {
    console.log(
      `  p${a.page.page_number}: source ${a.src.w}x${a.src.h} but display ${a.disp?.w}x${a.disp?.h} — ` +
        `clearing ${Object.keys(a.bad).join(', ')}`,
    );
  }
  if (affected.length > 12) console.log(`  … and ${affected.length - 12} more`);

  if (!APPLY || affected.length === 0) {
    if (affected.length) console.log('\nRe-run with --apply to clear them.');
    await client.close();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const backupPath = path.join(outDir, `half-display-variants-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        source_backup: BACKUP_IN,
        pages: affected.map((a) => ({
          _id: a.page._id,
          book_id: a.page.book_id,
          page_number: a.page.page_number,
          before: {
            display_photo: a.page.display_photo,
            image_thumb: a.page.image_thumb,
            thumbnail: a.page.thumbnail,
          },
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nBackup written: ${backupPath}`);

  let modified = 0;
  for (const a of affected) {
    const $unset = {};
    for (const f of Object.keys(a.bad)) $unset[f] = '';
    modified += (await db.collection('pages').updateOne({ _id: a.page._id }, { $unset })).modifiedCount;
  }
  console.log(`Cleared half variants on ${modified}/${affected.length} pages.`);
  if (modified !== affected.length) console.log('WARNING: modifiedCount did not match the target count.');

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
