// LEAF SPLIT + MALAYALAM SCRIPT (#7119, Derek's inbox notes of 2026-10-22 23:08–23:09): one page per palm leaf,
// upper then lower, with each page's OCR showing the reading in Malayalam script above its IAST.
//
// PRIOR ART: scripts/maintenance/atisha-leaf-order-6142.mjs (#6142) — its child-page shape (split_from_spread,
// pages/<book>/sp<id>.jpg keys the resolver serves, book-scoped keys via assertBookScopedKey), its soft-hide of the
// parent (page_number −n, split_into), its revision copies and snapshot before any write, and its text carry-over at
// the single <leaf-break/> are followed here. It does not fit as-is: its board order, Yigdzin/leaf-run cuts and
// unreadable handling are specific to that book. Here the cut is the gap between the two leaf boxes this run cropped
// its reads from (boxes.json, same archived image, size checked), so each child image holds exactly the leaf whose
// text it carries.
//
// TEXT, per child: no re-OCR, no re-translation.
//   OCR  = <warning> for THIS leaf's method (+ the sentence on the generated Malayalam), the page's <language>/<script>/
//          <page-type> lines, the leaf's rows in Malayalam script (mlym.py: deterministic IAST -> Malayalam, dot-reph
//          for r before a consonant, brackets/labels/tags untouched), a rule, then the same rows in IAST.
//   English = the parent's translation split at its one <leaf-break/>, each half opening with the translation warning
//          for its own leaf; the page-level <summary>/<keywords> (written about both leaves) are dropped. A page whose
//          translation has no single leaf-break gives its children no English: they are listed for an Opus translation.
// Page 3 (the contents leaf, English + Malayalam already) is split without conversion. Pages 1 and 159 hold one board
// each: they are not split, only given the Malayalam rendering in place (writePageText).
//
// Nothing is deleted. Before the first write: JSON snapshot of the book's pages and book doc ($JOB_SCRATCH), a
// page_revisions copy of every parent's ocr + translation (reason 'spread_split'), a sweep_log row.
//   node --env-file=/root/sourcelibrary/.env.production.local leaf-split.mjs [--pages=4-12] [--sheet] [--execute]
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HERE, BOOK, SCRATCH, boxes } from './lib.mjs';
import { warningFor } from './assemble.mjs';
import { translationWarning } from './translate-plan.mjs';
import { assertBookScopedKey } from '../../../lib/r2-key.mjs';
import { saveRevisionsBeforeOverwrite } from '../../../lib/page-revisions.mjs';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';
import { recountBook } from '../../../lib/page-counts.mjs';
import { withdrawPageVectors } from '../../../lib/withdraw-page-vectors.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';

const SWEEP = 'whish147-leaf-split';
const ISSUE = 7119;
const RUN = `${SWEEP}/${new Date().toISOString().slice(0, 19)}`;
const LEAF_BREAK = /<leaf-break\s*\/?>/i;
export const MLYM_SENTENCE = 'The Malayalam script here is generated from the romanised reading; it follows this scribe’s dot-reph but otherwise shows standard spelling.';
const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const EXECUTE = args.includes('--execute');
const [P0, P1] = (arg('pages') || '1-159').split('-').map(Number);
const OUT = path.join(SCRATCH, 'leaf-split');
fs.mkdirSync(OUT, { recursive: true });

const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
async function put(key, buf) {
  assertBookScopedKey(key, BOOK, SWEEP);
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC}/${key}`;
}

/** IAST -> Malayalam for many texts in one python call. */
function toMalayalam(map) {
  const r = spawnSync(path.join(SCRATCH, 'venv/bin/python'), [path.join(HERE, 'mlym.py')], { input: JSON.stringify(map), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`mlym.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const WARN = /^<warning>([\s\S]*?)<\/warning>\s*/;
/** Split a stored OCR into { header (tag lines), blocks: [upper, lower] } at its single leaf-break; null otherwise. */
function splitOcr(text) {
  const rest = text.replace(WARN, '');
  const parts = rest.split(LEAF_BREAK);
  if (parts.length !== 2) return null;
  const lines = parts[0].split('\n');
  const head = [];
  while (lines.length && (lines[0].trim() === '' || /^<(language|script|page-type|scan-quality)>/.test(lines[0].trim()))) { const l = lines.shift(); if (l.trim()) head.push(l.trim()); }
  return { header: head.join('\n'), blocks: [lines.join('\n').trim(), parts[1].trim()] };
}
function splitTranslation(text) {
  const parts = String(text || '').replace(WARN, '').replace(/<(summary|keywords)>[\s\S]*?<\/\1>/g, '').split(LEAF_BREAK);
  return parts.length === 2 ? parts.map((s) => s.trim()) : null;
}
/** The OCR text of one leaf (or a single-leaf page): warning, header, Malayalam rows, rule, IAST rows. */
function leafOcr(warning, header, block, mlymBlock) {
  const hasReading = mlymBlock && mlymBlock !== block;
  return `<warning>${warning}${hasReading ? ` ${MLYM_SENTENCE}` : ''}</warning>\n${header}\n\n${hasReading ? `${mlymBlock}\n\n---\n\n**IAST transliteration**\n\n${block}` : block}\n`;
}
const pageJson = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'pages', `${n}.json`), 'utf8'));
const leafP = (P, leaf) => ({ ...P, leaves: { [leaf]: P.leaves[leaf] }, methods: [P.leaves[leaf].method] });

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const Pages = db.collection('pages');
  const book = await db.collection('books').findOne({ id: BOOK });
  if (book.pipeline_auto?.status !== 'held') throw new Error('book is not held — refusing');
  const pages = await Pages.find({ book_id: BOOK }).toArray();
  if (pages.some((p) => p.split_from_spread || p.page_number <= 0)) throw new Error('book already has split or soft-hidden pages — refusing a second run');
  const B = boxes();
  const now = new Date();
  const byN = new Map(pages.map((p) => [p.page_number, p]));
  const built = [], singles = [], needTranslation = [];
  const mlymIn = {};

  // Pass 1: texts.
  for (let n = P0; n <= P1; n++) {
    const page = byN.get(n), P = pageJson(n);
    const leaves = Object.keys(B[n].leaves);
    if (!page?.ocr?.data?.startsWith('<warning>')) throw new Error(`p${n}: no best-attempt OCR`);
    if (leaves.length === 1) {
      const rest = page.ocr.data.replace(WARN, '');
      mlymIn[`${n}`] = rest;
      singles.push({ n, page, P, rest });
      continue;
    }
    if (leaves.join() !== 't,b') throw new Error(`p${n}: leaves ${leaves}`);
    const s = splitOcr(page.ocr.data);
    if (!s) throw new Error(`p${n}: OCR without exactly one leaf-break`);
    const tr = page.translation?.data ? splitTranslation(page.translation.data) : null;
    if (page.translation?.data && !tr) needTranslation.push(n);
    built.push({ n, page, P, s, tr });
    if (n !== 3) s.blocks.forEach((b, i) => { if (P.leaves[['t', 'b'][i]].method !== 'no-text') mlymIn[`${n}-${i}`] = b; });
  }
  const mlym = toMalayalam(mlymIn);

  // Pass 2: images + child docs.
  for (const b of built) {
    const { n, page, P, s, tr } = b;
    const buf = await (await fetch(page.archived_photo)).arrayBuffer().then((x) => Buffer.from(x));
    const meta = await sharp(buf).metadata();
    const W = meta.width, H = meta.height;
    if (W !== B[n].size[0] || H !== B[n].size[1] || W !== page.image_width || H !== page.image_height) throw new Error(`p${n}: image ${W}x${H} ≠ boxes ${B[n].size} / page ${page.image_width}x${page.image_height}`);
    const tBottom = B[n].leaves.t.L[3], bTop = B[n].leaves.b.L[1];
    if (!(tBottom < bTop)) throw new Error(`p${n}: leaf boxes overlap (${tBottom} ≥ ${bTop})`);
    const cut = Math.round((tBottom + bTop) / 2);
    b.cut = cut;
    b.kids = [];
    for (const [i, leaf] of [[0, 't'], [1, 'b']]) {
      const top = i === 0 ? 0 : cut, height = i === 0 ? cut : H - cut;
      const leafBuf = await sharp(buf).extract({ left: 0, top, width: W, height }).jpeg({ quality: 92, progressive: true }).toBuffer();
      const dispBuf = await sharp(leafBuf).resize({ width: 2400 }).jpeg({ quality: 88, progressive: true }).toBuffer();
      const thumbBuf = await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
      const id = new ObjectId().toHexString();
      const keys = { full: `cropped/${BOOK}/${id}.jpg`, display: `pages/${BOOK}/sp${id}.jpg`, thumb: `pages/${BOOK}/sp${id}-thumb.jpg` };
      for (const k of Object.values(keys)) assertBookScopedKey(k, BOOK, `p${n} ${leaf}`);
      const leafSplit = { from_page: page.id, from_page_number: n, leaf, cut_px: cut, method: 'leaf-boxes', run: RUN, issue: ISSUE };
      const lp = n === 3 ? P : leafP(P, leaf);
      const warning = n === 3 ? P.warning : warningFor(lp.leaves);
      const data = leafOcr(warning, s.header, s.blocks[i], mlym[`${n}-${i}`]);
      const engine = page.ocr.engine ? { ...page.ocr.engine, input: { ...page.ocr.engine.input, whish147: { ...(page.ocr.engine.input?.whish147 || {}), leaves: n === 3 ? page.ocr.engine.input?.whish147?.leaves : { [leaf]: P.leaves[leaf] }, script_from: mlym[`${n}-${i}`] ? 'iast-transliteration (indic_transliteration IAST->MALAYALAM, dot-reph; mlym.py)' : null } } } : undefined;
      const ocr = { ...page.ocr, data, content_hash: contentHash(data), ...(engine ? { engine } : {}), leaf_split: leafSplit };
      let translation;
      if (tr) {
        const tdata = `<warning>${translationWarning(lp)}</warning>\n\n${tr[i]}`;
        translation = { ...page.translation, data: tdata, content_hash: contentHash(tdata), leaf_split: leafSplit };
      }
      b.kids.push({ leafBuf, dispBuf, thumbBuf, keys, doc: {
        _id: new ObjectId(id), id, book_id: BOOK, page_number: 0,
        photo: `${R2_PUBLIC}/${keys.display}`, display_photo: `${R2_PUBLIC}/${keys.display}`, archived_photo: `${R2_PUBLIC}/${keys.full}`,
        image_thumb: `${R2_PUBLIC}/${keys.thumb}`, thumbnail: `${R2_PUBLIC}/${keys.thumb}`,
        photo_original: page.archived_photo || page.photo_original || page.photo,
        image_width: W, image_height: height,
        split_from_spread: page.id, split_side: i === 0 ? 'top' : 'bottom', split_position: cut, split_method: `${SWEEP}:leaf-boxes`,
        page_type: page.page_type || 'text', ...(page.script_type ? { script_type: page.script_type } : {}),
        ocr, ...(translation ? { translation } : {}),
        field_provenance: { photo: { source: 'r2', method: `${SWEEP}:leaf-boxes`, date: now } },
        created_at: now, updated_at: now,
      } });
    }
  }
  // Order: page n → its upper then lower leaf; single-board pages keep their place.
  const order = [];
  for (let n = 1; n <= 159; n++) {
    const b = built.find((x) => x.n === n);
    if (b) b.kids.forEach((k) => order.push(k.doc)); else order.push(byN.get(n));
  }
  order.forEach((p, i) => { p._newNumber = i + 1; });
  for (const b of built) for (const k of b.kids) k.doc.page_number = k.doc._newNumber;
  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY RUN'} ${RUN}: ${built.length} scans → ${built.length * 2} leaf pages; ${singles.length} single boards converted in place; book will have ${order.length} pages; translations to redo: [${needTranslation.join(' ')}]`);
  for (const b of built.slice(0, 3)) console.log(`  p${b.n} cut @${b.cut}: ${b.kids.map((k) => `${k.doc.page_number}=${k.doc.split_side} ${k.doc.image_height}px ocr ${k.doc.ocr.data.length}c tr ${k.doc.translation?.data.length ?? '-'}c`).join(' | ')}`);

  if (args.includes('--sheet') || !EXECUTE) {
    // Contact sheet: 6 children (crop) with their first Malayalam row printed beside, for a by-eye check.
    const pick = built.filter((b) => [5, 60, 130].includes(b.n)).flatMap((b) => b.kids).slice(0, 6);
    const tiles = await Promise.all(pick.map((k) => sharp(k.leafBuf).resize({ width: 1100 }).toBuffer()));
    const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
    const Ht = metas.reduce((a, m) => a + m.height + 10, 0);
    await sharp({ create: { width: 1100, height: Ht, channels: 3, background: '#ffffff' } }).composite(tiles.map((t, i) => ({ input: t, left: 0, top: metas.slice(0, i).reduce((a, m) => a + m.height + 10, 0) }))).jpeg().toFile(path.join(OUT, 'sheet.jpg'));
    for (const k of pick) {
      const body = k.doc.ocr.data.replace(WARN, '').split('\n').filter((l) => /^\d+\./.test(l));
      console.log(`  sheet ${k.doc.page_number} (${k.doc.split_side} of p${k.doc.ocr.leaf_split.from_page_number}): ${body[0] ?? '(no rows)'} || ${body[1] ?? ''}`);
    }
    fs.writeFileSync(path.join(OUT, 'dry-children.json'), JSON.stringify(built.flatMap((b) => b.kids.map((k) => ({ n: b.n, page_number: k.doc.page_number, side: k.doc.split_side, ocr: k.doc.ocr.data, translation: k.doc.translation?.data ?? null }))), null, 1));
  }
  if (!EXECUTE) { await client.close(); return; }

  // ── 1. snapshots + revision copies ──
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUT, `snapshot-pages-${stamp}.json`), JSON.stringify(pages));
  fs.writeFileSync(path.join(OUT, `snapshot-book-${stamp}.json`), JSON.stringify(book));
  const parentIds = built.map((b) => b.page.id);
  const nOcr = await saveRevisionsBeforeOverwrite(db, parentIds, 'ocr', { reason: 'spread_split', jobId: RUN, keepMeta: true });
  const nTr = await saveRevisionsBeforeOverwrite(db, parentIds, 'translation', { reason: 'spread_split', jobId: RUN, keepMeta: true });
  console.log(`  snapshots in ${OUT}; page_revisions ocr=${nOcr} translation=${nTr}`);
  await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK, action: 'split-two-leaf-scans-start', detail: { run: RUN, issue: ISSUE, scans: built.length, snapshot: `snapshot-pages-${stamp}.json` } });

  // ── 2. images ──
  for (const b of built) for (const k of b.kids) { await put(k.keys.full, k.leafBuf); await put(k.keys.display, k.dispBuf); await put(k.keys.thumb, k.thumbBuf); }
  console.log('  images uploaded');

  // ── 3. pages: insert children, soft-hide parents, renumber single boards ──
  const ops = [];
  for (const b of built) {
    for (const k of b.kids) { const { _newNumber, ...doc } = k.doc; ops.push({ insertOne: { document: doc } }); }
    ops.push({ updateOne: { filter: { _id: b.page._id, page_number: b.n }, update: { $set: { page_number: -b.n, split_into: b.kids.map((k) => k.doc.id), updated_at: now } } } });
  }
  for (const s of singles) if (s.page.page_number !== s.page._newNumber) ops.push({ updateOne: { filter: { _id: s.page._id }, update: { $set: { page_number: s.page._newNumber, updated_at: now } } } });
  const res = await Pages.bulkWrite(ops, { ordered: true });
  console.log(`  pages: inserted ${res.insertedCount}, modified ${res.modifiedCount}`);
  await withdrawPageVectors(parentIds, { reason: 'archived', writer: SWEEP });

  // ── 4. single boards: Malayalam rendering in place ──
  for (const s of singles) {
    const lp = s.P;
    const split = s.rest.split('\n');
    const head = [];
    while (split.length && (split[0].trim() === '' || /^<(language|script|page-type)>/.test(split[0].trim()))) { const l = split.shift(); if (l.trim()) head.push(l.trim()); }
    const block = split.join('\n').trim();
    const mb = toMalayalam({ x: block }).x;
    const data = leafOcr(warningFor(lp.leaves), head.join('\n'), block, mb);
    const r = await writePageText(db, s.page.id, 'ocr', { ...s.page.ocr, data, content_hash: contentHash(data), updated_at: new Date() }, { by: `scripts/eval/results/whish147-best-attempt-2026-10-22/leaf-split.mjs`, reason: 'Malayalam-script rendering added (#7119)', run_id: RUN });
    console.log(`  p${s.n} (board): ${r.status}`);
  }

  // ── 5. counters + log ──
  const rc = await recountBook(db, BOOK, { reason: SWEEP });
  console.log('  recount:', JSON.stringify(rc.after));
  await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK, action: 'split-two-leaf-scans', detail: { run: RUN, issue: ISSUE, children: built.flatMap((b) => b.kids.map((k) => ({ id: k.doc.id, page_number: k.doc.page_number, from_page: b.page.id, from_page_number: b.n, side: k.doc.split_side }))), translations_to_redo: needTranslation } });
  await db.collection('book_events').insertOne({ book_id: BOOK, type: 'leaf_split', at: now, source: 'scripts/eval/results/whish147-best-attempt-2026-10-22/leaf-split.mjs', details: { run: RUN, issue: ISSUE, scans: built.length, pages_after: order.length } });
  fs.writeFileSync(path.join(HERE, 'leaf-split-result.json'), JSON.stringify({ run: RUN, at: now.toISOString(), pages_after: order.length, translations_to_redo: needTranslation, children: built.flatMap((b) => b.kids.map((k) => ({ id: k.doc.id, page_number: k.doc.page_number, from: b.n, side: k.doc.split_side, has_translation: !!k.doc.translation }))) }, null, 1));
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
