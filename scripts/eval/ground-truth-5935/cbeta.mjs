#!/usr/bin/env node
// #5935 arm (b): body CER of model readings of the CBETA Chan books we already held (#5566 mode 1)
// against the CBETA typed text. READ-ONLY: the #5566 work dir (fit.json, page-reads.json, the pinned
// xml-p5 file), Mongo pages by id. $0, no model call.
//
// What "earlier model reading" means here (measured 2026-10-06): `page_revisions` holds NO earlier OCR
// for these books (only translation health-gate rows), so the brief's source does not exist. The
// readings are (1) the served OCR on pages that had OCR before CBETA was fitted (#5566 never overwrote
// it: gemini-3.1-flash-lite and gemini-3-flash-preview), and (2) the flash-lite column read #5566 made
// to locate pages that had none (`page-reads.json`; a different prompt, never served).
//
// The reference is NOT the page's own fitted span. That span was placed using the page's own reading and
// written only where the two agreed, so scoring the reading against it would be circular and would drop
// exactly the pages read worst. The reference is the CBETA text BETWEEN the spans of the two neighbouring
// pages (both fitted), which no character of this page's reading placed. A page without two fitted
// neighbours is `unaligned`; the own-span score is kept beside it as a secondary, self-selected number.
//
// PRIOR ART: scripts/import/cbeta-chan-import.mjs (#5566: the fit itself, its spans and its reads —
// read here, never re-run); scripts/lib/cbeta-fit.mjs (extractTei, foldHan: imported); the Kanripo arm
// beside this file (same CER and record shape).
//
//   nice -n 10 node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ground-truth-5935/cbeta.mjs
// Writes /root/ground-truth-5935/cbeta.jsonl (every scorable page; one per book marked primary).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { extractTei, foldHan as foldCbeta } from '../../lib/cbeta-fit.mjs';
import { bodyText, bodyCer, makeRng, engineOf, kindOf, periodOf, resBand, isInterior, CATASTROPHIC_CER, NORMALISER_VERSION } from './lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SRC = argOf('cbeta', '/root/cbeta-5566');
const WORK = argOf('work', '/root/ground-truth-5935');
const OUT = `${WORK}/cbeta.jsonl`;
const SEED = 5935;
// The three #5566 texts whose scans we already held and read with our own engine (NDL texts were read by
// NDL's OCR, not ours, and are out of scope). Editions as recorded in cbeta-chan-import.mjs TEXTS.
const TEXTS = {
  X1565: { xml: 'X80n1565.xml', cbeta: 'X80n1565', edition: 'IA/CADAL 五燈會元, Siku Quanshu manuscript copy (20 vols)', kind: 'handwritten', period: '1700s', period_src: 'edition: Siku Quanshu copy, 1773–1782' },
  X1319: { xml: 'X68n1319.xml', cbeta: 'X68n1319', edition: '御選語錄, Wuyingdian print, 雍正11 [1733] (Harvard-Yenching)', kind: 'printed', period: '1700s', period_src: 'edition: 1733' },
  T1998L: { xml: 'T47n1998A.xml', cbeta: 'T47n1998A', edition: '大慧普覺禪師語錄, 1585 print (Library of Congress)', kind: 'printed', period: '1500s', period_src: 'edition: 1585' },
};
const s = (a) => a.join('');
const seedOf = (id) => SEED ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const gaiji = JSON.parse(fs.readFileSync(path.join(SRC, 'gaiji.json'), 'utf8'));
const out = [];

for (const [key, T] of Object.entries(TEXTS)) {
  const fit = JSON.parse(fs.readFileSync(path.join(SRC, key, 'fit.json'), 'utf8'));
  const reads = JSON.parse(fs.readFileSync(path.join(SRC, key, 'page-reads.json'), 'utf8'));
  const ex = extractTei(fs.readFileSync(path.join(SRC, 'xml', T.xml), 'utf8'), gaiji);
  const F = foldCbeta(ex.text).f;
  const rows = fit.rows;
  const ids = rows.filter((r) => r.existing_ocr).map((r) => r.page_id);
  const served = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, image_width: 1, image_height: 1, script_type: 1 } }).toArray()).map((p) => [p.id, p]));
  const dims = new Map((await db.collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, image_width: 1, image_height: 1, script_type: 1 } }).toArray()).map((p) => [p.id, p]));
  const bookIds = [...new Set(rows.map((r) => r.pid))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, title: 1, published: 1, pages_count: 1, visible: 1, 'image_source.provider': 1 } }).toArray()).map((b) => [b.id, b]));
  let n = 0;
  rows.forEach((r, i) => {
    const a = rows[i - 1], b = rows[i + 1];
    const reading = r.existing_ocr ? served.get(r.page_id) : null;
    const text = r.existing_ocr ? reading?.ocr?.data : reads[r.page_id]?.text;
    if (!text) return;
    const book = books.get(r.pid);
    const d = dims.get(r.page_id) || {};
    const Q = s(foldCbeta(bodyText(text)).f);
    const base = {
      book_id: r.pid, title: String(book?.title || '').slice(0, 80), page_id: r.page_id, page_number: r.n,
      reading: r.existing_ocr ? 'served-ocr' : 'fit-read (flash-lite column prompt, never served)',
      engine: r.existing_ocr ? engineOf(reading.ocr) : 'gemini-flash-lite', model: r.existing_ocr ? reading.ocr.model : 'gemini-3.1-flash-lite',
      ocr_source: r.existing_ocr ? reading.ocr.source : 'cbeta-5566-page-read',
      kind: kindOf(d.script_type, T.kind), script_type: d.script_type || null, period: periodOf(book?.published) === 'unknown' ? T.period : periodOf(book?.published), period_src: periodOf(book?.published) === 'unknown' ? T.period_src : 'books.published',
      provider: book?.image_source?.provider || null, visible: !!book?.visible, res_band: resBand(d.image_width, d.image_height), long_edge: Math.max(d.image_width || 0, d.image_height || 0) || null,
      ref: 'cbeta', ref_edition: `CBETA XML P5 ${T.cbeta} (Taishō/Xuzangjing reading text) vs our scan: ${T.edition}`, ref_repo: 'cbeta-org/xml-p5', ref_sha: fit.xml_sha,
      script: 'cjk', language: 'Chinese', normaliser: `han+cbeta-fold@${NORMALISER_VERSION}`, interior: isInterior(r.n, book?.pages_count || rows.filter((x) => x.pid === r.pid).length),
      own_span: null,
    };
    if (r.span) { const o = bodyCer(Q, s(F.slice(Math.max(0, r.span[0] - 40), r.span[1] + 40)), { expected: r.span[1] - r.span[0] }); base.own_span = { cer: +o.cer.toFixed(4), written: !!r.written, why: r.why || null }; }
    const nb = a?.pid === r.pid && b?.pid === r.pid && a.span && b.span && b.span[0] >= a.span[1] ? [a.span[1], b.span[0]] : null;
    if (!nb || nb[1] - nb[0] < 20) { out.push({ ...base, status: 'unaligned', why: nb ? 'neighbour gap < 20 chars' : 'no two fitted neighbours' }); return; }
    // Window: the neighbour-bounded span with 40 characters of slack each side (neighbour edges are
    // column-accurate, not character-accurate); `expected` is the bounded span itself.
    const W = s(F.slice(Math.max(0, nb[0] - 40), nb[1] + 40));
    const sc = bodyCer(Q, W, { expected: nb[1] - nb[0] });
    out.push({ ...base, status: 'scored', leaf: 'neighbours', ref_span: nb, match: { confidence: Math.min(a.verify?.identity ?? 0, b.verify?.identity ?? 0) >= 0.9 ? 'high' : 'medium', neighbour_identity: [a.verify?.identity ?? null, b.verify?.identity ?? null] },
      q_chars: sc.q_chars, expected: nb[1] - nb[0], span: sc.span, d: sc.d, omitted: sc.omitted, cer: +sc.cer.toFixed(4), catastrophic: sc.cer > CATASTROPHIC_CER });
    n++;
  });
  console.log(`${key}: ${rows.length} pages, ${n} scored against neighbour-bounded CBETA spans`);
}

// One primary page per book: a seeded interior served-OCR page, else a seeded interior fit-read page.
const byBook = new Map();
for (const r of out.filter((x) => x.status === 'scored')) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
for (const [bid, rs] of byBook) {
  const pool = rs.filter((x) => x.interior && x.reading === 'served-ocr').length ? rs.filter((x) => x.interior && x.reading === 'served-ocr') : rs.filter((x) => x.interior).length ? rs.filter((x) => x.interior) : rs;
  pool.sort((x, y) => x.page_number - y.page_number);
  const pick = pool[Math.floor(makeRng(seedOf(bid))() * pool.length)];
  for (const r of rs) r.primary = r === pick;
}
fs.writeFileSync(OUT, out.map((r) => JSON.stringify({ ...r, at: new Date().toISOString() })).join('\n') + '\n');
const sc = out.filter((r) => r.status === 'scored');
const tally = (f) => sc.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
console.log(`scored ${sc.length} pages in ${byBook.size} books; unaligned ${out.length - sc.length}; by reading/engine ${JSON.stringify(tally((r) => `${r.reading.split(' ')[0]}|${r.engine}`))}`);
await client.close();
