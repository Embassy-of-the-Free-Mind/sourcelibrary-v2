#!/usr/bin/env node
// PRIOR ART: scripts/audit/page-integrity.mjs (walks a local mirror this box does not have; its duplicate check is
// N vs N+1/N+2 only); scripts/audit/ia-model-ocr-off-leaf.mjs (IA books only, text against the Archive's own OCR —
// abstains where that OCR is junk); scripts/audit/bulk-archive-alignment.mjs (dHash at offsets 0/+1 on sampled pages of
// bulk_jp2 books only); scripts/eval/jev/clef-book-offset-map.mjs (#5803, a model per page). The signals are in
// scripts/lib/leaf-alignment.mjs; the image arbiter reuses scripts/lib/page-alignment.mjs hashBuffer/hammingHex.
/**
 * leaf-alignment-screen — judge-free screen for page text that sits on the wrong leaf (#7866). READ-ONLY: writes files
 * under --out, never Mongo. Bulk reads go to Mongo directly (secondary preferred), never through the API.
 *
 *   scan        node --env-file=.env.production.local scripts/audit/leaf-alignment-screen.mjs scan --out=DIR
 *                 [--shard=k/n] [--books=id,id | --books-file=f] [--concurrency=6] [--max-minutes=M]
 *               → DIR/scan-<k>.jsonl, one row per book (bookSignals + title, language, pages). Resumable: a book
 *                 already in the shard file is skipped. Frame: visible, pages_count > 0, pages_ocr > 0 (47,435 on
 *                 2026-11-01). Reads per page: page_number, the first 1,200 characters of ocr.data and its length,
 *                 page_type, archive_metadata.{bytes,source}, image_width/height. Hidden pages, repeat captures
 *                 (repeat_of) and split parents are left out.
 *   arbitrate   … arbitrate --out=DIR --select=blank,repeat|offset|bulk [--quick] [--sample=N --seed=S]
 *                 [--name=X] [--concurrency=6] [--books=id,…]  → DIR/arbitrate[-X].jsonl, one row per book: the image
 *                 checks (see arbitrateBook). blank/repeat read our own R2 images only (fast); offset/bulk also read
 *                 the provider's source image (the Archive at ~2 s an image: sample, do not census). Resumable.
 *   rank        … rank --out=DIR  → DIR/ranked.json + ranked.md: every book confirmed() by the arbiter, image
 *                 shifts first, then text on blank leaves, then one text on two leaves.
 * Validation and the 2026-11-01 corpus run: scripts/eval/experiments/2026-11-01-leaf-alignment-screen-7866.md.
 * An image shift is a READER-VISIBLE defect only where the text was read from the source leaf (OCR before the
 * archive); elsewhere text and image agree on screen and only the record's source pointer is off.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { proseOf, bookSignals, confirmed, imageOff, REPEAT_CONFIRM } from '../lib/leaf-alignment.mjs';
import sharp from 'sharp';
import { hashBuffer, hammingHex } from '../lib/page-alignment.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const OUT = arg('out', 'scripts/output/leaf-alignment-screen');
const PREFIX = 1200;
fs.mkdirSync(OUT, { recursive: true });
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const allScanRows = () => fs.readdirSync(OUT).filter((f) => /^scan-.*\.jsonl$/.test(f)).flatMap((f) => readJsonl(path.join(OUT, f)));

/** A book's rows for lib/leaf-alignment, from Mongo. */
export async function loadRows(db, bookId, { jp2Repaired = false } = {}) {
  const docs = await db.collection('pages').aggregate([
    { $match: { book_id: bookId, page_number: { $gt: 0 }, hidden: { $ne: true }, repeat_of: { $exists: false } } },
    { $project: { _id: 0, p: '$page_number', t: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, PREFIX] }, L: { $strLenCP: { $ifNull: ['$ocr.data', ''] } },
      type: '$page_type', bytes: '$archive_metadata.bytes', src: '$archive_metadata.source', w: '$image_width', h: '$image_height', split: { $gt: [{ $size: { $ifNull: ['$split_into', []] } }, 0] } } },
    { $sort: { p: 1 } },
  ], { allowDiskUse: false, maxTimeMS: 120000 }).toArray();
  return docs.filter((d) => !d.split).map((d) => {
    const { prose, tag, blank } = proseOf(d.t);
    // Tags sit at the head of an OCR text, so the prose length of the whole text ≈ its length minus the prefix's tags.
    const bodyLen = blank ? 0 : Math.max(prose.length, d.L - (Math.min(d.L, PREFIX) - prose.length));
    const illus = /<image-desc\b|\[Image:/i.test(d.t) || /plate|illustration|image|map|figure|diagram|frontispiece|photograph/i.test(d.type || tag || '');
    // A #3368/#5803 image repair re-archives the bulk_jp2 pages without rewriting archive_metadata.bytes, which then
    // still weighs the shifted image (69e41331… p29: stored 534,384 B = the old leaf 30; archived/29.jpg is 649,075 B).
    const stale = jp2Repaired && d.src === 'bulk_jp2';
    return { p: d.p, prose, bodyLen, blank, illus, type: d.type || tag || null, bytes: stale ? null : d.bytes ?? null, src: d.src ?? null, w: d.w ?? null, h: d.h ?? null };
  });
}

async function scan() {
  const [k, n] = (arg('shard', '0/1')).split('/').map(Number);
  const file = path.join(OUT, `scan-${k}.jsonl`);
  const done = new Set(readJsonl(file).map((r) => r.book));
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || 'bookstore');
  let ids;
  const proj = { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, ia_identifier: 1, 'archive_metadata.jp2_offset_repaired': 1 };
  if (arg('books') || arg('books-file')) {
    const want = (arg('books') ? arg('books').split(',') : fs.readFileSync(arg('books-file'), 'utf8').split(/\s+/)).filter(Boolean);
    ids = await db.collection('books').find({ $or: [{ id: { $in: want } }, { _id: { $in: want } }] }, { projection: proj }).toArray();
  } else {
    ids = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } }, { projection: proj }).toArray();
  }
  const mine = ids.filter((b) => { const id = b.id || String(b._id); let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % n === k && !done.has(id); });
  console.log(`shard ${k}/${n}: ${mine.length} books to scan (${done.size} done)`);
  const t0 = Date.now(), maxMs = Number(arg('max-minutes', 0)) * 60e3;
  let i = 0, ok = 0, err = 0;
  const out = fs.createWriteStream(file, { flags: 'a' });
  await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, async () => {
    while (i < mine.length) {
      if (maxMs && Date.now() - t0 > maxMs) return;
      const b = mine[i++]; const id = b.id || String(b._id);
      try {
        const rows = await loadRows(db, id, { jp2Repaired: b.archive_metadata?.jp2_offset_repaired != null });
        const s = bookSignals(rows);
        out.write(JSON.stringify({ book: id, title: String(b.title || '').slice(0, 90), language: b.language || null, ia: b.ia_identifier || null, pages: rows.length,
          withBytes: rows.filter((r) => r.bytes > 0).length, bulkUnrepaired: b.archive_metadata?.jp2_offset_repaired != null ? 0 : rows.filter((r) => r.src === 'bulk_jp2').length, writers: [...new Set(rows.map((r) => r.src || '?'))], ...s }) + '\n');
        ok++;
      } catch (e) { err++; console.error(`  ${id}: ${String(e.message || e).slice(0, 160)}`); }
      if ((ok + err) % 500 === 0) console.log(`  ${ok + err}/${mine.length} (${err} errors) ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    }
  }));
  await new Promise((r) => out.end(r));
  await c.close();
  console.log(`shard ${k}: ${ok} scanned, ${err} errors, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}

/** The pages a row names, flagged by any signal. */
export function flaggedPages(r) {
  const s = new Set([...r.textOnBlank.map((x) => x.p), ...r.repeatsFar.flatMap((x) => [x.a, x.b]), ...r.blankOnInk.map((x) => x.p)]);
  return [...s].sort((a, b) => a - b);
}
export function signalLine(r) {
  const parts = [];
  if (r.offset?.shifted) parts.push(`offset ${r.offset.best > 0 ? '+' : ''}${r.offset.best} (r ${r.offset.rBest} vs ${r.offset.r0} at 0, n ${r.offset.n})`);
  for (const w of r.shiftedWriters || []) if (!r.offset?.shifted) parts.push(`offset ${w.best > 0 ? '+' : ''}${w.best} on ${w.writer} images (r ${w.rBest} vs ${w.r0}, n ${w.n})`);
  if (r.textOnBlank.length) parts.push(`text on near-blank image ×${r.textOnBlank.length}`);
  if (r.repeatsFar.length) parts.push(`text repeated ×${r.repeatsFar.length} pairs`);
  if (r.blankOnInk.length) parts.push(`blank text on full image ×${r.blankOnInk.length}`);
  return parts.join('; ');
}

/** Every arbitrate*.jsonl under OUT, one merged row per book (a book checked by two cohorts keeps both halves). */
function allArbitrated() {
  const m = new Map();
  for (const f of fs.readdirSync(OUT).filter((x) => /^arbitrate.*\.jsonl$/.test(x))) for (const a of readJsonl(path.join(OUT, f))) {
    const o = m.get(a.book);
    if (!o) { m.set(a.book, a); continue; }
    m.set(a.book, { ...o, offset: o.offset.length ? o.offset : a.offset, imageShift: o.offset.length ? o.imageShift : a.imageShift,
      blank: o.blank.length ? o.blank : a.blank, blankConfirmed: o.blank.length ? o.blankConfirmed : a.blankConfirmed, repeat: o.repeat.length ? o.repeat : a.repeat });
  }
  return m;
}

/**
 * The ranked list: books the image arbiter CONFIRMED (lib confirmed()), most reader-visible first — an image shift
 * (every page of the shifted writer's run), then text on blank leaves, then one text on two leaves. Unconfirmed
 * candidates are counted, not listed.
 */
function rank() {
  const rows = new Map(allScanRows().map((r) => [r.book, r]));
  const arb = allArbitrated();
  const list = [];
  for (const [book, a] of arb) {
    const r = rows.get(book); if (!r) continue;
    const kept = { ...a, blankConfirmed: a.blankConfirmed.filter((p) => r.textOnBlank.some((t) => t.p === p)) };
    const why = confirmed(kept, r); if (!why) continue;
    const shift = imageOff(a).length >= 2;
    const repeatPages = why.filter((w) => w.startsWith('one text')).flatMap((w) => [...w.matchAll(/(\d+)=(\d+)/g)].flatMap((m) => [+m[1], +m[2]]));
    const pages = [...new Set([...(shift ? imageOff(a).map((o) => o.p) : []), ...kept.blankConfirmed, ...repeatPages])].sort((x, y) => x - y);
    const affected = shift ? (r.bulkUnrepaired || r.pages) : pages.length;
    list.push({ book, url: `https://sourcelibrary.org/book/${book}`, title: r.title, language: r.language, pages_in_book: r.pages,
      class: shift ? 'image-shift' : kept.blankConfirmed.length ? 'text-on-blank' : 'repeat', affected, signal: why.join('; '), pages });
  }
  const order = { 'image-shift': 0, 'text-on-blank': 1, repeat: 2 };
  list.sort((x, y) => order[x.class] - order[y.class] || y.affected - x.affected);
  list.forEach((x, i) => { x.rank = i + 1; });
  const byClass = list.reduce((m, x) => ((m[x.class] = (m[x.class] || 0) + 1), m), {});
  fs.writeFileSync(path.join(OUT, 'ranked.json'), JSON.stringify({ scanned: rows.size, arbitrated: arb.size, confirmed: list.length, by_class: byClass, list }, null, 1));
  const md = ['| # | book | lang | class | pages affected | signal | pages |', '|---|---|---|---|---|---|---|',
    ...list.map((x) => `| ${x.rank} | [${String(x.title || '').replace(/[|\[\]]/g, '/').slice(0, 55)}](${x.url}) | ${x.language || '?'} | ${x.class} | ${x.affected} | ${x.signal.replace(/\|/g, '/')} | ${x.pages.slice(0, 10).join(', ')} |`)];
  fs.writeFileSync(path.join(OUT, 'ranked.md'), md.join('\n') + '\n');
  console.log(`${rows.size} scanned, ${arb.size} arbitrated, ${list.length} confirmed ${JSON.stringify(byClass)} → ${OUT}/ranked.md`);
}

/** Share of a page image's pixels darker than the paper (75th-percentile grey) by 15 levels. Measured 2026-11-01: the
 *  blank leaves carrying invented or show-through text read 0.0000 (digitally white); a washed-out contents page that
 *  is NOT blank reads 0.0167 and a textured blank leaf 0.0131 (indistinguishable, so both are left unconfirmed); print
 *  reads 0.09–0.5. A threshold of 50 levels read the washed-out page as blank. */
export async function inkShare(buf) {
  const px = await sharp(buf).greyscale().resize(120, 160, { fit: 'fill' }).raw().toBuffer();
  const sorted = Uint8Array.from(px).sort();
  const paper = sorted[Math.floor(sorted.length * 0.75)];
  let ink = 0; for (const v of px) if (v < paper - 15) ink++;
  return +(ink / px.length).toFixed(4);
}
export const INK_BLANK = 0.005;
/** A 64x80 grey thumbnail, z-normalised, for pixel correlation. */
async function thumb(buf) {
  const px = await sharp(buf).greyscale().resize(64, 80, { fit: 'fill' }).raw().toBuffer();
  const n = px.length; let m = 0; for (const v of px) m += v; m /= n;
  let sd = 0; for (const v of px) sd += (v - m) ** 2; sd = Math.sqrt(sd / n) || 1;
  return Float64Array.from(px, (v) => (v - m) / sd);
}
const pearson = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += a[i] * b[i]; return x / a.length; };

/**
 * The image arbiter, per flagged book (free: our R2 images and the providers' source images, no model):
 *   offset   dHash of the shown image against the source image of pages n−6…n+6 on sampled pages (quartiles of the
 *            shifted writer's run, else of the book; --quick: one page two-thirds in, widened only when it is off).
 *            The shown image is leaf n+k when k is the clear minimum (≤ 10, next ≥ 4 further), else the finer
 *            thumbnail correlation decides among the three best.
 *   blank    each text-on-near-blank page: the shown image's ink share; < INK_BLANK (0.5%) confirms a blank leaf.
 *   repeat   each far repeat pair: dHash between the two shown images. ≤ 10 = one leaf photographed twice (a repeat
 *            capture, #5056 — the texts are right); ≥ 16 = two different leaves carry one text.
 */
/** A seeded simple random sample: books ordered by sha1(seed + id), the first n taken; a resumed run continues it. */
function sampleOf(rows, n, seed) {
  return rows.map((r) => [crypto.createHash('sha1').update(`${seed}:${r.book}`).digest('hex'), r]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([, r]) => r);
}

async function arbitrate() {
  const rows = allScanRows();
  const want = arg('books') ? new Set(arg('books').split(',')) : null;
  const top = Number(arg('top', 40));
  // --select picks the cohort (several may be joined with commas); each run writes its own file, so a cheap cohort
  // (our own R2 images) is never queued behind the slow one (the Archive's servers):
  //   blank   a text on a near-blank image          repeat  a near-complete repeat (strongRepeat's text tests)
  //   offset  a bytes offset candidate              bulk    bulk_jp2 pages the #3368 repair never re-archived
  const SEL = {
    blank: (r) => r.textOnBlank.length > 0,
    repeat: (r) => r.repeatsFar.some((x) => x.contain >= REPEAT_CONFIRM.contain && Math.min(x.nA, x.nB) >= REPEAT_CONFIRM.minShingles && Math.min(x.nA, x.nB) / Math.max(x.nA, x.nB) >= REPEAT_CONFIRM.ratio && !x.front),
    offset: (r) => r.offset?.shifted || (r.shiftedWriters || []).length > 0,
    bulk: (r) => r.bulkUnrepaired > 0,
  };
  const sel = arg('select') ? arg('select').split(',') : null;
  const quick = process.argv.includes('--quick');
  const pick = want ? rows.filter((r) => want.has(r.book))
    : sel && arg('sample') ? sampleOf(rows.filter((r) => sel.some((k) => SEL[k](r))), Number(arg('sample')), arg('seed', '7866'))
    : sel ? rows.filter((r) => sel.some((k) => SEL[k](r))).sort((a, b) => b.score - a.score).slice(0, Number(arg('top', 1e9)))
      : rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, top);
  const file = path.join(OUT, `arbitrate${arg('name') ? `-${arg('name')}` : ''}.jsonl`);
  const done = new Set(readJsonl(file).map((r) => r.book));
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect();
  const db = c.db(process.env.MONGODB_DB || 'bookstore');
  // A smaller rendering of the same leaf: IIIF at 400 px; the Archive's BookReader scale-4 JPEG (~2 s and ~140 KB
  // against ~8 s and ~1 MB for its IIIF form; the same leaf, dHash 2, measured 2026-11-01).
  const small = (u) => {
    const ia = String(u || '').match(/^https:\/\/archive\.org\/download\/([^/]+)\/page\/n(\d+)\//);
    if (ia) return `https://archive.org/download/${ia[1]}/page/n${ia[2]}_s4.jpg`;
    return String(u || '').replace('/full/full/', '/full/400,/');
  };
  const get = async (u) => {
    const r = await fetch(u, { headers: { 'User-Agent': 'SourceLibrary-audit/7866 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const queue = pick.filter((r) => !done.has(r.book));
  let qi = 0;
  await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, async () => { while (qi < queue.length) { const r = queue[qi++]; try { await arbitrateBook(r); } catch (e) { console.error(`${r.book}: ${String(e.message || e).slice(0, 120)}`); } } }));
  await c.close();

  async function arbitrateBook(r) {
    const cache = new Map(), bufs = new Map();
    const h = async (u) => { if (!cache.has(u)) { const b = await get(u); bufs.set(u, b); cache.set(u, await hashBuffer(b)); } return cache.get(u); };
    const pages = await db.collection('pages').find({ book_id: r.book, page_number: { $gt: 0 }, hidden: { $ne: true } }, { projection: { page_number: 1, display_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, 'archive_metadata.source': 1 } }).toArray();
    const by = new Map(pages.map((p) => [p.page_number, p]));
    // The image the judge and the reader get (split-aware: a page split from a spread is its own half, not the spread).
    const shown = (p) => (p ? getPageSource(p) : null);
    const out = { book: r.book, offset: [], blank: [], repeat: [] };
    // A named book (--books, a validation set) is always tested; in a ranked run, a book with a candidate offset or with
    // bulk_jp2 pages the #3368 repair never re-archived.
    const wantOffset = want || (sel ? sel.some((k) => k === 'offset' || k === 'bulk') && (SEL.offset(r) || SEL.bulk(r)) : r.offset?.shifted || (r.shiftedWriters || []).length || r.bulkUnrepaired > 0);
    if (wantOffset) {
      const w = (r.shiftedWriters || [])[0]?.writer || (r.bulkUnrepaired > 0 ? 'bulk_jp2' : null);
      const ps = pages.filter((p) => !w || w === '?' || p.archive_metadata?.source === w).map((p) => p.page_number).sort((a, b) => a - b);
      // --quick: one page two-thirds in (a #3368 shift grows at every interior excluded leaf, so it is wider at the back);
      // the two quartile pages are added only when that page is not its own leaf.
      const fr = quick ? [2 / 3] : [0.25, 0.5, 0.75];
      for (let fi = 0; fi < fr.length; fi++) {
        const n = ps[Math.floor(ps.length * fr[fi])];
        const p = by.get(n); if (!p) continue; const d = {}; let err = null;
        try {
          const hs = await h(shown(p));
          // Offset 0 first: an image that is its own leaf costs two fetches, not fourteen.
          for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6]) {
            const q = by.get(n + k); const src = q && (q.photo_original || q.photo); if (!src || src === shown(p)) continue;
            try { d[k] = hammingHex(hs, await h(small(src))); } catch { /* one leaf missing */ }
            if (k === 0 && d[0] != null && d[0] <= 4) break;
          }
        } catch (e) { err = String(e.message || e).slice(0, 80); }
        const ks = Object.entries(d).map(([k, v]) => [+k, v]).sort((a, b) => a[1] - b[1]);
        const [b1, b2] = ks;
        let k = err || !b1 ? null : ks.length === 1 && b1[0] === 0 && b1[1] <= 4 ? 0 : b1[1] <= 10 && (!b2 || b2[1] - b1[1] >= 4) ? b1[0] : undefined;
        // The 8x8 dHash cannot separate two pages of one layout (recto/verso alternate at ~9), so an undecided page
        // goes to the finer test page-repeat-images.mjs validated (#5056: same image r >= 0.967, neighbours 0.25-0.75):
        // correlation of 64x80 grey thumbnails over the three best offsets.
        let corr = null;
        if (k === undefined && b1 && b1[1] <= 16) {
          try {
            const mine = await thumb(bufs.get(shown(p)));
            corr = {};
            for (const [kk] of ks.slice(0, 3)) { const q = by.get(n + kk); corr[kk] = +pearson(mine, await thumb(bufs.get(small(q.photo_original || q.photo)))).toFixed(3); }
            const cs = Object.entries(corr).sort((x, y) => y[1] - x[1]);
            if (cs[0][1] >= 0.9 && (!cs[1] || cs[0][1] - cs[1][1] >= 0.05)) k = +cs[0][0];
          } catch { /* a buffer the cache did not keep */ }
        }
        out.offset.push({ p: n, k: k === undefined ? 'undecided' : k, d, ...(corr && { corr }), err });
        if (quick && fr.length === 1 && typeof k === 'number' && k !== 0) fr.push(0.25, 0.5);
      }
    }
    const wantBlank = !sel || sel.includes('blank'), wantRepeat = !sel || sel.includes('repeat');
    for (const t of wantBlank ? r.textOnBlank.slice(0, 6) : []) {
      try { out.blank.push({ p: t.p, ink: await inkShare(await get(shown(by.get(t.p)))) }); } catch (e) { out.blank.push({ p: t.p, err: String(e.message || e).slice(0, 80) }); }
    }
    for (const x of wantRepeat ? [...r.repeatsFar].sort((u, v) => v.contain - u.contain).slice(0, 8) : []) {
      try { out.repeat.push({ a: x.a, b: x.b, contain: x.contain, nA: x.nA, nB: x.nB, front: x.front, dist: hammingHex(await h(shown(by.get(x.a))), await h(shown(by.get(x.b)))) }); } catch (e) { out.repeat.push({ a: x.a, b: x.b, err: String(e.message || e).slice(0, 80) }); }
    }
    const ks = out.offset.map((o) => o.k).filter((k) => typeof k === 'number');
    const mode = ks.length ? [...new Set(ks)].map((k) => [k, ks.filter((x) => x === k).length]).sort((a, b) => b[1] - a[1])[0] : null;
    out.imageShift = mode && mode[0] !== 0 && mode[1] >= 2 ? mode[0] : mode && mode[0] === 0 && mode[1] >= 2 ? 0 : null;
    out.blankConfirmed = out.blank.filter((b) => b.ink != null && b.ink < INK_BLANK).map((b) => b.p);
    out.repeatDifferentLeaves = out.repeat.filter((x) => x.dist >= 16).map((x) => [x.a, x.b]);
    out.repeatCaptures = out.repeat.filter((x) => x.dist != null && x.dist <= 10).map((x) => [x.a, x.b]);
    fs.appendFileSync(file, JSON.stringify(out) + '\n');
    console.log(`${r.book}: shift ${out.imageShift} [${out.offset.map((o) => `${o.p}:${o.k}`).join(' ')}] blank ${out.blankConfirmed.join(',') || '-'} (${out.blank.map((b) => `${b.p}@${b.ink}`).join(' ')}) repeat diff ${out.repeatDifferentLeaves.length}/${out.repeat.length}`);
  }
}

const stages = { scan, rank, arbitrate };
if (!stages[STAGE]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[STAGE]();
