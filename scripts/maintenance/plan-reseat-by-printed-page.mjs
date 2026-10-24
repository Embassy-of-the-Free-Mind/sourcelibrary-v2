#!/usr/bin/env node
/**
 * Plan a text re-seat from the printed page numbers read off the IMAGES (#5803, BPH `6988a59*`).
 *
 * PRIOR ART: scripts/maintenance/repair-text-permutation.mjs — the writer this feeds; it takes a map
 *   { book, issue, method, rows: [{ page, src, check }] } and refuses rows without a check. For Schutzschrift (#6659)
 *   the map was built by hand and every leaf read by eye. scripts/eval/jev/clef-book-offset-map.mjs maps ±1 shifts only.
 *   This file builds the map for the other books of the batch, where reading 6,700 leaves by eye is not possible, and
 *   puts TWO independent signals on every row instead.
 *
 * Signals, both read from the image by scripts/audit/printed-page-image-read.mjs, compared with the stored text:
 *   1. printed page: the image's printed number equals the text's <page-num>;
 *   2. first line: most words of the image's first body line are in the opening of that text (or, on an unnumbered
 *      leaf, one text clearly wins on the first line alone).
 * A row is written only when the leaf's assigned text is a DIFFERENT page and the signals agree. A leaf whose own
 * text already matches is left alone. Read-only: writes map files and a summary, touches no store.
 *
 * A book is APPLY-READY only when the plan is closed: every page whose text moves away receives a text (or is one of
 * at most --max-clear pages cleared because no text for it exists), and no text lands on two leaves. Otherwise
 * the book is reported, not mapped. One text on two leaves is allowed only when both leaves read the SAME printed
 * page: the same leaf photographed twice, as in Schutzschrift (#6659); the writer copies the text to both.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/plan-reseat-by-printed-page.mjs \
 *     --reads=<printed-pages.jsonl> --out-dir=<dir> [--max-clear=0.1]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const READS = opt('reads');
const OUT = opt('out-dir');
const MAX_CLEAR = Number(opt('max-clear', 0.1)); // share of the book's leaves that may be cleared
const ISSUE = 5803;
const TODAY = new Date().toISOString().slice(0, 10);
if (!READS || !OUT) { console.error('usage: --reads=<jsonl> --out-dir=<dir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const META_TAGS = ['scan-quality', 'language', 'script', 'page-type', 'page-num', 'header', 'meta', 'vocab', 'warning', 'sig', 'margin', 'note', 'image-desc', 'gloss', 'insert', 'catchword', 'footer'];
export function textBody(ocr) {
  let t = String(ocr ?? '');
  for (const tag of META_TAGS) t = t.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'g'), ' ');
  return t.replace(/<[^>]+>/g, ' ').replace(/->|<-|[#*_|]/g, ' ').replace(/\s+/g, ' ').trim();
}
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ſ/g, 's').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Share of the image line's words (≥3 letters) found among the first 80 words of the text body. */
const headCache = new Map(); // body → its first 80 folded words (the unnumbered pass scores every text per leaf)
export function firstLineScore(line, body) {
  const words = fold(line).split(' ').filter((w) => w.length >= 3);
  if (words.length < 2) return null;
  let head = headCache.get(body);
  if (!head) { head = new Set(fold(body).split(' ').slice(0, 80)); headCache.set(body, head); }
  return words.filter((w) => head.has(w)).length / words.length;
}
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
export function pageKey(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/^(p\.|pag\.|page|s\.|seite|f\.|fol\.)\s*/, '').replace(/[.\s]+$/, '');
  if (/^\d{1,4}$/.test(t)) return String(Number(t));
  if (/^[ivxlcdm]{1,8}$/.test(t)) { let n = 0; for (let i = 0; i < t.length; i++) { const v = ROMAN[t[i]], w = ROMAN[t[i + 1]] || 0; n += v < w ? -v : v; } return `r${n}`; }
  return null;
}
const textPageNum = (ocr) => { const m = String(ocr ?? '').match(/<page-num>([^<]*)<\/page-num>/); return m ? pageKey(m[1]) : null; };

const reads = new Map();
for (const l of fs.readFileSync(READS, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.error) continue;
  reads.set(`${r.book_id}:${r.page_number}`, r);
}
const bookIds = [...new Set([...reads.values()].map((r) => r.book_id))];

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const summary = [];
for (const id of bookIds) {
  const book = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, hidden_reason: 1 } });
  // page_number < 1 are unnumbered extras the writer does not touch (repair-text-permutation reads >= 1).
  const pages = await db.collection('pages').find({ book_id: id, page_number: { $gte: 1 } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const texts = pages.map((p) => ({ n: p.page_number, key: textPageNum(p.ocr?.data), body: textBody(p.ocr?.data) })).filter((t) => t.body.length > 40);
  const byKey = new Map();
  for (const t of texts) if (t.key) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push(t); }
  const own = new Map(texts.map((t) => [t.n, t]));

  const placed = new Map(); // leaf → { src, key, own, check }: own = the leaf keeps its own text
  const stat = { leaves: pages.length, read: 0, own_ok: 0, moved: 0, interpolated: 0, conflicts_dropped: 0, unsure: 0, blank: 0, no_text: 0 };
  const isBlank = (n) => !!reads.get(`${id}:${n}`)?.blank;
  for (const p of pages) {
    const r = reads.get(`${id}:${p.page_number}`);
    if (!r) continue;
    stat.read++;
    if (r.blank) { stat.blank++; continue; }
    const key = pageKey(r.printed_page);
    const ownText = own.get(p.page_number);
    const ownScore = ownText ? firstLineScore(r.first_line, ownText.body) : null;
    // 1. the leaf's own text already belongs here
    if (ownText && ((key && ownText.key === key && ownScore !== null && ownScore >= 0.5) || (ownScore !== null && ownScore >= 0.8))) { placed.set(p.page_number, { src: p.page_number, key, own: true }); continue; }
    // 2. a text carrying this printed number whose opening matches the image's first line
    let best = null;
    for (const t of key ? byKey.get(key) || [] : []) {
      const s = firstLineScore(r.first_line, t.body);
      if (s !== null && s >= 0.5 && (!best || s > best.s)) best = { t, s, how: `printed p.${r.printed_page} = text <page-num>; first line ${s.toFixed(2)}` };
    }
    // 3. unnumbered leaf: one text clearly wins on the first line alone
    if (!best && !key && r.first_line) {
      const scored = texts.map((t) => ({ t, s: firstLineScore(r.first_line, t.body) ?? 0 })).sort((a, b) => b.s - a.s);
      if (scored[0] && scored[0].s >= 0.8 && scored[0].s - (scored[1]?.s ?? 0) >= 0.3) best = { t: scored[0].t, s: scored[0].s, how: `unnumbered; first line ${scored[0].s.toFixed(2)}, next best ${(scored[1]?.s ?? 0).toFixed(2)}` };
    }
    if (!best) continue;
    placed.set(p.page_number, { src: best.t.n, key, own: best.t.n === p.page_number, check: `flash-lite image read (${r.prompt_version}) ${TODAY}: ${best.how}` });
  }

  // Conflicts: one text on two leaves is a duplicate photograph only if both leaves read the same printed page.
  const groupBySrc = () => { const g = new Map(); for (const [leaf, a] of placed) { if (!g.has(a.src)) g.set(a.src, []); g.get(a.src).push(leaf); } return g; };
  for (const [, leaves] of groupBySrc()) {
    if (leaves.length < 2) continue;
    const keys = leaves.map((l) => placed.get(l).key);
    if (keys.some((k) => !k) || new Set(keys).size > 1) for (const l of leaves) if (!placed.get(l).own) { placed.delete(l); stat.conflicts_dropped++; }
  }

  // Interpolation: a leaf between two placed leaves of one consistent run (src rises one per leaf) takes the text the
  // run predicts, if that text is unused and the image agrees with it on the printed page or the first line.
  for (let changed = true; changed;) {
    changed = false;
    const used = new Set([...placed.values()].map((a) => a.src));
    for (const p of pages) {
      const L = p.page_number;
      if (placed.has(L) || isBlank(L) || !reads.has(`${id}:${L}`)) continue;
      let P = null, N = null;
      for (let d = 1; d <= 3 && P === null; d++) if (placed.has(L - d)) P = L - d;
      for (let d = 1; d <= 3 && N === null; d++) if (placed.has(L + d)) N = L + d;
      if (P === null || N === null) continue;
      const sp = placed.get(P).src, sn = placed.get(N).src;
      if (sn - sp !== N - P) continue;
      const S = sp + (L - P);
      const t = own.get(S);
      if (!t || (used.has(S) && S !== L)) continue;
      const r = reads.get(`${id}:${L}`);
      const key = pageKey(r.printed_page);
      const score = firstLineScore(r.first_line, t.body);
      const keyOk = !!key && t.key === key;
      // Eye check 2026-10-24: a run can skip a page (leaf 94 of Séances took p.73 for p.74), and a blank leaf's
      // show-through reads as a first line. So the printed numbers must not disagree, and without one the first
      // line has to be strong.
      if (key && t.key && !keyOk) continue;
      if (!(keyOk || (score !== null && score >= 0.8))) continue;
      placed.set(L, { src: S, key, own: S === L, interpolated: true, check: `flash-lite image read (${r.prompt_version}) ${TODAY}: interpolated in the run p${P}←${sp} … p${N}←${sn}; ${keyOk ? `printed p.${r.printed_page} agrees; ` : ''}first line ${score === null ? 'n/a' : score.toFixed(2)}` });
      used.add(S);
      changed = true;
    }
  }

  const assign = new Map([...placed].filter(([, a]) => !a.own));
  stat.own_ok = [...placed.values()].filter((a) => a.own).length;
  stat.moved = assign.size;
  stat.interpolated = [...placed.values()].filter((a) => a.interpolated).length;
  for (const p of pages) if (reads.has(`${id}:${p.page_number}`) && !isBlank(p.page_number) && !placed.has(p.page_number)) { if (own.has(p.page_number)) stat.unsure++; else stat.no_text++; }

  // Closure: a text moved away from a leaf must be replaced there, or that leaf shows a second copy of it.
  const srcs = new Map();
  for (const [leaf, a] of assign) { if (!srcs.has(a.src)) srcs.set(a.src, []); srcs.get(a.src).push(leaf); }
  const copies = [...srcs].filter(([s, ls]) => ls.length > 1 || placed.get(s)?.own).length;
  const doubled = [];
  const vacated = [...srcs.keys()].filter((s) => !placed.has(s));
  // A vacated leaf is fine when its image was read and matched no text at all (its own text was never produced).
  const vacatedUnread = vacated.filter((s) => !reads.has(`${id}:${s}`));
  const rows = [...assign].map(([page, { src, check }]) => ({ page, src, check }));
  for (const s of vacated) rows.push({ page: s, src: null, check: `vacated: its text moved to leaf ${srcs.get(s).join(',')}, and no stored text matched this leaf's image (printed page ${reads.get(`${id}:${s}`)?.printed_page ?? 'unread'})` });
  rows.sort((a, b) => a.page - b.page);
  // A book whose leaves mostly carry their own text is NOT block-permuted. Its few "moves" were mostly false on the
  // eye check (repeated page numbers across a preface, sections and main text), so it is reported, never mapped.
  const permuted = stat.own_ok < 0.5 * (stat.own_ok + stat.moved);
  const ready = permuted && !book.hidden_reason && rows.length > 0 && !doubled.length && !vacatedUnread.length && vacated.length <= MAX_CLEAR * pages.length;
  const why = !permuted && rows.length ? `not permuted (${stat.own_ok} leaves already match): report only` : book.hidden_reason ? `hidden_reason=${book.hidden_reason}` : !rows.length ? 'nothing to move' : doubled.length ? `text on two leaves: ${doubled.slice(0, 5).join(' ')}` : vacatedUnread.length ? `vacated leaves not read: ${vacatedUnread.slice(0, 8).join(',')}` : vacated.length > MAX_CLEAR * pages.length ? `${vacated.length} leaves would be cleared` : 'ready';
  const file = path.join(OUT, `reseat-${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ book: id, issue: ISSUE, method: 'Printed page number and first body line read off every image with gemini-3.1-flash-lite (scripts/audit/printed-page-image-read.mjs), matched to the stored text <page-num> and opening words (scripts/maintenance/plan-reseat-by-printed-page.mjs). Each row carries both signals; leaves whose own text already matches are not listed.', rows }, null, 1));
  summary.push({ id, title: String(book.title).slice(0, 40), ...stat, rows: rows.length, vacated: vacated.length, copies, doubled: doubled.length, ready, why });
}
await client.close();
console.table(summary.map(({ id, ...s }) => ({ id: id.slice(0, 12), ...s })));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
