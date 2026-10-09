#!/usr/bin/env node
// PRIOR ART: scripts/lib/page-integrity.mjs (truncationRatio, echoedSource, repeatedBlocks) and
// scripts/lib/ocr-loop-guard.mjs (loopVerdict) — reused below for the loop / repeat checks.
// truncationRatio does not fit as-is: it reads readingLength (letters) on both sides, and a
// Tibetan source's letter count has no stable relation to English letters; here the source is
// counted in SYLLABLES (tsheg-delimited) and the outlier is taken per volume. Nothing in the repo
// checks how a translation treats Esukhia markup (#, (x,y), {x,y}, [x], {D####}).
/**
 * Part A of the Tengyur pilot translation QA (#5497): mechanical checks over every pilot page.
 * $0, no model, read-only. Input is a JSONL dump of the pilot pages (dump.mjs); output is
 * scripts/eval/results/tengyur-pilot-qa-2026-10/mechanical.json (counts + per-page flags, no
 * page text beyond short quotes).
 *
 *   node scripts/eval/tengyur-pilot-qa/mechanical.mjs <pages.jsonl> <out.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { translationProse, repeatedBlocks } from '../../lib/page-integrity.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const [inPath, outPath] = process.argv.slice(2);
const pages = fs.readFileSync(inPath, 'utf8').trim().split('\n').map(JSON.parse);

const TIB = /[ༀ-࿿]/g;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/** Source body with Esukhia markup resolved to the corrected reading, for counting syllables. */
function cleanSource(src) {
  return String(src || '')
    .replace(/\{D\d+[a-z]?\}/g, ' ')
    .replace(/[({]([^(){},\n]*),([^(){},\n]*)[)}]/g, '$2')
    .replace(/\\?#/g, '')
    .replace(/\[([^\]\n]*)\]/g, '$1');
}
const syllables = (t) => (cleanSource(t).match(/[ཀ-ྼ]+/g) || []).length;
const words = (t) => (String(t).match(/[A-Za-zĀ-ž'’-]+/g) || []).length;
const notesOf = (en) => String(en).match(/<note\b[^>]*>[\s\S]*?<\/note>/gi) || [];

const rows = pages.map((p) => {
  const en = String(p.en || '');
  const prose = translationProse(en);
  const syl = syllables(p.src);
  const w = words(prose);
  const notes = notesOf(en);
  // An unclosed <note> swallows the translation after it into the note (#5644's class).
  const noteOpens = (en.match(/<note\b[^>]*>/gi) || []).length, noteCloses = (en.match(/<\/note>/gi) || []).length;
  const tibAll = (en.match(TIB) || []).length;
  const tibOutsideNotes = (en.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ' ').match(TIB) || []).length;
  // Esukhia markup in the source and what survived into the English.
  const srcD = [...String(p.src).matchAll(/\{(D\d+[a-z]?)\}/g)].map((m) => m[1]);
  const enD = [...en.matchAll(/\{(D\d+[a-z]?)\}/g)].map((m) => m[1]);
  const srcCorr = (String(p.src).match(/[({][^(){},\n]*,[^(){},\n]*[)}]/g) || []).length;
  const srcHash = (String(p.src).match(/#/g) || []).length;
  // Leaks: a '#' that is not a Markdown heading marker at line start; a correction pair; a
  // bracketed Tibetan span; an English rendering of the markup itself.
  const hashLeak = (en.replace(/^#{1,6} /gm, '').match(/#/g) || []).length;
  const corrLeak = (en.match(/[({][^(){},\n]{0,40},[^(){},\n]{0,40}[)}]/g) || []).filter((s) => TIB.test(s) || /^[({]\s*[ༀ-࿿]/.test(s)).length;
  const markupWords = (en.match(/\b(peydurma|note point|annotation mark|correction mark|scribal (?:correction|mark)|variant reading|\(sic\)|reads? as|emend\w*|the text (?:has|reads))\b/gi) || []);
  const loop = loopVerdict(prose);
  const rep = repeatedBlocks(prose);
  // Empty = under 40 characters of English for a source of at least 20 syllables (a one-line
  // title side legitimately yields one line).
  const empty = prose.replace(/\s/g, '').length < 40 && syl >= 20;
  return {
    vol: p.vol, book_id: p.book_id, page: p.page_number, label: p.label,
    syl, en_words: w, ratio: syl ? +(w / syl).toFixed(3) : null,
    notes: notes.length, note_unbalanced: noteOpens !== noteCloses ? { opens: noteOpens, closes: noteCloses } : null, note_words: words(notes.join(' ')),
    tib_chars: tibAll, tib_chars_outside_notes: tibOutsideNotes,
    src_D: srcD, en_D: enD, D_dropped: srcD.filter((d) => !enD.includes(d)),
    src_corrections: srcCorr, src_hash: srcHash, hash_leak: hashLeak, corr_leak: corrLeak, markup_words: markupWords,
    loop: loop.refuse ? { period: loop.period, reps: loop.reps, share: loop.share } : null,
    repeat: rep.judged && rep.longest > 0 ? { kind: rep.kind, longest: rep.longest, copies: rep.copies, sample: rep.sample } : null,
    empty,
    ends: prose.slice(-60).replace(/\s+/g, ' '),
  };
});

// Per-volume ratio outliers: below half or above double the volume median (pages with ≥ 60
// syllables; a near-blank side has no stable ratio).
const byVol = {};
for (const r of rows) (byVol[r.vol] ||= []).push(r);
const volStats = {};
for (const [v, rs] of Object.entries(byVol)) {
  const judged = rs.filter((r) => r.syl >= 60 && r.ratio != null);
  const med = median(judged.map((r) => r.ratio));
  volStats[v] = { pages: rs.length, judged: judged.length, median_ratio: +med.toFixed(3) };
  for (const r of rs) {
    r.ratio_rel = r.syl >= 60 && med ? +(r.ratio / med).toFixed(2) : null;
    r.low_outlier = r.ratio_rel != null && r.ratio_rel < 0.5;
    r.high_outlier = r.ratio_rel != null && r.ratio_rel > 2;
  }
}

// Badness score for "ten worst": each defect weighted by how much it would cost a reader.
for (const r of rows) {
  r.badness = (r.empty ? 100 : 0) + (r.low_outlier ? 40 * (1 - (r.ratio_rel ?? 0)) + 20 : 0) + (r.high_outlier ? 10 + 5 * (r.ratio_rel - 2) : 0)
    + (r.loop ? 60 : 0) + (r.repeat?.kind === 'block' ? 15 + r.repeat.longest / 4 : 0)
    + Math.min(30, r.tib_chars_outside_notes / 5) + 5 * r.hash_leak + 5 * r.corr_leak + 10 * r.D_dropped.length + (r.note_unbalanced ? 50 : 0);
}

const count = (f) => { const o = { all: rows.filter(f).length }; for (const v of Object.keys(byVol)) o[v] = byVol[v].filter(f).length; return o; };
const summary = {
  pages: count(() => true),
  empty: count((r) => r.empty),
  ratio_low_outlier: count((r) => r.low_outlier),
  ratio_high_outlier: count((r) => r.high_outlier),
  tibetan_left_any: count((r) => r.tib_chars > 0),
  tibetan_left_outside_notes: count((r) => r.tib_chars_outside_notes > 0),
  tibetan_left_outside_notes_ge20: count((r) => r.tib_chars_outside_notes >= 20),
  loop_guard_refuse: count((r) => r.loop),
  repeated_block: count((r) => r.repeat?.kind === 'block'),
  repeated_loop_kind: count((r) => r.repeat?.kind === 'loop'),
  note_unbalanced: count((r) => r.note_unbalanced),
  hash_leak_pages: count((r) => r.hash_leak > 0),
  correction_pair_leak_pages: count((r) => r.corr_leak > 0),
  markup_word_pages: count((r) => r.markup_words.length > 0),
  src_pages_with_D: count((r) => r.src_D.length > 0),
  D_marker_kept: count((r) => r.src_D.length > 0 && r.D_dropped.length === 0),
  src_hash_points_total: rows.reduce((s, r) => s + r.src_hash, 0),
  src_correction_pairs_total: rows.reduce((s, r) => s + r.src_corrections, 0),
};
const notesPer = rows.map((r) => r.notes);
summary.notes_per_page = { median: median(notesPer), mean: +(notesPer.reduce((a, b) => a + b, 0) / rows.length).toFixed(2), max: Math.max(...notesPer), zero: notesPer.filter((n) => !n).length, total: notesPer.reduce((a, b) => a + b, 0) };
for (const v of Object.keys(byVol)) volStats[v].notes_mean = +(byVol[v].reduce((s, r) => s + r.notes, 0) / byVol[v].length).toFixed(2);

const worst = [...rows].sort((a, b) => b.badness - a.badness).slice(0, 10).map((r) => ({
  vol: r.vol, page: r.page, label: r.label, url: `https://sourcelibrary.org/book/${r.book_id}?page=${r.page}`, badness: +r.badness.toFixed(1),
  why: [r.empty && 'empty', r.low_outlier && `ratio ${r.ratio_rel}× vol median`, r.high_outlier && `ratio ${r.ratio_rel}× vol median`, r.loop && 'loop', r.repeat?.kind === 'block' && `repeated block ${r.repeat.longest} words`, r.tib_chars_outside_notes && `${r.tib_chars_outside_notes} Tibetan chars outside notes`, r.hash_leak && `${r.hash_leak} '#' leaked`, r.corr_leak && `${r.corr_leak} correction pairs leaked`, r.D_dropped.length && `dropped ${r.D_dropped.join(',')}`, r.note_unbalanced && `unclosed <note> (${r.note_unbalanced.opens} open / ${r.note_unbalanced.closes} closed)`].filter(Boolean),
}));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), input_pages: rows.length, summary, volumes: volStats, worst, pages: rows }, null, 1));
console.log(JSON.stringify({ summary, volumes: volStats, worst }, null, 1));
