#!/usr/bin/env node
/**
 * PRIOR ART: scripts/lib/sefaria-fit.mjs + scripts/import/sefaria-fit-5560.mjs (#5560) — the
 * neighbour-anchor fit this reuses unchanged: k-gram offset voting (`locate`), semi-global edge
 * alignment (`fitEnd`, `anchorAt`), the order-free letter-4-gram score with shifted and far
 * wrong-page controls (`gramBag`, `containment`), and the pre-registered `FIT_RULES` v1 / `fitClass`.
 * It does not fit as-is: its normaliser and stream builder are Hebrew-only (`normHe`, `buildStream`
 * keep א–ת), its texts come from Sefaria exports, and its targets are pages with NO text. Here the
 * pages all carry a (garbled) Flash reading, the editions are TEI (First1KGreek / Perseus) or
 * public-domain print editions we hold, and the question is measurement (located / drift / edges),
 * not a write. scripts/eval/build-greek-corpus.mjs (#4925) flattens the TEI corpus this searches;
 * its `foldGreekWord` is the fold used here, applied per letter so offsets stay exact.
 * scripts/eval/lib/edition-window.mjs cuts reference windows by WORDS for a CER benchmark on print;
 * it does not locate a page between neighbours.
 *
 * #5619 steps 2–3 — fit an open published edition to Greek MANUSCRIPT scans. Measurement only:
 * reads Mongo and local files, writes only under --work. Nothing is written to pages/books.
 *
 *   node --env-file=.env.production.local scripts/eval/greek-ms-fit-5619.mjs search --books <id,id> [--per-book N]
 *   node --env-file=.env.production.local scripts/eval/greek-ms-fit-5619.mjs search --census <books.json> --per-book 5
 *   node --env-file=.env.production.local scripts/eval/greek-ms-fit-5619.mjs fit --book <id> --edition held:<bookId>[,held:…] | tei:<urn>[,…] [--null <id,id>]
 *
 * search: every page's folded letters → distinct 9-grams; one pass over every flattened TEI edition
 *   (and any --held editions) counts, per page, the share of its 9-grams each edition contains.
 *   The best edition must beat the runner-up and a chance level (the median edition) to count.
 * fit: per page (scan image), on the page's OWN stored reading:
 *   located   = whole-page 7-gram voting share ≥ the 99th percentile of the same share for pages of
 *               OTHER books (--null) in this edition, AND monotone with its located neighbours.
 *   edges     = its first / last 150 letters aligned semi-globally (anchorAt), accepted at ≥ 0.45
 *               identity and ≥ 0.12 above chance (FIT_RULES v1 anchorIdentity / anchorMargin).
 *   boundary  = start(N+1) − end(N) for consecutive pages with confident edges (0 = the two pages
 *               meet exactly in the edition; > 0 a gap, < 0 an overlap).
 *   neighbour = the #5560 method as if page N had no text: span [end(N−1), start(N+1)], scored
 *               against page N's own reading with shift ±1…3 and far controls → fitClass verdict;
 *               and its edge error against page N's own edges.
 *   drift     = predicting a page's start from an anchor k pages back by the median advance:
 *               error in page-lengths, for k = 1, 5, 20.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { buildIndex, locate, anchorAt, fitEnd, gramBag, containment, FIT_RULES, fitClass } from '../lib/sefaria-fit.mjs';
import { bodyText } from '../import/sefaria-fit-5560.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const WORK = val('work', '/mnt/HC_Volume_105839809/greek-ms-align-5619');
const EDITIONS = path.join(WORK, 'editions');
const FLAT = path.join(EDITIONS, 'flat');
const TEI_REPOS = [
  { name: 'First1KGreek', dir: path.join(EDITIONS, 'First1KGreek-master'), url: 'https://github.com/OpenGreekAndLatin/First1KGreek' },
  { name: 'Perseus canonical-greekLit', dir: path.join(EDITIONS, 'canonical-greekLit-master'), url: 'https://github.com/PerseusDL/canonical-greekLit' },
];
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// ── Greek fold (matching only, never stored) ──
const VARIANT = { 'ς': 'σ', 'ϲ': 'σ', 'ϐ': 'β', 'ϑ': 'θ', 'ϕ': 'φ', 'ϖ': 'π', 'ϱ': 'ρ', 'ϰ': 'κ', 'ϒ': 'υ' };
/** One character → its folded Greek base letter, or '' (diacritics stripped, lowercased, sigma variants folded). */
export function foldGreekChar(c) {
  const b = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (b.length !== 1) return '';
  const v = VARIANT[b] || b;
  return /[α-ω]/.test(v) ? v : '';
}
export const greekLetters = (text) => { let o = ''; for (const c of String(text || '').normalize('NFC')) o += foldGreekChar(c); return o; };

/** Segments → one matchable stream with exact back-mapping (the Greek twin of sefaria-fit buildStream). */
export function buildGreekStream(segments) {
  const letters = [], seg = [], off = [];
  segments.forEach((s, si) => {
    const t = String(s.text || '').normalize('NFC');
    for (let i = 0; i < t.length; i++) { const f = foldGreekChar(t[i]); if (f) { letters.push(f); seg.push(si); off.push(i); } }
  });
  return { segments, letters: letters.join(''), seg: Int32Array.from(seg), off: Int32Array.from(off) };
}

// ── editions ──
const teiPath = (urn) => {
  const [g, w] = urn.split('.');
  for (const r of TEI_REPOS) { const f = path.join(r.dir, 'data', g, w, `${urn}.xml`); if (fs.existsSync(f)) return { file: f, repo: r }; }
  return null;
};
export function teiLicence(urn) {
  const p = teiPath(urn); if (!p) return null;
  const x = fs.readFileSync(p.file, 'utf8').slice(0, 20000);
  const m = x.match(/<licence[^>]*target="([^"]+)"[^>]*>([\s\S]*?)<\/licence>/) || x.match(/<licence[^>]*>([\s\S]*?)<\/licence>/);
  return { repo: p.repo.name, repo_url: p.repo.url, licence_url: m && m[2] ? m[1] : null, licence: (m ? (m[2] || m[1]) : 'none stated in TEI header').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
}
let INDEX = null;
const teiIndex = () => (INDEX ??= JSON.parse(fs.readFileSync(path.join(FLAT, 'index.json'), 'utf8')));

async function loadEdition(db, spec) {
  const [kind, id] = spec.split(':');
  if (kind === 'tei') {
    const lines = fs.readFileSync(path.join(FLAT, `${id}.txt`), 'utf8').split('\n');
    return { spec, label: `${teiIndex()[id]?.author} — ${teiIndex()[id]?.title} (${id})`, licence: teiLicence(id), segments: lines.map((t, i) => ({ ref: `${id} l.${i + 1}`, text: t })) };
  }
  const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, title: 1, published: 1, 'image_source.license': 1 } });
  const ps = await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  return { spec, label: `${b?.title} (${b?.published}, ${id})`, licence: { scan: b?.image_source?.license || null, text: 'our OCR of a public-domain print edition' },
    segments: ps.filter((p) => p.ocr?.data).map((p) => ({ ref: `${id} p${p.page_number}`, text: bodyText(p.ocr.data) })) };
}

async function bookPages(db, id) {
  return (await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 } }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, photo: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray())
    .map((p) => ({ id: p.id, page_number: p.page_number, image: p.archived_photo || p.photo, model: p.ocr?.model || null, body: p.ocr?.data ? bodyText(p.ocr.data) : '', q: p.ocr?.data ? greekLetters(bodyText(p.ocr.data)) : '' }));
}

// ── search: which open edition does each page come from? ──
async function search(db) {
  const K = 9;
  const per = Number(val('per-book', '0'));
  let ids = (val('books') || '').split(',').filter(Boolean);
  if (val('census')) ids = JSON.parse(fs.readFileSync(val('census'), 'utf8')).filter((r) => r.kind === 'manuscript' && (r.pages_ocr || 0) > 0).map((r) => r.id);
  const queries = [];
  for (const id of ids) {
    let ps = (await bookPages(db, id)).filter((p) => p.q.length >= 300);
    if (per) { const n = ps.length; ps = ps.filter((_, i) => i >= n * 0.15 && i <= n * 0.95); const step = Math.max(1, Math.floor(ps.length / per)); ps = ps.filter((_, i) => i % step === 0).slice(0, per); }
    for (const p of ps) queries.push({ book: id, page_number: p.page_number, grams: new Set(Array.from({ length: p.q.length - K + 1 }, (_, i) => p.q.slice(i, i + K))) });
  }
  log(`search: ${queries.length} pages from ${ids.length} books`);
  const gramTo = new Map();
  queries.forEach((q, qi) => { for (const g of q.grams) { const a = gramTo.get(g); if (a) a.push(qi); else gramTo.set(g, [qi]); } });
  const hits = queries.map(() => new Map()); // edition → distinct grams hit
  // WINDOW share: the most of a page's distinct grams that fall inside ONE 6,000-letter stretch of the
  // edition (two adjacent 3,000-letter buckets). A large edition contains many of any page's common
  // grams scattered through it (the Suda "won" 135 of Vat.gr.12's 257 pages on plain share, and
  // Vat.gr.12 is at chance in it, fit --tag suda); the right edition concentrates them in one place.
  const W = 3000;
  const win = queries.map(() => new Map()); // edition → best window share
  const stamp = new Map();
  const wstamp = new Map();
  const eds = Object.keys(teiIndex()).map((u) => ({ spec: `tei:${u}`, file: path.join(FLAT, `${u}.txt`) }));
  for (const h of (val('held') || '').split(',').filter(Boolean)) eds.push({ spec: `held:${h}` });
  let ei = 0;
  for (const e of eds) {
    const letters = e.file ? greekLetters(fs.readFileSync(e.file, 'utf8')) : buildGreekStream((await loadEdition(db, e.spec)).segments).letters;
    const cnt = new Map();
    for (let i = 0; i + K <= letters.length; i++) {
      const g = letters.slice(i, i + K);
      const qs = gramTo.get(g); if (!qs) continue;
      const bk = Math.floor(i / W), wk = ei * 1e5 + bk;
      if (wstamp.get(g) !== wk) { wstamp.set(g, wk); for (const qi of qs) { const key = qi * 1e5 + bk; cnt.set(key, (cnt.get(key) || 0) + 1); } }
      if (stamp.get(g) === ei) continue; stamp.set(g, ei);
      for (const qi of qs) hits[qi].set(e.spec, (hits[qi].get(e.spec) || 0) + 1);
    }
    const bestW = new Map();
    for (const [key, c] of cnt) { const qi = Math.floor(key / 1e5), bk = key % 1e5; const v = c + (cnt.get(key + 1) || 0); if (v > (bestW.get(qi) || 0)) bestW.set(qi, v); }
    for (const [qi, v] of bestW) win[qi].set(e.spec, v);
    ei++;
    if (ei % 300 === 0) log(`  ${ei}/${eds.length} editions`);
  }
  const out = queries.map((q, qi) => {
    const r = [...hits[qi].entries()].map(([s, n]) => [s, n / q.grams.size]).sort((a, b) => b[1] - a[1]);
    const w = [...win[qi].entries()].map(([s, n]) => [s, n / q.grams.size]).sort((a, b) => b[1] - a[1]);
    return { book: q.book, page_number: q.page_number, grams: q.grams.size, top: r.slice(0, 3).map(([s, x]) => ({ edition: s, share: +x.toFixed(3) })),
      top_window: w.slice(0, 3).map(([s, x]) => ({ edition: s, share: +x.toFixed(3) })) };
  });
  const f = path.join(WORK, `search-${val('tag', 'pages')}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  log(`search → ${f}`);
}

// ── fit ──
function scoreFit(readLetters, stream, a, b, far, k = 4) {
  const L = b - a;
  const R = gramBag(readLetters, k);
  const at = (x) => (x < 0 || x + L > stream.letters.length ? null : gramBag(stream.letters.slice(x, x + L), k));
  const f = (S) => { if (!S) return null; const p = containment(R, S), r = containment(S, R); return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }; };
  const by = {};
  for (const d of [-3, -2, -1, 0, 1, 2, 3]) { const m = f(at(a + d * L)); if (m) by[d] = m; }
  const farM = f(at(far));
  const ctrl = [...Object.entries(by).filter(([d]) => Math.abs(d) >= 2).map(([, m]) => m.f1), ...(farM ? [farM.f1] : [])];
  const best = Object.keys(by).map(Number).reduce((x, y) => (by[y].f1 > by[x].f1 ? y : x), 0);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { read_letters: readLetters.length, span_letters: L, precision: r3(by[0]?.p ?? 0), recall: r3(by[0]?.r ?? 0), f1: r3(by[0]?.f1 ?? 0),
    best_shift: best, control: r3(ctrl.length ? Math.max(...ctrl) : 0), by_shift: Object.fromEntries(Object.entries(by).map(([d, m]) => [d, r3(m.f1)])) };
}

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const med = (a) => pct(a, 0.5);

async function fit(db) {
  const id = val('book');
  const specs = val('edition').split(',');
  const eds = [];
  for (const s of specs) eds.push(await loadEdition(db, s));
  const segments = eds.flatMap((e, ei) => e.segments.map((s) => ({ ...s, ed: ei })));
  const stream = buildGreekStream(segments);
  const index = buildIndex(stream.letters, 7);
  const far = Math.floor(stream.letters.length / 2);
  log(`${id}: edition ${stream.letters.length} letters from ${eds.map((e) => e.label).join(' + ')}`);
  const pages = await bookPages(db, id);
  const text = pages.filter((p) => p.q.length >= FIT_RULES.minTextLetters);

  // Chance level: pages of OTHER books located in this edition.
  const nullShares = [];
  for (const nid of (val('null') || '').split(',').filter(Boolean)) {
    for (const p of (await bookPages(db, nid)).filter((x) => x.q.length >= FIT_RULES.minTextLetters)) nullShares.push(locate(p.q, index, { slack: 64 }).share);
  }
  const thr = nullShares.length ? pct(nullShares, 0.99) : 0.05;

  for (const t of text) { const r = locate(t.q, index, { slack: 64 }); t.s = r.pos; t.share = r.share; t.second = r.second; }
  // LOCATED is #5560's definition: the page's coarse position is in order with its text neighbours
  // (≥ 2 of up to 3 on each side; sefaria-fit-5560 monotoneAt). STRICT adds a share threshold from
  // other books' pages (this script's addition; measured too strict on Grec 1841 — pages at share
  // 0.013–0.022 fall in exact page order — so it is reported alongside, not used to gate).
  const cand = text.filter((t) => t.share >= thr);
  text.forEach((t, k) => {
    const before = text.slice(Math.max(0, k - 3), k), after = text.slice(k + 1, k + 4);
    const lt = before.filter((u) => u.s != null && u.s < t.s).length, gt = after.filter((u) => u.s != null && u.s > t.s).length;
    t.monotone = t.s != null && lt >= Math.min(2, before.length) && gt >= Math.min(2, after.length);
  });
  const located = text.filter((t) => t.monotone);
  const strict = located.filter((t) => t.share >= thr);

  // Own edges.
  const chanceOf = (q, side, pos) => {
    const piece = side === 'end' ? q.slice(-150) : q.slice(0, 150);
    const farAt = (pos + far) % Math.max(1, stream.letters.length - 800);
    const w = stream.letters.slice(farAt, farAt + 800);
    return side === 'end' ? fitEnd(piece, w).identity : fitEnd([...piece].reverse().join(''), [...w].reverse().join('')).identity;
  };
  for (const t of located) {
    for (const side of ['start', 'end']) {
      const a = anchorAt(t.q, index, stream, { side, lo: Math.max(0, t.s - 3000), hi: t.s + t.q.length + 3000 });
      const chance = a.pos == null ? 0 : chanceOf(t.q, side, a.pos);
      t[side] = a.pos != null && a.identity >= FIT_RULES.anchorIdentity && a.identity - chance >= FIT_RULES.anchorMargin ? { pos: a.pos, identity: +a.identity.toFixed(3), chance: +chance.toFixed(3) } : null;
      t[`${side}_raw`] = { pos: a.pos ?? null, identity: +(a.identity || 0).toFixed(3), chance: +chance.toFixed(3) };
    }
  }
  const byNum = new Map(pages.map((p, i) => [p.page_number, i]));
  const locByNum = new Map(located.map((t) => [t.page_number, t]));

  // Boundaries between consecutive pages (by page_number) with confident edges.
  const bounds = [];
  for (const t of located) {
    const n = locByNum.get(t.page_number + 1);
    if (n && t.end && n.start) bounds.push({ page: t.page_number, gap: n.start.pos - t.end.pos });
  }
  // Median letters per line of the book's readings (to express boundary error in lines).
  const lineLens = located.flatMap((t) => t.body.split('\n').map((l) => greekLetters(l).length).filter((x) => x >= 15));
  const perLine = med(lineLens) || 40;

  // The #5560 method on each page as if it had no text: neighbours' edges → span → verify with own reading.
  const neigh = [];
  for (const t of located) {
    const p = locByNum.get(t.page_number - 1), n = locByNum.get(t.page_number + 1);
    if (!p?.end || !n?.start) continue;
    const a = p.end.pos, b = n.start.pos;
    if (b - a < FIT_RULES.minTextLetters) { neigh.push({ page: t.page_number, verdict: 'edges', a, b }); continue; }
    const sc = scoreFit(t.q, stream, a, b, far);
    const sc6 = scoreFit(t.q, stream, a, b, far, 6);
    neigh.push({ page: t.page_number, a, b, verdict: fitClass(sc), verdict_k6: fitClass(sc6), score: sc, score_k6: sc6, start_err: t.start ? a - t.start.pos : null, end_err: t.end ? b - t.end.pos : null });
  }

  // Drift: predict start from an anchor k pages back by the median advance per page.
  const adv = [];
  for (const t of located) { const n = locByNum.get(t.page_number + 1); if (n && n.s > t.s) adv.push(n.s - t.s); }
  const mAdv = med(adv);
  const drift = {};
  for (const k of [1, 5, 20]) {
    const errs = [];
    for (const t of located) { const a = locByNum.get(t.page_number - k); if (a) errs.push(Math.abs(t.s - (a.s + k * mAdv)) / mAdv); }
    drift[`k${k}`] = { n: errs.length, within_half_page: errs.length ? +(errs.filter((e) => e <= 0.5).length / errs.length).toFixed(3) : null, median_err_pages: errs.length ? +med(errs).toFixed(2) : null };
  }
  const ratio = [];
  for (const t of located) { const n = locByNum.get(t.page_number + 1); if (n && n.s > t.s) ratio.push(t.q.length / (n.s - t.s)); }

  const vc = {}; for (const x of neigh) vc[x.verdict] = (vc[x.verdict] || 0) + 1;
  const vc6 = {}; for (const x of neigh) vc6[x.verdict_k6 || x.verdict] = (vc6[x.verdict_k6 || x.verdict] || 0) + 1;
  const absGap = bounds.map((b) => Math.abs(b.gap));
  const edgeErr = neigh.filter((x) => x.start_err != null && x.end_err != null).map((x) => Math.max(Math.abs(x.start_err), Math.abs(x.end_err)));
  const summary = {
    book: id, at: new Date().toISOString(), editions: eds.map((e) => ({ spec: e.spec, label: e.label, licence: e.licence, segments: e.segments.length })), edition_letters: stream.letters.length,
    rules: { ...FIT_RULES, locate_k: 7, locate_threshold: +thr.toFixed(3), null_pages: nullShares.length, null_p99: nullShares.length ? +pct(nullShares, 0.99).toFixed(3) : null, null_max: nullShares.length ? +Math.max(...nullShares).toFixed(3) : null },
    pages: pages.length, text_pages: text.length, above_threshold: cand.length, located: located.length, located_share_of_text: text.length ? +(located.length / text.length).toFixed(3) : 0,
    located_strict: strict.length, located_strict_share: text.length ? +(strict.length / text.length).toFixed(3) : 0,
    with_start_edge: located.filter((t) => t.start).length, with_end_edge: located.filter((t) => t.end).length,
    boundaries: { n: bounds.length, letters_per_line: perLine, median_abs_gap: med(absGap), within_150: bounds.length ? +(absGap.filter((g) => g <= 150).length / bounds.length).toFixed(3) : null, within_1_line: bounds.length ? +(absGap.filter((g) => g <= perLine).length / bounds.length).toFixed(3) : null, gaps: bounds.filter((b) => b.gap > perLine).length, overlaps: bounds.filter((b) => b.gap < -perLine).length },
    neighbour_method: { n: neigh.length, verdicts: vc, verdicts_k6: vc6, edge_err_median: med(edgeErr), edge_err_within_1_line: edgeErr.length ? +(edgeErr.filter((e) => e <= perLine).length / edgeErr.length).toFixed(3) : null },
    drift, median_advance_letters: mAdv, page_to_text_ratio: ratio.length ? +med(ratio).toFixed(2) : null,
  };
  const out = { summary, pages: text.map((t) => ({ page_number: t.page_number, image: t.image, model: t.model, letters: t.q.length, s: t.s, share: +t.share.toFixed(3), monotone: !!t.monotone, located: located.includes(t), start: t.start || null, end: t.end || null, start_raw: t.start_raw, end_raw: t.end_raw, ref: t.s != null ? segments[stream.seg[Math.min(t.s, stream.seg.length - 1)]]?.ref : null })), boundaries: bounds, neighbour: neigh };
  const f = path.join(WORK, `fit-${id}-${val('tag', 'run')}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  log(`fit → ${f}`);
}

// ── kraken: score independent (non-generative) Kraken greek-cllg reads of sampled pages against the
// span the neighbour method fitted, with the same controls as the Flash reading.
async function kraken(db) {
  const dir = path.join(WORK, 'kraken');
  const sample = JSON.parse(fs.readFileSync(path.join(dir, 'sample.json'), 'utf8'));
  const EDS = { caag: ['held:6994383a6879ff0184cb803a'], schneider: ['held:69942ffcbb14908bbd9a1123'] };
  const out = [];
  for (const tag of Object.keys(EDS)) {
    const segs = [];
    for (const s of EDS[tag]) segs.push(...(await loadEdition(db, s)).segments);
    const stream = buildGreekStream(segs);
    const far = Math.floor(stream.letters.length / 2);
    for (const x of sample.filter((y) => y.tag === tag)) {
      const f = path.join(dir, `${x.book}-${x.page}.txt`);
      const kl = fs.existsSync(f) ? greekLetters(fs.readFileSync(f, 'utf8')) : '';
      const fitRun = JSON.parse(fs.readFileSync(path.join(WORK, `fit-${x.book}-${tag}.json`), 'utf8'));
      const n = fitRun.neighbour.find((y) => y.page === x.page);
      const sc = scoreFit(kl, stream, x.a, x.b, far), sc6 = scoreFit(kl, stream, x.a, x.b, far, 6);
      out.push({ tag, page: x.page, kraken_letters: kl.length, kraken: { verdict: fitClass(sc), verdict_k6: fitClass(sc6), f1: sc.f1, control: sc.control, best_shift: sc.best_shift, f1_k6: sc6.f1, control_k6: sc6.control },
        flash: { verdict: n?.verdict, verdict_k6: n?.verdict_k6, f1: n?.score?.f1, control: n?.score?.control, f1_k6: n?.score_k6?.f1, control_k6: n?.score_k6?.control } });
    }
  }
  fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(out, null, 1));
  for (const o of out) console.log(JSON.stringify(o));
}

const COMMANDS = { search, fit, kraken };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} …`); process.exit(2); }
  await withMongo(async (db) => { await COMMANDS[cmd](db); }, { noTimeout: true });
}
