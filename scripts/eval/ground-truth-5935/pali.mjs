#!/usr/bin/env node
// #5935 arm (c): body CER of our current Pali reading against the VRI Chaṭṭha Saṅgāyana typed text
// (CSCD, github vipassanatech/tipitaka-xml), for the books whose pages match a VRI text. One seeded
// interior page per book. READ-ONLY: Mongo reads, a local sparse clone of tipitaka-xml (romn, deva,
// sinh). $0, no model call.
//
// The reference is a DIFFERENT EDITION for every book we hold (PTS, Nalanda, Buddha Jayanti, palm-leaf
// copies vs the Sixth Council text), so part of every difference is a genuine variant or an editorial
// convention (peyyāla abbreviations, PTS's ° elisions, niggahita written ṃ/ṁ/ŋ/m). The floor review
// (floor.mjs) measures that share; the CER here is never quoted without it.
//
// Leaf rule: the page is located in VRI by k-gram offset voting (sefaria-fit `locate`, ported to an
// indexOf scan because VRI is one 60M-letter stream), and so are its two neighbours. When both
// neighbours fit and bracket it, the reference is the VRI text BETWEEN them, which none of this page's
// characters placed (a garbled page is charged, not dropped). Otherwise the page's own location is used
// with no omission charge (leaf: 'own', lower confidence).
//
// PRIOR ART: scripts/lib/sefaria-fit.mjs (`locate` offset voting with a runner-up, `anchorAt`: the
// neighbour-anchor idea); the CBETA arm beside this file (neighbour-bounded reference); nalanda-readiness/
// sample_skt.mjs (one page per book over Sanskrit/Pali, but scores nothing). No script reads VRI.
//
//   nice -n 10 node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ground-truth-5935/pali.mjs
// Writes /root/ground-truth-5935/pali.jsonl (one line per book).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { SCRIPTS, scriptOf, normPali } from './pali-norm.mjs';
import { bodyText, bodyCer, fitAlign, makeRng, engineOf, kindOf, periodOf, resBand, isInterior, CATASTROPHIC_CER, NORMALISER_VERSION } from './lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WORK = argOf('work', '/root/ground-truth-5935');
const VRI = argOf('vri', `${WORK}/vri`);
const OUT = `${WORK}/pali.jsonl`;
const SEED = 5935;
const K = 14;
const TRIES = 4;
const seedOf = (id) => SEED ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);
const VRI_SHA = fs.existsSync(`${WORK}/vri.sha`) ? fs.readFileSync(`${WORK}/vri.sha`, 'utf8').trim() : null;

const norm = normPali;

// ── VRI corpus, one stream per script, built once and cached ────────────────
const corpora = {};
function corpus(sc) {
  if (corpora[sc]) return corpora[sc];
  const cache = `${WORK}/vri-${sc}.stream.json`;
  if (fs.existsSync(cache)) return (corpora[sc] = JSON.parse(fs.readFileSync(cache, 'utf8')));
  const files = fs.readdirSync(path.join(VRI, sc)).filter((f) => f.endsWith('.xml')).sort();
  let L = '';
  const fileAt = [], pts = [];
  for (const f of files) {
    const xml = fs.readFileSync(path.join(VRI, sc, f)).toString('utf16le').replace(/^﻿/, '');
    const body = xml.slice(Math.max(0, xml.indexOf('<body')));
    fileAt.push([L.length, f]);
    // Variant readings (<note>) are VRI's apparatus, not its text. PTS page breaks are kept as markers.
    const parts = body.replace(/<note>[\s\S]*?<\/note>/g, ' ').split(/<pb ed="P" n="([^"]+)"\s*\/>/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2) { pts.push([L.length, parts[i]]); continue; }
      L += SCRIPTS[sc].fold(parts[i].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' '));
    }
  }
  corpora[sc] = { L, fileAt, pts };
  fs.writeFileSync(cache, JSON.stringify(corpora[sc]));
  console.log(`VRI ${sc}: ${files.length} files, ${L.length} letters, ${pts.length} PTS page markers`);
  return corpora[sc];
}
const fileOf = (C, pos) => { let lo = 0, hi = C.fileAt.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (C.fileAt[m][0] <= pos) lo = m; else hi = m - 1; } return C.fileAt[lo][1]; };
const ptsIn = (C, a, b) => C.pts.filter(([p]) => p >= a && p <= b).map(([, n]) => n);

/** Offset voting over the whole stream (sefaria-fit `locate`, with indexOf as the index). */
function locate(Q, C, { lo = 0, hi = Infinity } = {}) {
  const n = Q.length - K;
  if (n < 20) return null;
  const grams = 40, step = Math.max(1, Math.floor(n / grams));
  const votes = new Map();
  let asked = 0;
  for (let j = 0; j <= n; j += step) {
    const g = Q.slice(j, j + K);
    asked++;
    let p = C.L.indexOf(g, lo), hits = 0;
    const seen = [];
    while (p >= 0 && p <= hi && hits < 30) { seen.push(p); hits++; p = C.L.indexOf(g, p + 1); }
    if (hits >= 30) continue;    // a stock phrase: carries no location
    for (const q of seen) { const b = Math.round((q - j) / 64); votes.set(b, (votes.get(b) || 0) + 1); }
  }
  if (!votes.size) return { pos: null, share: 0, second: 0 };
  const sum = (b) => (votes.get(b - 1) || 0) + (votes.get(b) || 0) + (votes.get(b + 1) || 0);
  let best = null, bv = -1;
  for (const b of votes.keys()) { const v = sum(b); if (v > bv) { bv = v; best = b; } }
  let second = 0;
  for (const b of votes.keys()) if (Math.abs(b - best) > 3) second = Math.max(second, sum(b));
  return { pos: best * 64, share: bv / asked, second: second / asked };
}
const located = (r) => r && r.pos != null && r.share >= 0.25 && r.second <= r.share / 2;
/** Fit a located page in its window: the matched VRI span [start, end). */
function fitAt(Q, C, r) {
  const a = Math.max(0, r.pos - 600), b = Math.min(C.L.length, r.pos + Q.length + 600);
  const f = fitAlign(Q, C.L.slice(a, b));
  return { start: a + f.start, end: a + f.end, d: f.d };
}

// ── books ───────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = (await db.collection('books').find({ $or: [{ language: /pali|pāli/i }, { original_language: /pali|pāli/i }, { languages: /pali|pāli/i }] }, { projection: { _id: 0, id: 1, title: 1, language: 1, published: 1, year: 1, pages_count: 1, visible: 1, 'image_source.provider': 1 } }).toArray())
  .filter((b) => !/^english$/i.test(b.language || '')).sort((a, b) => a.id.localeCompare(b.id));
console.log(`${books.length} Pali-text books (English translations excluded)`);
const PROJ = { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, image_width: 1, image_height: 1, script_type: 1 };
const out = [];
for (const book of books) {
  const base = { book_id: book.id, title: String(book.title || '').slice(0, 80), language: book.language, visible: !!book.visible, provider: book.image_source?.provider || null, period: periodOf(book.published, book.year), period_src: 'books.published', at: new Date().toISOString() };
  const withText = (await db.collection('pages').find({ book_id: book.id, 'ocr.data': { $type: 'string' } }, { projection: { _id: 0, page_number: 1 } }).toArray()).map((p) => p.page_number).sort((a, b) => a - b);
  const n = book.pages_count || withText.length;
  const pool = withText.filter((pn) => isInterior(pn, n));
  if (pool.length < 3) { out.push({ ...base, status: 'no-ocr' }); continue; }
  const rng = makeRng(seedOf(book.id));
  const tried = [];
  let rec = null;
  for (let t = 0; t < TRIES && !rec; t++) {
    const pn = pool[Math.floor(rng() * pool.length)];
    if (tried.includes(pn)) continue;
    tried.push(pn);
    const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $in: [pn - 1, pn, pn + 1] } }, { projection: PROJ }).toArray();
    const at = (k) => pages.find((p) => p.page_number === k);
    const p = at(pn);
    const sc = scriptOf(bodyText(p.ocr.data));
    if (!sc) continue;
    const C = corpus(sc);
    const Q = norm(p.ocr.data, sc);
    const Qa = at(pn - 1)?.ocr?.data ? norm(at(pn - 1).ocr.data, sc) : '', Qb = at(pn + 1)?.ocr?.data ? norm(at(pn + 1).ocr.data, sc) : '';
    const r = locate(Q, C), ra = Qa.length > 200 ? locate(Qa, C) : null, rb = Qb.length > 200 ? locate(Qb, C) : null;
    let ref = null, leaf = null, expected = null;
    if (located(ra) && located(rb)) {
      const fa = fitAt(Qa, C, ra), fb = fitAt(Qb, C, rb);
      const gap = fb.start - fa.end;
      if (gap >= Q.length * 0.3 && gap <= Math.max(Q.length * 3, 400)) { ref = [fa.end, fb.start]; leaf = 'neighbours'; expected = gap; }
    }
    if (!ref && located(r)) { const f = fitAt(Q, C, r); ref = [f.start, f.end]; leaf = 'own'; }
    if (!ref) continue;
    const W = C.L.slice(Math.max(0, ref[0] - (leaf === 'own' ? 300 : 60)), ref[1] + (leaf === 'own' ? 300 : 60));
    const s = bodyCer(Q, W, { expected });
    rec = {
      ...base, status: 'scored', primary: true, page_id: p.id, page_number: pn, tries: tried.length,
      engine: engineOf(p.ocr), model: p.ocr.model || null, ocr_source: p.ocr.source || null,
      kind: kindOf(p.script_type, book.provider === 'manchester' ? 'handwritten' : 'printed'), script_type: p.script_type || null,
      res_band: resBand(p.image_width, p.image_height), long_edge: Math.max(p.image_width || 0, p.image_height || 0) || null,
      ref: 'vri-cscd', ref_edition: `VRI Chaṭṭha Saṅgāyana (CSCD) ${sc} XML, ${fileOf(C, ref[0])}`, ref_repo: 'vipassanatech/tipitaka-xml', ref_sha: VRI_SHA,
      ref_span: ref, ref_pts_pages: ptsIn(C, ref[0], ref[1]).slice(0, 4), leaf,
      match: { share: r ? +r.share.toFixed(3) : null, second: r ? +r.second.toFixed(3) : null, neighbours_located: [located(ra), located(rb)], confidence: leaf === 'neighbours' ? 'high' : located(r) && r.share >= 0.5 ? 'medium' : 'low' },
      script: sc === 'romn' ? 'latin' : sc === 'deva' ? 'devanagari' : 'sinhala', normaliser: `pali-${sc}+niggahita-m+apparatus-dropped@${NORMALISER_VERSION}`,
      q_chars: s.q_chars, expected, span: s.span, d: s.d, omitted: s.omitted, cer: +s.cer.toFixed(4), catastrophic: s.cer > CATASTROPHIC_CER,
    };
  }
  out.push(rec || { ...base, status: 'no-vri-match', tries: tried });
  const last = out[out.length - 1];
  console.log(`${book.id} ${last.status} ${last.leaf || ''} ${last.cer ?? ''} ${base.title.slice(0, 40)}`);
}
fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('status', JSON.stringify(out.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})));
await client.close();
