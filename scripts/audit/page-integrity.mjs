#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundaries.mjs — the mirror walk this copies (shard
// by file index, never Atlas `pages`); it measures where a TRANSLATION put text, not whether the
// scans are in order or whether a translation is short or echoed. The detectors live in
// scripts/lib/page-integrity.mjs (pure, tested).
/**
 * page-integrity — five exact checks over the local corpus mirror (~/sl-corpus/books/*.jsonl):
 * catchword continuity, printed page-number sequence, duplicate consecutive scans, truncated
 * translations, echoed source. MEASUREMENT ONLY: writes files, touches no store.
 *
 * Checkpointed per book: every book's lines (its flags, then one `book` row with its counts) are
 * appended in ONE write, and a restart skips every book that already has a `book` row in its
 * shard file. Kill it and run it again with the same arguments.
 *
 * Usage:
 *   node scripts/audit/page-integrity.mjs --calibrate [--every=20]   → <out>/calibration.json
 *   node scripts/audit/page-integrity.mjs [--shard=k/n] [--books=id,id | --books-file=f] [--limit=N]
 *        [--dir=~/sl-corpus/books] [--out=scripts/output/page-integrity]
 *   node scripts/audit/page-integrity.mjs --summarize              → <out>/summary.json
 *   node scripts/audit/page-integrity.mjs --report [--report-dir=scripts/eval/results] [--date=YYYY-MM-DD]
 *        → one repair-list file per defect class (for review; nothing is repaired)
 *
 * The truncation flag needs calibration.json (median translation/source length ratio per source
 * language); run --calibrate first. Flags: ratio / languageMedian < TRUNC_NORM_FLAG.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  catchwordBoundary, pageNumberBreaks, duplicateScan, truncationRatio, echoedSource, ocrReasoningLeak,
} from '../lib/page-integrity.mjs';
import { parseLanguageField, languageFamily } from '../lib/language-normalize.mjs';

export const TRUNC_NORM_FLAG = 0.5;
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);

/** The source language a page is written in: the OCR's own <language> tag, else the book's. */
export function pageLanguage(row, bookLang) {
  const m = String(row.ocr || '').match(/<(?:language|lang)>([^<]{1,40})<\/(?:language|lang)>/i);
  const first = parseLanguageField(m ? m[1] : bookLang)[0];
  return (languageFamily(first) || 'unknown').toLowerCase();
}

/** A book's rows in scan order. Pages at p ≤ 0 are soft-hidden (moved out of the reading order
 *  with their old text) — not scans a reader turns, so never part of a sequence. */
function readBook(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(r => r.p > 0).sort((a, b) => a.p - b.p);
}

/** All five signals for one book. Returns { lines } — flag rows then the book row. */
export function scanBook(id, rows, { bookLang = 'unknown', medians = null } = {}) {
  const lines = [];
  const bk = {
    kind: 'book', book: id, lang: bookLang, pages: rows.length, trPages: 0,
    catch: { pagesWithCw: 0, judged: 0, ok: 0, unjudged: {}, shapes: {} },
    pn: null,
    dup: { judged: 0, dup: 0 },
    trunc: { judged: 0, flagged: 0, byLang: {} },
    echo: { judged: 0, echo: 0, listLike: 0, unjudged: {} },
  };
  // 1. catchwords
  for (let i = 0; i < rows.length; i++) {
    const r = catchwordBoundary(rows, i);
    if (r == null) continue;
    bk.catch.pagesWithCw++;
    if (!r.judged) { bk.catch.unjudged[r.why] = (bk.catch.unjudged[r.why] || 0) + 1; continue; }
    bk.catch.judged++;
    if (r.ok) { bk.catch.ok++; continue; }
    bk.catch.shapes[r.shape] = (bk.catch.shapes[r.shape] || 0) + 1;
    lines.push({ kind: 'catch', book: id, p: rows[i].p, shape: r.shape, catchword: r.catchword, nextOpens: r.nextOpens });
  }
  // 2. printed page numbers
  const pn = pageNumberBreaks(rows);
  bk.pn = { tagged: pn.tagged, other: pn.other, kinds: pn.kinds, outliers: pn.outliers.length, shapes: {} };
  for (const b of pn.breaks) {
    bk.pn.shapes[b.shape] = (bk.pn.shapes[b.shape] || 0) + 1;
    lines.push({ kind: 'pn', book: id, ...b });
  }
  // 3–5 per page / pair
  for (let i = 0; i < rows.length; i++) {
    const A = rows[i];
    // N+1: the same scan twice. N+2: a two-page opening scanned twice (N≈N+2, N+1≈N+3).
    for (const gap of [1, 2]) {
      const B = rows[i + gap];
      if (!B || B.p !== A.p + gap || !A.ocr || !B.ocr) continue;
      const d = duplicateScan(A.ocr, B.ocr);
      if (!d.judged) continue;
      if (gap === 1) bk.dup.judged++;
      if (d.dup) { bk.dup.dup++; bk.dup[`gap${gap}`] = (bk.dup[`gap${gap}`] || 0) + 1; lines.push({ kind: 'dup', book: id, p: A.p, next: B.p, gap, dice: d.dice }); }
    }
    if (ocrReasoningLeak(A.ocr)) { bk.ocrLeak = (bk.ocrLeak || 0) + 1; lines.push({ kind: 'ocrleak', book: id, p: A.p, head: String(A.ocr).slice(0, 120) }); }
    if (!A.tr || !A.tr.trim()) continue;
    bk.trPages++;
    const lang = pageLanguage(A, bookLang);
    const t = truncationRatio(A);
    if (t.judged) {
      bk.trunc.judged++;
      const L = (bk.trunc.byLang[lang] ||= { n: 0, flagged: 0 }); L.n++;
      const med = medians?.[lang] ?? medians?._all ?? null;
      const norm = med ? t.ratio / med : null;
      if (norm != null && norm < TRUNC_NORM_FLAG) {
        bk.trunc.flagged++; L.flagged++;
        lines.push({ kind: 'trunc', book: id, p: A.p, lang, ratio: t.ratio, norm: +norm.toFixed(3), src: t.src, tr: t.tr, type: A.type || null });
      }
    }
    const e = echoedSource({ ocr: A.ocr, tr: A.tr, lang });
    if (!e.judged) { bk.echo.unjudged[e.why] = (bk.echo.unjudged[e.why] || 0) + 1; continue; }
    bk.echo.judged++;
    if (e.listLike) bk.echo.listLike++;
    if (e.echo) { bk.echo.echo++; if (e.wholePage) bk.echo.wholePage = (bk.echo.wholePage || 0) + 1; lines.push({ kind: 'echo', book: id, p: A.p, lang, len: e.len, share: e.share, wholePage: e.wholePage, text: e.text }); }
  }
  lines.push(bk);
  return { lines };
}

function loadBookLangs(dir) {
  const lang = new Map();
  const booksIndex = path.join(path.dirname(dir), 'books.jsonl');
  if (!fs.existsSync(booksIndex)) return lang;
  for (const line of fs.readFileSync(booksIndex, 'utf8').split('\n')) {
    if (!line) continue;
    try { const b = JSON.parse(line); lang.set(b.id, b.language || 'unknown'); } catch {}
  }
  return lang;
}

function calibrate(dir, out) {
  const every = Number(arg('every', 20));
  const langs = loadBookLangs(dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().filter((_, i) => i % every === 0);
  const ratios = {};
  for (const f of files) {
    const id = f.slice(0, -6);
    let rows; try { rows = readBook(path.join(dir, f)); } catch { continue; }
    for (const r of rows) {
      if (!r.tr) continue;
      const t = truncationRatio(r);
      if (!t.judged) continue;
      const l = pageLanguage(r, langs.get(id));
      (ratios[l] ||= []).push(t.ratio);
      (ratios._all ||= []).push(t.ratio);
    }
  }
  const medians = {}, detail = {};
  for (const [l, a] of Object.entries(ratios)) {
    a.sort((x, y) => x - y);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    detail[l] = { n: a.length, p05: q(0.05), p25: q(0.25), median: q(0.5), p75: q(0.75) };
    if (a.length >= 200 || l === '_all') medians[l] = q(0.5);
  }
  fs.writeFileSync(path.join(out, 'calibration.json'), JSON.stringify({ every, books: files.length, medians, detail }, null, 1));
  process.stderr.write(`calibrated on ${files.length} books; ${Object.keys(medians).length} languages with ≥200 pages\n`);
}

function walk(dir, out) {
  const [k, n] = arg('shard', '0/1').split('/').map(Number);
  const limit = Number(arg('limit', 0));
  const list = arg('books', '') || (arg('books-file', '') && fs.readFileSync(arg('books-file'), 'utf8'));
  const only = list ? new Set(list.split(/[\s,]+/).filter(Boolean)) : null;
  const calPath = path.join(out, 'calibration.json');
  const medians = fs.existsSync(calPath) ? JSON.parse(fs.readFileSync(calPath, 'utf8')).medians : null;
  if (!medians) process.stderr.write('WARNING: no calibration.json — truncation will be judged but never flagged\n');
  const langs = loadBookLangs(dir);
  const shardFile = path.join(out, only ? 'books.jsonl' : `shard-${k}.jsonl`);
  const done = new Set();
  if (fs.existsSync(shardFile)) {
    for (const line of fs.readFileSync(shardFile, 'utf8').split('\n')) {
      if (line.startsWith('{"kind":"book"')) try { done.add(JSON.parse(line).book); } catch {}
    }
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
    .filter((f, i) => (only ? only.has(f.slice(0, -6)) : i % n === k));
  let seen = 0, ran = 0;
  for (const f of files) {
    if (limit && seen >= limit) break;
    seen++;
    const id = f.slice(0, -6);
    if (done.has(id) && !only) continue;
    let rows; try { rows = readBook(path.join(dir, f)); } catch { rows = null; }
    const { lines } = rows ? scanBook(id, rows, { bookLang: langs.get(id) || 'unknown', medians })
      : { lines: [{ kind: 'book', book: id, unreadable: true }] }; // recorded, never silently skipped
    fs.appendFileSync(shardFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    ran++;
    if (ran % 1000 === 0) process.stderr.write(`shard ${k}: ${seen}/${files.length}\n`);
  }
  process.stderr.write(`shard ${k} done: ${seen} books seen, ${ran} scanned this run, ${done.size} resumed\n`);
}

/** Aggregate every `book` row under <out> into per-detector totals, overall and by language. */
export function summarize(out) {
  const files = fs.readdirSync(out).filter(f => /^(shard-\d+|books)\.jsonl$/.test(f));
  const blank = () => ({
    books: 0, unreadable: 0, pages: 0, trPages: 0,
    catch: { books: 0, pagesWithCw: 0, judged: 0, ok: 0, shapes: {}, unjudged: {}, booksWithBreak: 0 },
    pn: { booksTagged: 0, booksJudged: 0, pagesTagged: 0, pairs: 0, outliers: 0, shapes: {}, booksWithBreak: 0, rates: {} },
    dup: { judged: 0, dup: 0, books: 0 },
    trunc: { judged: 0, flagged: 0, books: 0 },
    echo: { judged: 0, echo: 0, listLike: 0, books: 0, unjudged: {} },
  });
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const all = blank(), byLang = {};
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(out, f), 'utf8').split('\n')) {
      if (!line.startsWith('{"kind":"book"')) continue;
      const b = JSON.parse(line);
      const lang = (languageFamily(parseLanguageField(b.lang)[0]) || 'unknown').toLowerCase();
      for (const S of [all, (byLang[lang] ||= blank())]) {
        S.books++;
        if (b.unreadable) { S.unreadable++; continue; }
        S.pages += b.pages; S.trPages += b.trPages;
        const c = b.catch;
        if (c.pagesWithCw) S.catch.books++;
        S.catch.pagesWithCw += c.pagesWithCw; S.catch.judged += c.judged; S.catch.ok += c.ok;
        for (const [k, v] of Object.entries(c.shapes)) add(S.catch.shapes, k, v);
        for (const [k, v] of Object.entries(c.unjudged)) add(S.catch.unjudged, k, v);
        const realCw = Object.entries(c.shapes).filter(([k]) => !['plate-between', 'facing-text'].includes(k)).reduce((a, [, v]) => a + v, 0);
        if (realCw) S.catch.booksWithBreak++;
        const pn = b.pn;
        if (pn.tagged) S.pn.booksTagged++;
        S.pn.pagesTagged += pn.tagged; S.pn.outliers += pn.outliers;
        let judged = false;
        for (const k of Object.values(pn.kinds)) if (k.judged) { judged = true; S.pn.pairs += k.pairs; add(S.pn.rates, String(k.rate), 1); }
        if (judged) S.pn.booksJudged++;
        for (const [k, v] of Object.entries(pn.shapes)) add(S.pn.shapes, k, v);
        if (['jump', 'repeat', 'back'].some(k => pn.shapes[k])) S.pn.booksWithBreak++;
        S.dup.judged += b.dup.judged; S.dup.dup += b.dup.dup; if (b.dup.dup) S.dup.books++;
        S.trunc.judged += b.trunc.judged; S.trunc.flagged += b.trunc.flagged; if (b.trunc.flagged) S.trunc.books++;
        S.echo.judged += b.echo.judged; S.echo.echo += b.echo.echo; S.echo.listLike += b.echo.listLike; if (b.echo.echo) S.echo.books++;
        for (const [k, v] of Object.entries(b.echo.unjudged)) add(S.echo.unjudged, k, v);
      }
    }
  }
  const summary = { generated: new Date().toISOString(), all, byLang: Object.fromEntries(Object.entries(byLang).sort((a, b) => b[1].books - a[1].books)) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  return summary;
}

/**
 * Repair lists, one per defect class, plus corroboration between detectors. Nothing here writes
 * to a store: the lists are files for a human to review (--report-dir, default
 * scripts/eval/results). Classes:
 *   duplicate-scans   the same page (gap 1) or the same opening (gap 2) photographed twice
 *   leaf-order        printed-number jump/back/repeat NOT explained by a duplicate scan at that
 *                     boundary; `corroborated` when the catchword chain breaks there too
 *   truncated         translation under half the language's median length for its source
 *   echoed            translation reproduces ≥ ECHO_MIN_CHARS of its source verbatim; `wholePage`
 *                     when that is most of the translation (the defect tier)
 *   ocr-reasoning-leak  the OCR field holds the model's reasoning, not a transcription (side find)
 */
export function report(out, reportDir, date) {
  const files = fs.readdirSync(out).filter(f => /^shard-\d+\.jsonl$/.test(f));
  const vis = new Map();
  const booksIndex = path.join(os.homedir(), 'sl-corpus/books.jsonl');
  for (const line of fs.readFileSync(booksIndex, 'utf8').split('\n')) {
    if (!line) continue;
    try { const b = JSON.parse(line); vis.set(b.id, { visible: !!b.visible, title: b.display_title || b.title || '' }); } catch {}
  }
  const lists = { 'duplicate-scans': [], 'leaf-order': [], truncated: [], echoed: [], 'ocr-reasoning-leak': [] };
  for (const f of files) {
    const byBook = new Map();
    for (const line of fs.readFileSync(path.join(out, f), 'utf8').split('\n')) {
      if (!line || line.startsWith('{"kind":"book"')) continue;
      const r = JSON.parse(line);
      (byBook.get(r.book) || byBook.set(r.book, []).get(r.book)).push(r);
    }
    for (const [book, rows] of byBook) {
      const v = vis.get(book) || { visible: null, title: '' };
      const dupAt = new Set();
      for (const r of rows.filter(x => x.kind === 'dup')) {
        dupAt.add(r.next); dupAt.add(r.p);
        lists['duplicate-scans'].push({ book, visible: v.visible, page: r.next, copyOf: r.p, gap: r.gap, dice: r.dice });
      }
      const cwBreak = new Set(rows.filter(x => x.kind === 'catch' && !['plate-between', 'facing-text'].includes(x.shape)).map(x => x.p));
      for (const r of rows.filter(x => x.kind === 'pn' && ['jump', 'back', 'repeat'].includes(x.shape))) {
        let explained = false;
        for (let p = r.from - 1; p <= r.to + 1; p++) if (dupAt.has(p)) explained = true;
        if (explained) continue;
        let corroborated = false;
        for (let p = r.from; p < r.to; p++) if (cwBreak.has(p)) corroborated = true;
        lists['leaf-order'].push({ book, visible: v.visible, from: r.from, to: r.to, fromValue: r.fromValue, toValue: r.toValue, shape: r.shape, d: r.d, numbering: r.numbering, corroborated });
      }
      for (const r of rows.filter(x => x.kind === 'trunc')) lists.truncated.push({ book, visible: v.visible, page: r.p, lang: r.lang, ratio: r.ratio, norm: r.norm, src: r.src, tr: r.tr });
      for (const r of rows.filter(x => x.kind === 'echo')) lists.echoed.push({ book, visible: v.visible, page: r.p, lang: r.lang, len: r.len, share: r.share, wholePage: !!r.wholePage });
      for (const r of rows.filter(x => x.kind === 'ocrleak')) lists['ocr-reasoning-leak'].push({ book, visible: v.visible, page: r.p });
    }
  }
  const stats = {};
  fs.mkdirSync(reportDir, { recursive: true });
  for (const [cls, rows] of Object.entries(lists)) {
    const file = path.join(reportDir, `page-integrity-repair-${cls}-${date}.jsonl`);
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    const books = new Set(rows.map(r => r.book)), visibleBooks = new Set(rows.filter(r => r.visible).map(r => r.book));
    stats[cls] = { rows: rows.length, books: books.size, visibleBooks: visibleBooks.size, visibleRows: rows.filter(r => r.visible).length, file };
  }
  const lo = lists['leaf-order'];
  stats['leaf-order'].corroborated = lo.filter(r => r.corroborated).length;
  stats['leaf-order'].byShape = lo.reduce((o, r) => ((o[r.shape] = (o[r.shape] || 0) + 1), o), {});
  stats.echoed.wholePage = lists.echoed.filter(r => r.wholePage).length;
  stats.echoed.wholePageBooks = new Set(lists.echoed.filter(r => r.wholePage).map(r => r.book)).size;
  const ds = lists['duplicate-scans'];
  stats['duplicate-scans'].byGap = ds.reduce((o, r) => ((o['gap' + r.gap] = (o['gap' + r.gap] || 0) + 1), o), {});
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = arg('dir', path.join(os.homedir(), 'sl-corpus/books'));
  const out = arg('out', 'scripts/output/page-integrity');
  fs.mkdirSync(out, { recursive: true });
  if (flag('calibrate')) calibrate(dir, out);
  else if (flag('summarize')) { const s = summarize(out); process.stdout.write(JSON.stringify(s.all, null, 1) + '\n'); }
  else if (flag('report')) process.stdout.write(JSON.stringify(report(out, arg('report-dir', 'scripts/eval/results'), arg('date', new Date().toISOString().slice(0, 10))), null, 1) + '\n');
  else walk(dir, out);
}
