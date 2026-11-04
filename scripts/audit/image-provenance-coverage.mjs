#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-integrity-draw.mjs (monthly page draw, judged by a model, not by
 * the keyed detector) and scripts/audit/archive-coverage.mjs (RECORD/FILE/MASTER tiers: says
 * whether an object exists, never whether it is marked). Neither reads the watermark. #4406's
 * old counters are the bake's own log, which is why "done" was claimed three times.
 *
 * image-provenance-coverage — is the page image a reader is served provably ours? (#4406, #2651)
 *
 * Reads the object `display_photo` names, straight from R2, and runs the keyed detector on its
 * bytes. Tags are not evidence: most marked files have none. Counters are not evidence: the bake
 * reported 6.3M pages over a denominator that has since grown from 16K to 71K books.
 *
 * THREE FRAMES, because they answer different questions and must never be summed:
 *   books   one random page per visible book   (book-weighted; a small book counts as much as a large one)
 *   pages   random visible pages               (page-weighted; what a random reader's page looks like)
 *   recent  objects written in the window, by anything except the backfill (is the leak closed?)
 *
 * DENOMINATOR. Pages whose display_photo is an object on R2. Pages with no R2 display are reported
 * beside it (`noR2Display`): they are served through /api/image or from the source, not from a
 * variant we could mark. A page with under 16 textured block pairs (blank paper) cannot carry the
 * watermark by design and is reported as `uncarryable`, outside the denominator. It is measured,
 * not assumed: the detector returns the pair count.
 *
 * ERA. Each sampled object is attributed from its own bytes and pointers, so a low number names a
 * writer rather than just a percentage.
 *
 * CONTROLS, every run, before any number is trusted:
 *   positive   a known marked object on R2 must detect
 *   synthetic  markImage() on an unmarked master, in memory, must detect (key + code path)
 *   negative   an /archived/ master must NOT detect; the positive must NOT detect under a wrong key
 *
 * ROBUSTNESS. Copies are not byte-identical, so the point of the mark is what survives. Marked pages
 * from the page-weighted draw are re-encoded, resized and cropped at the sizes copiers use, and
 * detected again. This row says what a copy found in the wild can and cannot prove, and it never
 * moves the exit code. Resizes are read twice: as found, and with the copy scaled back up to its
 * own original width, which needs the width of the file we served (known here, a guess in the wild).
 *
 * EXIT. 0 pass, 1 recent writes below --min (a finding), 2 could not measure or a control failed.
 * Exit 2 is never a finding about the corpus (measurement-instruments.md: a detector that cannot
 * run goes red, it does not report).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/image-provenance-coverage.mjs
 *   ... --books=400 --pages=400 --recent=200 --recent-days=7 --not-before=2026-11-05T00:00:00Z
 *   ... --ntfy                 page when recent writes fall below --min or a control fails
 *   ... --close-issue=4406     close the issue when books AND pages are both at or above --min
 *   ... --json=/path/out.json
 *   ... --robustness=30        marked pages put through the copier row (0 turns it off)
 */
import { writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { detectWatermark, markImage } from '../lib/provenance-mark.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const has = (n) => process.argv.includes(`--${n}`);

const N_BOOKS = Number(arg('books', 400));
const N_PAGES = Number(arg('pages', 400));
const N_RECENT = Number(arg('recent', 200));
const RECENT_DAYS = Number(arg('recent-days', 7));
// --not-before keeps a weekly window from reaching back past a fix and paging about what it fixed.
const SINCE = new Date(Math.max(Date.now() - RECENT_DAYS * 864e5, Date.parse(arg('not-before', '1970-01-01'))));
const MIN = Number(arg('min', 0.9));
const N_ROBUST = Number(arg('robustness', 30));
const CONCURRENCY = Number(arg('concurrency', 8));
const NTFY = has('ntfy');
const CLOSE_ISSUE = arg('close-issue', null);
const JSON_OUT = arg('json', null);
const NTFY_TOPIC = process.env.PROVENANCE_AUDIT_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';

/** A sl-v5 object baked 2026-08 and measured by hand on #4406. The backfill never rewrites it. */
const POSITIVE = { bookId: '695aa97dbe4023bd34bd6715', key: 'pages/695aa97dbe4023bd34bd6715/0015.jpg' };
const WRONG_KEY = 'image-provenance-negative-control';

const KEY = process.env.PROVENANCE_SECRET_KEY;
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_BASE = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

function cannotRun(why) {
  console.error(`[image-provenance-coverage] CANNOT MEASURE: ${why}`);
  return page('Provenance audit cannot measure', why).finally(() => process.exit(2));
}
async function page(title, body) {
  if (!NTFY) return;
  try { await ntfyPost(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Tags: 'warning', Priority: 'high' }, body }); }
  catch (e) { console.error(`[image-provenance-coverage] ntfy failed: ${e.message}`); }
}

const r2 = new S3Client({
  region: 'auto', maxAttempts: 5,
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || '').trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
});

const keyOf = (url) => (typeof url === 'string' && url.startsWith(`${R2_BASE}/`) ? url.slice(R2_BASE.length + 1).split('?')[0] : null);

async function readObject(key) {
  const o = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const c of o.Body) chunks.push(c);
  return { buf: Buffer.concat(chunks), lastModified: o.LastModified, metadata: o.Metadata || {} };
}

/** Attribute an object to the writer that made it, from its own bytes and the page's pointers. */
function eraOf({ page, key, metadata, exif }) {
  if (metadata.provenance_writer) return `backfill (${metadata.provenance_writer})`;
  if (metadata.provenance) return `bake (${metadata.provenance})`;
  if (exif.includes('[edition ')) return 'markImage, forward path (EXIF, no tag)';
  if (exif.includes('Steganographia')) return 'legacy cosmetic marks (pre-#4409 1-in-10)';
  if (keyOf(page.archived_photo) === key) return 'master at the display key (archive lane + display-backfill)';
  if (keyOf(page.photo) === key || page.split_from_spread || page.cropped_photo) return 'split or crop written as display';
  return 'plain unmarked variant';
}

async function measurePage(page) {
  const key = keyOf(page.display_photo);
  if (!key || !key.startsWith('pages/')) return { status: 'noR2Display' };
  let o;
  try { o = await readObject(key); }
  catch (e) { return { status: e?.$metadata?.httpStatusCode === 404 ? 'objectMissing' : 'readError', key }; }
  let meta, det;
  try {
    meta = await sharp(o.buf, { failOn: 'none' }).metadata();
    det = await detectWatermark(o.buf, { editionId: page.book_id, key: KEY });
  } catch { return { status: 'undecodable', key }; }
  const exif = meta.exif ? meta.exif.toString('latin1') : '';
  const era = eraOf({ page, key, metadata: o.metadata, exif });
  const month = o.lastModified ? o.lastModified.toISOString().slice(0, 7) : '?';
  const base = { key, book_id: page.book_id, era, month, width: meta.width, bytes: o.buf.length, z: det.z, pairs: det.pairs, lastModified: o.lastModified };
  if ((det.pairs ?? 0) < 16 && !det.present) return { ...base, status: 'uncarryable' };
  return { ...base, status: det.present ? 'marked' : 'unmarked' };
}

async function pool(items, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const it = items[i++]; const r = await fn(it); if (r) out.push(r); }
  }));
  return out;
}

function summarise(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const marked = count('marked'), unmarked = count('unmarked');
  const n = marked + unmarked;
  const eras = {};
  for (const r of rows) {
    if (!r.era || r.status === 'uncarryable') continue;
    const e = (eras[r.era] ||= { marked: 0, unmarked: 0, months: {} });
    e[r.status === 'marked' ? 'marked' : 'unmarked']++;
    e.months[r.month] = (e.months[r.month] || 0) + 1;
  }
  return {
    sampled: rows.length, n, marked, unmarked, rate: n ? marked / n : null,
    uncarryable: count('uncarryable'), noR2Display: count('noR2Display'), objectMissing: count('objectMissing'),
    readError: count('readError'), undecodable: count('undecodable'), eras,
    // A number names a writer; these name objects, so the next person can open one.
    unmarkedExamples: rows.filter((r) => r.status === 'unmarked').slice(0, 25).map(({ key, era, width, bytes, z, pairs, month }) => ({ key, era, width, bytes, z, pairs, month })),
  };
}

const PAGE_PROJECTION = { book_id: 1, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1 };

async function randomPage(pages, b) {
  const n = 1 + Math.floor(Math.random() * Math.max(1, b.pages_count));
  return (await pages.findOne({ book_id: b.id, page_number: n }, { projection: PAGE_PROJECTION }))
    || (await pages.find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: PAGE_PROJECTION }).limit(1).next());
}

async function controls() {
  const out = { pass: false };
  try {
    const pos = await readObject(POSITIVE.key);
    const right = await detectWatermark(pos.buf, { editionId: POSITIVE.bookId, key: KEY });
    const wrong = await detectWatermark(pos.buf, { editionId: POSITIVE.bookId, key: WRONG_KEY });
    const master = await readObject(`archived/${POSITIVE.bookId}/15.jpg`);
    const small = await sharp(master.buf, { failOn: 'none' }).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const neg = await detectWatermark(small, { editionId: POSITIVE.bookId, key: KEY });
    const synth = await detectWatermark(await markImage(small, { editionId: POSITIVE.bookId, pageNumber: 15, key: KEY }), { editionId: POSITIVE.bookId, key: KEY });
    Object.assign(out, { positive_z: right.z, wrong_key_z: wrong.z, negative_z: neg.z, synthetic_z: synth.z });
    out.pass = right.present && !wrong.present && !neg.present && synth.present;
  } catch (e) { out.error = e.message; }
  return out;
}

/** What copiers do: social re-encodes, thumbnails, screenshots of part of a page. Key names are stable; #8150 slice 9 reads them. */
const COPIES = [
  { name: 'jpeg q85', f: (i) => i.jpeg({ quality: 85 }) },
  { name: 'jpeg q70', f: (i) => i.jpeg({ quality: 70 }) },
  { name: 'jpeg q50', f: (i) => i.jpeg({ quality: 50 }) },
  { name: 'webp q75', f: (i) => i.webp({ quality: 75 }) },
  { name: 'resize 1080w', w: 1080 },
  { name: 'resize 800w', w: 800 },
  { name: 'resize 600w', w: 600 },
  { name: 'resize 400w', w: 400 },
  { name: 'resize 800w + q70', w: 800, q: 70 },
  { name: 'crop 90% centre', crop: 0.9 },
  { name: 'crop 50% centre', crop: 0.5 },
];

async function copyOf(buf, c, m) {
  let img = sharp(buf, { failOn: 'none' });
  if (c.f) return c.f(img).toBuffer();
  if (c.crop) {
    const width = Math.round(m.width * c.crop), height = Math.round(m.height * c.crop);
    return img.extract({ left: Math.round((m.width - width) / 2), top: Math.round((m.height - height) / 2), width, height }).jpeg({ quality: 85 }).toBuffer();
  }
  return img.resize({ width: c.w }).jpeg({ quality: c.q || 85 }).toBuffer();
}

async function robustness(rows) {
  const draw = rows.filter((r) => r.status === 'marked').sort(() => Math.random() - 0.5).slice(0, N_ROBUST);
  const out = Object.fromEntries(COPIES.map((c) => [c.name, { detected: 0, rescaled: c.w ? 0 : null, n: 0, zs: [] }]));
  await pool(draw, async (r) => {
    let o;
    try { o = await readObject(r.key); } catch { return null; }
    const m = await sharp(o.buf, { failOn: 'none' }).metadata();
    for (const c of COPIES) {
      const copy = await copyOf(o.buf, c, m);
      const d = await detectWatermark(copy, { editionId: r.book_id, key: KEY });
      const row = out[c.name];
      row.n++; row.zs.push(d.z);
      if (d.present) row.detected++;
      if (c.w) {
        const back = await sharp(copy, { failOn: 'none' }).resize({ width: m.width }).jpeg({ quality: 95 }).toBuffer();
        if ((await detectWatermark(back, { editionId: r.book_id, key: KEY })).present) row.rescaled++;
      }
    }
    return null;
  });
  for (const row of Object.values(out)) {
    row.zs.sort((a, b) => a - b);
    row.median_z = row.zs.length ? row.zs[row.zs.length >> 1] : null;
    delete row.zs;
  }
  return { pages: draw.length, copies: out };
}

async function main() {
  if (!KEY) return cannotRun('PROVENANCE_SECRET_KEY is not set');
  if (!process.env.MONGODB_URI) return cannotRun('MONGODB_URI is not set');
  if (!process.env.R2_ACCESS_KEY_ID) return cannotRun('R2 credentials are not set');

  const ctl = await controls();
  console.log(`controls: ${JSON.stringify(ctl)}`);
  if (!ctl.pass) return cannotRun(`control failed: ${JSON.stringify(ctl)}`);

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books'), pages = db.collection('pages');

  const live = await books.find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).toArray();
  if (live.length === 0) { await client.close(); return cannotRun('no visible books returned'); }
  const totalPages = live.reduce((s, b) => s + b.pages_count, 0);

  // books: uniform over books.
  const byBook = Array.from({ length: Math.min(N_BOOKS, live.length) }, () => live[Math.floor(Math.random() * live.length)]);
  // pages: books drawn in proportion to pages_count, then a uniform page.
  const cum = [];
  live.reduce((s, b, i) => (cum[i] = s + b.pages_count), 0);
  const weighted = () => {
    const t = Math.random() * totalPages;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > t) hi = m; else lo = m + 1; }
    return live[lo];
  };
  const byPage = Array.from({ length: N_PAGES }, weighted);

  const rowsBooks = (await pool(byBook, async (b) => { const p = await randomPage(pages, b); return p ? measurePage(p) : null; }));
  const rowsPages = (await pool(byPage, async (b) => { const p = await randomPage(pages, b); return p ? measurePage(p) : null; }));

  // recent: books touched in the window, any visibility (imports arrive hidden), then only objects
  // whose own LastModified is inside it and that the backfill did not write. Otherwise a running
  // backfill would answer "is the leak closed?" with its own output.
  const sinceIso = SINCE.toISOString();
  const recentBooks = await books.find({
    pages_count: { $gt: 0 },
    $or: [
      { created_at: { $gte: SINCE } }, { created_at: { $gte: sinceIso, $type: 'string' } },
      { 'archive_metadata.last_attempt_at': { $gte: SINCE } },
      { 'archive_metadata.last_attempt_at': { $gte: sinceIso, $type: 'string' } },
    ],
  }, { projection: { _id: 0, id: 1, pages_count: 1 } }).limit(20000).toArray();
  const rowsRecent = [];
  for (let attempts = 0; attempts < 6 && rowsRecent.length < N_RECENT && recentBooks.length; attempts++) {
    const draw = Array.from({ length: Math.min(N_RECENT, 200) }, () => recentBooks[Math.floor(Math.random() * recentBooks.length)]);
    const got = await pool(draw, async (b) => { const p = await randomPage(pages, b); return p ? measurePage(p) : null; });
    rowsRecent.push(...got.filter((r) => r.lastModified && r.lastModified >= SINCE && !r.era?.startsWith('backfill')));
  }

  await client.close();

  const robust = N_ROBUST > 0 ? await robustness(rowsPages) : null;

  const report = {
    at: new Date().toISOString(), controls: ctl, min: MIN, since: sinceIso,
    corpus: { visibleBooks: live.length, visiblePagesCounted: totalPages, recentBooks: recentBooks.length },
    books: summarise(rowsBooks), pages: summarise(rowsPages), recent: summarise(rowsRecent), robustness: robust,
  };
  const pct = (s) => (s.rate == null ? 'n/a' : `${(100 * s.rate).toFixed(1)}%`);
  for (const f of ['books', 'pages', 'recent']) {
    const s = report[f];
    console.log(`\n${f}: ${pct(s)} detected (${s.marked}/${s.n})  uncarryable=${s.uncarryable} noR2Display=${s.noR2Display} missing=${s.objectMissing} readErr=${s.readError} undecodable=${s.undecodable}`);
    for (const [era, e] of Object.entries(s.eras).sort((a, b) => (b[1].marked + b[1].unmarked) - (a[1].marked + a[1].unmarked))) {
      const months = Object.entries(e.months).sort().map(([m, c]) => `${m}:${c}`).join(' ');
      console.log(`  ${String(e.marked).padStart(4)} marked ${String(e.unmarked).padStart(4)} unmarked  ${era}  [${months}]`);
    }
  }
  if (robust) {
    console.log(`\nrobustness: marked pages put through what copiers do (n=${robust.pages})`);
    for (const [name, r] of Object.entries(robust.copies)) {
      console.log(`  ${name.padEnd(20)} ${String(r.detected).padStart(3)}/${r.n} detected  median z ${r.median_z}${r.rescaled == null ? '' : `  scaled back: ${r.rescaled}/${r.n}`}`);
    }
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  console.log(`\nRESULT ${JSON.stringify({ at: report.at, books: report.books.rate, pages: report.pages.rate, recent: report.recent.rate, recent_n: report.recent.n })}`);

  // A rate over too few objects is a guess; below 30 the recent frame reports but cannot page.
  const recentLow = report.recent.n >= 30 && report.recent.rate < MIN;
  if (recentLow) {
    const worst = Object.entries(report.recent.eras).sort((a, b) => b[1].unmarked - a[1].unmarked)[0];
    await page('Page images written unmarked', `Only ${pct(report.recent)} of ${report.recent.n} page images written since ${sinceIso.slice(0, 10)} carry the mark (floor ${MIN * 100}%). Largest unmarked group: ${worst?.[0]}. #4406`);
  }
  if (CLOSE_ISSUE && report.books.rate >= MIN && report.pages.rate >= MIN && !recentLow) {
    const body = `image-provenance-coverage: ${pct(report.books)} by book (n=${report.books.n}), ${pct(report.pages)} by page (n=${report.pages.n}), ${pct(report.recent)} of recent writes (n=${report.recent.n}), controls passed (positive z=${ctl.positive_z}, negative z=${ctl.negative_z}). At or above ${MIN * 100}% over the whole corpus, so this closes. Measured ${report.at}.`;
    try {
      const state = execFileSync('gh', ['issue', 'view', CLOSE_ISSUE, '--json', 'state', '--jq', '.state'], { encoding: 'utf8' }).trim();
      if (state === 'OPEN') execFileSync('gh', ['issue', 'close', CLOSE_ISSUE, '--comment', body], { stdio: 'inherit' });
    } catch (e) { console.error(`[image-provenance-coverage] could not close #${CLOSE_ISSUE}: ${e.message}`); }
  }
  process.exit(recentLow ? 1 : 0);
}

main().catch((e) => cannotRun(e.message));
