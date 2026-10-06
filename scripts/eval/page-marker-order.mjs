#!/usr/bin/env node
// PRIOR ART: scripts/eval/folio-markers-5678* (results/folio-markers-5678) carries folio markers
// INTO the English, it does not read the printed sequence; scripts/audit has no page-order
// detector (looked: `ls scripts/audit scripts/maintenance | grep -i -E 'order|seq|pagin'`).
// src/components/reader/NotesRenderer.tsx reads <page-num> for display only — and #5699 shows
// <page-num> is invented on exactly the books this has to catch, so it is not used here.
/**
 * page-marker-order.mjs — the #5699 detector. READ-ONLY, $0, no model calls.
 *
 * Per book, read the PRINTED page marker of every SERVED page (page_number >= 0) from the OCR —
 * never from <page-num>:
 *   P  the number at the end (or, alone, the start) of the <header> running head; else a centred
 *      numeral line (`->צט<-`); else a bare numeral as the first or last body line.
 *   S  a number INSIDE the running head that is not the page number — the section counter
 *      (`MAQRÎZÎ. [CHAP. XXXIX, 14.]`), which ascends just like a page number.
 * Numerals: Western and Arabic-Indic/Persian digits, Hebrew letter numerals (only as a whole
 * token at the end of a head or alone on a line, letters in non-increasing value), Chinese
 * numerals (trailing run of a head, or alone on a line).
 *
 * Then, per channel, in storage order (page_number), after dropping isolated outliers (a marker
 * whose steps on BOTH sides are implausible — one misread digit):
 *   DESC  ≥3 consecutive plausible DESCENDING steps (a section stored back to front, #5699 Hebrew).
 *   SWAP  m[j+1] < m[j] inside an ascending context m[j-1] < m[j+1] < m[j] < m[j+2] (Maqrizi),
 *         all four within 8 storage pages.
 *   JUMP  an ascending step larger than Δstorage + 4 (≤ 60) between two consistent neighbours —
 *         printed pages missing from the scan. Reported, but weaker: a plate run, a second
 *         pagination or a misbound gathering read the same way.
 * A step a→b is "plausible" when |Δm| ≤ 2·Δstorage + 3.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/page-marker-order.mjs \
 *     [--books id1,id2] [--draw <draw.jsonl>] [--other-sample 1500] [--seed 5700] [--out <dir>]
 * Without --books: every live translated book whose language is right-to-left, CJK or
 * multi-language, plus a seeded sample of the rest (the denominator for the corpus share).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/paired-stats.mjs';

// ── numeral parsing ──────────────────────────────────────────────────────────────────────────
const HEB = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
export function parseHebrewNumeral(tok) {
  const t = String(tok).normalize('NFD').replace(/[֑-ׇ'"׳״`]/g, '');
  if (!t || t.length > 4 || !/^[א-ת]+$/.test(t)) return null;
  if (t === 'טו') return 15;
  if (t === 'טז') return 16;
  let sum = 0, prev = Infinity;
  for (const ch of t) {
    const v = HEB[ch];
    if (v === undefined || v > prev) return null; // must be non-increasing (ת may repeat)
    if (v === prev && v !== 400) return null;
    sum += v; prev = v;
  }
  if (/יה$|יו$/.test(t)) return null; // 15/16 are never written so
  return sum;
}
const ZH = { '〇': 0, '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const ZH_UNIT = { '十': 10, '百': 100, '千': 1000 };
export function parseChineseNumeral(tok) {
  const t = String(tok);
  if (!t || t.length > 8 || !/^[〇零一二兩三四五六七八九十百千]+$/.test(t)) return null;
  // positional form without units: 一二三 → 123
  if (!/[十百千]/.test(t)) return t.length <= 4 ? Number([...t].map(c => ZH[c]).join('')) : null;
  let total = 0, cur = 0;
  for (const c of t) {
    if (c in ZH) cur = ZH[c];
    else { total += (cur || 1) * ZH_UNIT[c]; cur = 0; }
  }
  return total + cur;
}
const DIGIT_MAP = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
export function parseDigits(tok) {
  const t = String(tok).replace(/[٠-٩۰-۹]/g, c => String(DIGIT_MAP[c]));
  if (!/^\d{1,4}$/.test(t)) return null;
  return Number(t);
}
/** Any numeral form, for a token standing ALONE (a centred line, a bare line, a head's last token). */
export function parseNumeralToken(tok) {
  const t = String(tok).trim().replace(/^[\[(\-–—.\s·*]+|[\])\-–—.\s·*:]+$/g, '').replace(/^(?:p\.|pag\.|s\.|f\.|fol\.)\s*/i, '');
  return parseDigits(t) ?? parseHebrewNumeral(t) ?? parseChineseNumeral(t);
}

// ── marker extraction ────────────────────────────────────────────────────────────────────────
const META_TAGS = /<(page-num|scan-quality|language|script|page-type|vocab|meta|sig|columns|warning|keywords|summary|image-desc|detected-images|abbrev|folio)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/** Markers for one page from its OCR head and tail. Returns { P, S, src }. */
export function pageMarkers(head, tail) {
  const out = { P: null, S: null, src: null };
  const hm = /<header(?:\s[^>]*)?>([\s\S]*?)<\/header>/i.exec(head || '');
  if (hm) {
    const header = hm[1].replace(/<[^>]+>/g, ' ').trim();
    // Section counter: the last number inside brackets/parentheses.
    const inner = [...header.matchAll(/[\[(]([^\])]*)[\])]/g)].map(m => m[1]).join(' ');
    const innerNums = [...inner.matchAll(/[0-9٠-٩۰-۹]{1,4}/g)].map(m => parseDigits(m[0])).filter(n => n !== null);
    if (innerNums.length) out.S = innerNums.at(-1);
    const outside = header.replace(/[\[(][^\])]*[\])]/g, ' ').trim();
    const toks = outside.split(/\s+/).filter(Boolean);
    // A number set off by dashes inside the head ("III, 2. — 52 — S. 116, 2") is the page.
    const dashed = /(?:^|\s)[—–-]\s*([0-9٠-٩۰-۹]{1,4})\s*[—–-](?:\s|$)/.exec(outside);
    // v2 (by-eye review): a trailing number that ends a REFERENCE is a verse/line/section, not a
    // page — "ENOCH 51. 3—52. 8", "LYSANDER, XXI. 4—XXII. 4", "S. 102, 10 — 105, 10.".
    // v5: any number or roman numeral right before it ("XXXIX. 1.—XLI. 8.", "1 IOH. 4, 13.").
    const refTail = toks.length > 1 && (/\d|[—–]/.test(toks.at(-2)) || /^[IVXLCDM]+[.,:]?$/i.test(toks.at(-2)));
    // Dictionary heads ("ד ה ד ו") are letters, not numerals.
    const letterHeads = toks.filter(t => /^[\u05D0-\u05EA]$/.test(t)).length >= 2;
    if (dashed) { out.P = parseDigits(dashed[1]); out.src = 'header'; }
    else if (toks.length) {
      const last = toks.at(-1);
      let v = refTail ? null : parseDigits(last.replace(/[.,:;·]+$/, ''));
      if (v === null && toks.length > 1 && !refTail && !letterHeads) v = parseHebrewNumeral(last);
      if (v === null) { // CJK: trailing numeral run, set off by a space or a page/leaf word
        const m = /(?:^|[\s頁葉页丁])([〇零一二兩三四五六七八九十百千]{1,6})$/.exec(outside);
        if (m) v = parseChineseNumeral(m[1]);
      }
      // A LEADING number is the page only when it is the head's only number ("162 COLOGNE."),
      // never a book or chapter ("1 IOH. 4, 13.", "4, 14. 1 IOH.").
      if (v === null && toks.length > 1 && /^[0-9٠-٩۰-۹]{1,4}\.?$/.test(toks[0]) && !/[0-9٠-٩۰-۹]/.test(toks.slice(1).join(' '))) v = parseDigits(toks[0].replace(/\.$/, ''));
      if (v === null && toks.length === 1 && !/^[\u05D0-\u05EA]$/.test(toks[0])) v = parseNumeralToken(toks[0]);
      if (v !== null) { out.P = v; out.src = 'header'; }
    }
  }
  if (out.P === null) {
    const c = /->\s*([^<\n]{1,12}?)\s*<-/.exec(head || '');
    const v = c ? parseNumeralToken(c[1]) : null;
    if (v !== null) { out.P = v; out.src = 'centred'; }
  }
  if (out.P === null) {
    // v4: a numeral inside <margin>/<note>/<gloss> is a marginal reference, not the page number.
    const lines = s => String(s || '').replace(META_TAGS, '').replace(/<(header|margin|note|gloss|insert)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '')
      .split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines(head)[0];
    const last = lines(tail).at(-1);
    for (const [l, src] of [[first, 'bare-first'], [last, 'bare-last']]) {
      if (!l || l.length > 12) continue;
      const v = parseNumeralToken(l);
      if (v !== null) { out.P = v; out.src = src; break; }
    }
  }
  return out;
}

// ── sequence analysis ────────────────────────────────────────────────────────────────────────
const plausible = (a, b) => Math.abs(b.m - a.m) <= 2 * (b.s - a.s) + 3;

/** A descending step that is evidence of reversed storage, not two unrelated numbers: either a
 *  short step (≤ 12 storage pages), or a long one whose slope is a reversed page run — the printed
 *  number falls one (or two, for spreads) per storage page. v4: by eye, "55:34 → 154:4" chains of
 *  verse and fragment numbers across a hundred pages were most of the remaining false flags. */
function descStep(a, b) {
  if (!(b.m < a.m) || !plausible(a, b)) return false;
  const ds = b.s - a.s, dm = b.m - a.m;
  if (ds <= 12) return true;
  const tol = 2 + 0.05 * ds;
  return Math.abs(dm + ds) <= tol || Math.abs(dm + 2 * ds) <= tol;
}

/** seq: [{s: storage page_number, m: marker}] sorted by s. Returns findings. */
export function analyseSequence(seq) {
  // Drop zero/huge values and isolated outliers (implausible on both sides).
  let xs = seq.filter(x => x.m > 0 && x.m < 5000);
  xs = xs.filter((x, i) => {
    const prev = xs[i - 1], next = xs[i + 1];
    const okPrev = prev ? plausible(prev, x) : null;
    const okNext = next ? plausible(x, next) : null;
    if (okPrev === false && okNext === false) return false;
    if (okPrev === null && okNext === false) return false;
    if (okNext === null && okPrev === false) return false;
    return true;
  });
  const findings = [];
  // DESC runs
  let run = [];
  const flush = () => {
    if (run.length >= 4) findings.push({ kind: 'DESC', from: run[0].s, to: run.at(-1).s, markers: run.map(x => `${x.s}:${x.m}`) });
    run = [];
  };
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i];
    if (descStep(a, b)) { if (!run.length) run.push(a); run.push(b); }
    else flush();
  }
  flush();
  for (let j = 1; j + 2 < xs.length; j++) {
    const [p, a, b, n] = [xs[j - 1], xs[j], xs[j + 1], xs[j + 2]];
    // v2: all four markers inside a short storage window — a "swap" between markers dozens of
    // pages apart was, by eye, two unrelated numbers.
    const local = n.s - p.s <= 8;
    if (local && a.src === b.src && b.m < a.m && p.m < b.m && a.m < n.m && plausible(a, b) && plausible(p, b) && plausible(a, n)) {
      findings.push({ kind: 'SWAP', from: a.s, to: b.s, markers: [p, a, b, n].map(x => `${x.s}:${x.m}`) });
    }
    const d = b.m - a.m;
    if (local && d > (b.s - a.s) + 4 && d <= 60 && p.m < a.m && plausible(p, a) && b.m < n.m && plausible(b, n)) {
      findings.push({ kind: 'JUMP', from: a.s, to: b.s, markers: [p, a, b, n].map(x => `${x.s}:${x.m}`), missing: d - (b.s - a.s) });
    }
  }
  return { n: xs.length, findings };
}

export function analyseBook(pages) {
  const P = [], S = [];
  const srcs = {};
  for (const pg of pages) {
    const mk = pageMarkers(pg.head, pg.tail);
    if (mk.P !== null) { P.push({ s: pg.page_number, m: mk.P, src: mk.src }); srcs[mk.src] = (srcs[mk.src] || 0) + 1; }
    if (mk.S !== null) S.push({ s: pg.page_number, m: mk.S, src: 'S' });
  }
  const p = analyseSequence(P), s = analyseSequence(S);
  const findings = [...p.findings.map(f => ({ ch: 'P', ...f })), ...s.findings.map(f => ({ ch: 'S', ...f }))];
  return {
    pages: pages.length, markers_P: p.n, markers_S: s.n, sources: srcs, findings,
    desc: findings.some(f => f.kind === 'DESC'), swap: findings.some(f => f.kind === 'SWAP'), jump: findings.some(f => f.kind === 'JUMP'),
  };
}

// ── runner ───────────────────────────────────────────────────────────────────────────────────
async function main() {
  const { MongoClient } = await import('mongodb');
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const OUT = arg('--out', 'scripts/eval/results/quality-census-2026-10');
  const RAW = arg('--raw', OUT);
  const SEED = Number(arg('--seed', 5700));
  fs.mkdirSync(RAW, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  let targets;
  if (arg('--books')) {
    targets = arg('--books').split(',').map(id => ({ book_id: id, stratum: 'control' }));
  } else {
    const draw = fs.readFileSync(arg('--draw'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const rtl = /hebrew|arabic|persian|farsi|syriac|yiddish|urdu|ottoman|aramaic|judeo|ladino|samaritan/i;
    const cjk = /chinese|japanese|korean|manchu|mongol/i;
    const bi = /[-,/&]| and |bilingual|multiple|polyglot/i;
    const strat = l => (rtl.test(l) ? 'rtl' : cjk.test(l) ? 'cjk' : bi.test(l) ? 'bilingual' : 'other');
    const all = draw.map(r => ({ book_id: r.book_id, language: r.language, title: r.title, pages_count: r.pages_count, stratum: strat(r.language || '') }));
    const rng = makeRng(SEED + 1);
    const other = all.filter(b => b.stratum === 'other').map(b => ({ b, u: rng() })).sort((x, y) => x.u - y.u)
      .slice(0, Number(arg('--other-sample', 1500))).map(x => x.b);
    targets = [...all.filter(b => b.stratum !== 'other'), ...other];
  }
  const FILE = path.join(RAW, 'page-order.jsonl');
  const done = new Set();
  if (fs.existsSync(FILE)) for (const l of fs.readFileSync(FILE, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).book_id);
  const todo = targets.filter(t => !done.has(t.book_id));
  console.error(`${targets.length} books; ${done.size} done; ${todo.length} to go`);
  const out = fs.createWriteStream(FILE, { flags: 'a' });
  let n = 0;
  const ocr = { $ifNull: ['$ocr.data', ''] };
  async function worker() {
    for (;;) {
      const t = todo.shift();
      if (!t) return;
      let pages;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          pages = await db.collection('pages').aggregate([
            // Served pages only: a negative page_number is a soft-hidden original spread (or a
            // hidden duplicate), numbered -n so it sorts in REVERSE — read naively it looks exactly
            // like a book stored back to front (v2 review: 9 of 16 "true" flags were this).
            { $match: { book_id: t.book_id, page_number: { $gte: 0 } } },
            { $sort: { page_number: 1 } },
            { $project: { _id: 0, page_number: 1, head: { $substrCP: [ocr, 0, 700] },
              tail: { $substrCP: [ocr, { $max: [0, { $subtract: [{ $strLenCP: ocr }, 800] }] }, 800] } } },
          ], { hint: { book_id: 1, page_number: 1 }, maxTimeMS: 300000 }).toArray();
          break;
        } catch (e) { console.error(`retry ${t.book_id}: ${e.message}`); await new Promise(r => setTimeout(r, 10000 * (attempt + 1))); }
      }
      if (!pages) continue;
      const r = analyseBook(pages);
      out.write(JSON.stringify({ ...t, ...r }) + '\n');
      if (++n % 200 === 0) console.error(`${n}/${n + todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: Number(arg('--concurrency', 4)) }, worker));
  out.end();
  await new Promise(r => out.on('finish', r));
  await client.close();
  console.error('done');
}
/** --summarise <page-order.jsonl> --draw <draw.jsonl>: per-stratum and per-language flag rates,
 *  the "other" sample scaled to its stratum, and the flagged books with their sections. */
function summarise(file, drawFile, outFile) {
  const R = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const draw = new Map(fs.readFileSync(drawFile, 'utf8').split('\n').filter(Boolean).map(l => { const d = JSON.parse(l); return [d.book_id, d]; }));
  const popByStratum = {};
  const rtl = /hebrew|arabic|persian|farsi|syriac|yiddish|urdu|ottoman|aramaic|judeo|ladino|samaritan/i, cjk = /chinese|japanese|korean|manchu|mongol/i, bi = /[-,/&]| and |bilingual|multiple|polyglot/i;
  for (const d of draw.values()) { const l = d.language || ''; const s = rtl.test(l) ? 'rtl' : cjk.test(l) ? 'cjk' : bi.test(l) ? 'bilingual' : 'other'; (popByStratum[s] ||= { books: 0, pages_translated: 0 }); popByStratum[s].books++; popByStratum[s].pages_translated += d.pages_translated || 0; }
  const flag = r => r.desc || r.swap;
  const strata = {};
  for (const r of R) {
    const s = (strata[r.stratum] ||= { scanned: 0, with_10_markers: 0, flagged: 0, desc: 0, swap: 0, jump_only: 0, flagged_pages_translated: 0, section_pages: 0 });
    s.scanned++; if (r.markers_P >= 10 || r.markers_S >= 10) s.with_10_markers++;
    if (r.desc) s.desc++; if (r.swap) s.swap++; if (r.jump && !flag(r)) s.jump_only++;
    if (flag(r)) {
      s.flagged++; s.flagged_pages_translated += draw.get(r.book_id)?.pages_translated || 0;
      const covered = new Set();
      for (const f of r.findings) if (f.kind !== 'JUMP') for (let p = f.from; p <= f.to; p++) covered.add(p);
      s.section_pages += covered.size;
    }
  }
  for (const [k, s] of Object.entries(strata)) {
    const pop = popByStratum[k] || { books: s.scanned };
    s.population_books = pop.books; s.scale = pop.books / s.scanned;
    s.flagged_est_books = Math.round(s.flagged * s.scale);
  }
  const byLanguage = {};
  for (const r of R) { const l = r.language || 'unknown'; const b = (byLanguage[l] ||= { scanned: 0, flagged: 0 }); b.scanned++; if (flag(r)) b.flagged++; }
  const flagged = R.filter(flag).map(r => ({ book_id: r.book_id, stratum: r.stratum, language: r.language, title: String(r.title || '').slice(0, 90), pages: r.pages,
    pages_translated: draw.get(r.book_id)?.pages_translated ?? null, link: `https://sourcelibrary.org/book/${r.book_id}`,
    sections: r.findings.filter(f => f.kind !== 'JUMP').map(f => `${f.ch}${f.kind} ${f.from}-${f.to}: ${f.markers.slice(0, 6).join(' ')}`) }));
  const out = { generated_at: new Date().toISOString(), strata, by_language: Object.fromEntries(Object.entries(byLanguage).filter(([, v]) => v.flagged).sort((a, b) => b[1].flagged - a[1].flagged)), flagged };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.strata, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--summarise');
  if (i >= 0) {
    const a = process.argv;
    summarise(a[i + 1], a[a.indexOf('--draw') + 1], a[a.indexOf('--out') + 1]);
  } else await main();
}
