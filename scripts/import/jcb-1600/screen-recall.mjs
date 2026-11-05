#!/usr/bin/env node
// PRIOR ART: control-truth.mjs (truth from our stored OCR) + fetch-ia-text.mjs --ids-file (the
// Archive's hOCR of the same scans). This scores the locator against the truth (#8049).
//
// Truth: a page whose STORED OCR (ours, read by a model against the image) has a strong hit.
// Screen: a page whose IA hOCR has a strong hit. Recall at ±0 and ±2 pages (B reads hit pages ±2),
// false-alarm share = screen-strong pages with no truth-strong page within ±2, and book recall
// (a truth book with >=1 strong page that the screen flags at all). Per language.
// Alignment is checked, not assumed: word-set Jaccard of our page i vs IA page i+k, k in -3..3, on
// up to 25 text pages; a book whose best k is not 0 is reported and scored at that k.
//
// node scripts/import/jcb-1600/screen-recall.mjs --truth $S/s5/controls --ia $S/s5/controls-ia > report.json
import fs from 'node:fs';
import path from 'node:path';
import { pageHits, isStrong, normNW } from './nw-terms.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const T = arg('--truth'), I = arg('--ia');
const words = t => new Set(normNW(t).split(/[^a-z]+/).filter(w => w.length > 3));
const jac = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };

const per = {}; const books = [];
for (const f of fs.readdirSync(I).filter(x => x.endsWith('.json'))) {
  const ia = JSON.parse(fs.readFileSync(path.join(I, f), 'utf8'));
  if (!ia.pages) { books.push({ ia: ia.ia, status: ia.status }); continue; }
  const tr = JSON.parse(fs.readFileSync(path.join(T, `${ia.ia}.truth.json`), 'utf8'));
  const ours = tr.rows.map(r => r.text);
  const sample = ours.map((t, i) => [i, t]).filter(([, t]) => t.length > 400).filter((_, j, a) => j % Math.max(1, Math.floor(a.length / 25)) === 0).slice(0, 25);
  let best = { k: 0, s: -1 };
  for (let k = -3; k <= 3; k++) {
    let s = 0; for (const [i, t] of sample) s += jac(words(t), words(ia.pages[i + k] || ''));
    s /= Math.max(1, sample.length); if (s > best.s) best = { k, s };
  }
  const tS = ours.map(t => isStrong(pageHits(t)));
  const sS = ours.map((_, i) => isStrong(pageHits(ia.pages[i + best.k] || '')));
  const near = (arr, i, w) => { for (let d = -w; d <= w; d++) if (arr[i + d]) return true; return false; };
  const truthN = tS.filter(Boolean).length;
  const hit0 = tS.filter((v, i) => v && sS[i]).length;
  const hit2 = tS.filter((v, i) => v && near(sS, i, 2)).length;
  const scr = sS.filter(Boolean).length;
  const fa = sS.filter((v, i) => v && !near(tS, i, 2)).length;
  const lang = tr.language;
  const p = (per[lang] ??= { books: 0, truth_books: 0, truth_books_found: 0, truth_pages: 0, found0: 0, found2: 0, screen_pages: 0, false_alarms: 0, misaligned: 0, low_jaccard: 0 });
  p.books++; p.truth_pages += truthN; p.found0 += hit0; p.found2 += hit2; p.screen_pages += scr; p.false_alarms += fa;
  if (truthN) { p.truth_books++; if (scr) p.truth_books_found++; }
  if (best.k !== 0) p.misaligned++;
  if (best.s < 0.15) p.low_jaccard++;
  books.push({ ia: ia.ia, lang, year: tr.year, title: tr.title?.slice(0, 70), k: best.k, jaccard: +best.s.toFixed(3), truth_pages: truthN, found2: hit2, screen_pages: scr, false_alarms: fa });
}
for (const p of Object.values(per)) {
  p.page_recall0 = p.truth_pages ? +(p.found0 / p.truth_pages).toFixed(3) : null;
  p.page_recall2 = p.truth_pages ? +(p.found2 / p.truth_pages).toFixed(3) : null;
  p.false_alarm_share = p.screen_pages ? +(p.false_alarms / p.screen_pages).toFixed(3) : null;
}
console.log(JSON.stringify({ per_language: per, books }, null, 1));
