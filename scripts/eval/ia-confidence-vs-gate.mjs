#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ia-ocr-delivered-quality.mjs (#4790) measures the text the lane ALREADY
 * WROTE against a fresh paid model read — the right instrument for "is accepted text good", and it
 * costs money; this one asks a different question (can a FREE signal stand in for the paid
 * reference at gate time) and spends nothing. scripts/import/ia-ocr-ingest.mjs holds the gate
 * being tested but cannot report on itself. scripts/lib/ia-ocr-confidence.mjs is the parser; this
 * is the calibration that decides whether to believe it. No existing eval reads `x-confidence`.
 *
 * ia-confidence-vs-gate — can the Archive's own per-word confidence stand in for a paid reference?
 *
 * THE QUESTION. The free-text lane admits a book only when the Archive's reading agrees with OUR
 * model's reading of the same leaves, so every candidate must first be given a paid OCR sample
 * (today: a 25-page Phase 1.5 preview). If the engine's self-reported confidence separates the
 * books the paid gate rejects from the ones it accepts, the sample can shrink or go away for a
 * defined cohort — see the measurement on #4763 (2026-09-24): over 140 post-1850 English books the
 * gate ACCEPTED 134 and REJECTED 4, with agreement p10 0.907 against a 0.80 cutoff and exactly one
 * book within ±0.05 of the line. A gate that discriminates that little is an expensive way to find
 * four books.
 *
 * WHAT WOULD MAKE IT FAIL, stated before the run. Confidence is the engine's SELF-REPORT. If the
 * rejected books' confidence sits inside the accepted books' range, the signal is useless at gate
 * time no matter how cheap it is, and this eval should say so plainly. `ocr-plausibility.mjs`
 * already measured one class no cheap statistic separates (word-shaped junk from an out-of-focus
 * scan), so a clean separation here is a claim about THIS cohort, never about IA text in general.
 *
 * n IS SMALL AND THAT IS THE POINT. Four rejects is not a sample you can build a threshold on. The
 * useful output is the SEPARATION — whether the reject confidences sit outside the accepted range
 * at all — plus how many accepted books a candidate threshold would wrongly refuse. A threshold
 * proposed from four books must be re-measured on a bigger reject pool before it gates a write.
 *
 * FREE. Reads `_djvu.xml` files already in the ingester's cache; fetches (rate-limited, via the
 * ingester's own `iaFetch`) only what is missing. No model calls.
 *
 * Usage:
 *   node scripts/eval/ia-confidence-vs-gate.mjs --gate-log <ia-ocr-ingest dry-run log> \
 *     --cache /root/sl-ia-cache [--out results.json] [--limit 200]
 *
 * The gate log is the free dry run that produced the decisions:
 *   node scripts/import/ia-ocr-ingest.mjs --ids <file> --limit 400 --cache /root/sl-ia-cache
 */
import fs from 'node:fs';
import path from 'node:path';
import { leafConfidence, confidenceCoverage, summarize } from '../lib/ia-ocr-confidence.mjs';
import { iaFetch, iaOcrMeta } from '../lib/ia-ocr-meta.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const GATE_LOG = arg('gate-log', null);
const CACHE = arg('cache', null);
const OUT = arg('out', null);
const LIMIT = +arg('limit', 400);
if (!GATE_LOG || !fs.existsSync(GATE_LOG)) { console.error('--gate-log <path> is required (a free ia-ocr-ingest dry run)'); process.exit(2); }

// ---------- read the gate's own decisions ----------
// Two line shapes the ingester prints, e.g.
//   ACCEPT <book_id> 1904 <title> | agreement median 0.941 over 10 pages | gate 0.80 ...
//   REJECT <book_id> 1801 <title> | agreement median 0.318 over 7 pages  | gate 0.80 ...
// A book the gate could not calibrate ("cannot calibrate") is EXCLUDED, not scored as either:
// it has no verdict to compare against, and counting it would invent one.
const decisions = [];
for (const line of fs.readFileSync(GATE_LOG, 'utf8').split('\n')) {
  const m = /^\s*(ACCEPT|REJECT)\s+(\S+)\s+(\S+)\s+(.*?)\s*\|\s*agreement median ([0-9.]+)/.exec(line);
  if (!m) continue;
  const ia = /\bia[_ ]?id[= ]([A-Za-z0-9._-]+)/.exec(line)?.[1] || null;
  decisions.push({ verdict: m[1], book_id: m[2], year: m[3], title: m[4].slice(0, 60), agreement: +m[5], ia_id: ia });
}
if (!decisions.length) { console.error(`No ACCEPT/REJECT lines parsed from ${GATE_LOG}. Has the log format changed?`); process.exit(3); }

// A matcher pinned to a literal can stop matching and still look green
// (auto-memory: lesson_a_check_can_stop_checking_and_still_report_green), so assert it saw both.
const nAcc = decisions.filter((d) => d.verdict === 'ACCEPT').length;
const nRej = decisions.filter((d) => d.verdict === 'REJECT').length;
console.log(`parsed ${decisions.length} decisions from the gate log: ${nAcc} ACCEPT, ${nRej} REJECT`);
if (!nRej) console.log('!! no REJECT lines in this log — the run CANNOT show separation, only the accepted range.');

// ---------- the book_id -> IA identifier map ----------
// The dry-run log does not print the IA id, so take it from Mongo. Read-only.
const { MongoClient } = await import('mongodb');
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = await mc.db('bookstore').collection('books')
  .find({ id: { $in: decisions.map((d) => d.book_id) } },
    { projection: { id: 1, ia_identifier: 1, 'image_source.identifier': 1, language: 1 } }).toArray();
await mc.close();
const iaById = new Map(books.map((b) => [b.id, b.ia_identifier || b.image_source?.identifier || null]));

// ---------- confidence per book ----------
async function xmlFor(iaId) {
  if (CACHE) {
    const direct = path.join(CACHE, `${iaId}_djvu.xml`);
    if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf8');
    // The derivative is named after the UPLOADED file, not the identifier (ia-ocr-meta.mjs).
    const hit = fs.readdirSync(CACHE).find((f) => f.endsWith('_djvu.xml') && f.startsWith(iaId.slice(0, 12)));
    if (hit) return fs.readFileSync(path.join(CACHE, hit), 'utf8');
  }
  const meta = await iaOcrMeta(iaId).catch(() => null);
  if (!meta?.has_djvu_xml) return null;
  // `djvu_xml_files` is an ARRAY of names (the derivative is named after the uploaded file, not the
  // identifier). Several means several scans in one item, which the ingester refuses as ambiguous;
  // refuse it here too rather than guess which one our page URLs index.
  const names = meta.djvu_xml_files || [];
  if (names.length !== 1) return null;
  const res = await iaFetch(`https://archive.org/download/${iaId}/${encodeURIComponent(names[0])}`).catch(() => null);
  if (!res?.ok) return null;
  const text = await res.text();
  if (CACHE) { try { fs.writeFileSync(path.join(CACHE, `${iaId}_djvu.xml`), text); } catch {} }
  return text;
}

const rows = [];
let noXml = 0, noConf = 0;
for (const d of decisions.slice(0, LIMIT)) {
  const iaId = iaById.get(d.book_id);
  if (!iaId) { noXml++; continue; }
  const xml = await xmlFor(iaId).catch(() => null);
  if (!xml) { noXml++; continue; }
  const cov = confidenceCoverage(xml);
  // An XML with no x-confidence at all is a DIFFERENT finding from one whose words scored badly.
  if (!cov.share || cov.share < 0.5) { noConf++; rows.push({ ...d, ia_id: iaId, coverage: cov.share, book: null }); continue; }
  const leaves = leafConfidence(xml);
  const scored = leaves.filter(Boolean);
  // Book-level = the statistics over every scored word, not the mean of leaf means: a 4-word leaf
  // should not weigh as much as a full page (auto-memory: lesson_sample_one_page_per_book, inverted
  // — here the LEAF is the unit being pooled, and pooling by word is the honest weighting).
  const pooled = summarize(scored.flatMap((s) => Array(s.words).fill(s.mean)));
  rows.push({ ...d, ia_id: iaId, coverage: cov.share, leaves_scored: scored.length,
    book: pooled, worstLeafP10: scored.length ? Math.min(...scored.map((s) => s.p10)) : null,
    medianLeafLowShare: median(scored.map((s) => s.lowShare)) });
  process.stderr.write(`\r${rows.length}/${Math.min(LIMIT, decisions.length)} books   `);
}

// ---------- report ----------
const usable = rows.filter((r) => r.book);
const acc = usable.filter((r) => r.verdict === 'ACCEPT');
const rej = usable.filter((r) => r.verdict === 'REJECT');
console.log(`\n\n=== IA engine confidence vs the paid agreement gate ===`);
console.log(`books with usable confidence: ${usable.length} (${acc.length} accepted, ${rej.length} rejected)`);
if (noXml) console.log(`  no _djvu.xml reachable: ${noXml}`);
if (noConf) console.log(`  XML carries no x-confidence (<50% of words): ${noConf}  <- absence of the signal, NOT a bad book`);

for (const [label, set] of [['ACCEPTED', acc], ['REJECTED', rej]]) {
  if (!set.length) { console.log(`\n${label}: none`); continue; }
  console.log(`\n${label} (n=${set.length})`);
  console.log(`  mean confidence   ${quant(set.map((r) => r.book.mean))}`);
  console.log(`  worst-leaf p10    ${quant(set.map((r) => r.worstLeafP10))}`);
  console.log(`  median leaf lowShare ${quant(set.map((r) => r.medianLeafLowShare))}`);
}

if (acc.length && rej.length) {
  const accMin = Math.min(...acc.map((r) => r.book.mean));
  const rejMax = Math.max(...rej.map((r) => r.book.mean));
  console.log(`\nSEPARATION on mean confidence: lowest ACCEPTED ${accMin.toFixed(1)} vs highest REJECTED ${rejMax.toFixed(1)}`);
  if (rejMax < accMin) {
    console.log(`  CLEAN on this sample — but n(reject)=${rej.length}. A threshold from ${rej.length} books is not a threshold;`);
    console.log(`  re-measure on a larger reject pool before letting confidence gate any write.`);
  } else {
    const wouldLose = acc.filter((r) => r.book.mean <= rejMax).length;
    console.log(`  OVERLAPPING: a cutoff that caught every reject would also refuse ${wouldLose} of ${acc.length} accepted books`);
    console.log(`  (${(100 * wouldLose / acc.length).toFixed(1)}%). Confidence alone cannot replace the reference on this cohort.`);
  }
  console.log(`\nrejected books in full:`);
  rej.forEach((r) => console.log(`  agreement ${r.agreement.toFixed(3)}  mean-conf ${r.book.mean}  lowShare ${r.medianLeafLowShare}  ${r.year} ${r.title}`));
}

const corr = usable.length > 2 ? pearson(usable.map((r) => r.agreement), usable.map((r) => r.book.mean)) : null;
if (corr !== null) console.log(`\nPearson r(agreement, mean confidence) = ${corr.toFixed(3)} over ${usable.length} books`);

if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), gateLog: GATE_LOG, rows }, null, 2)); console.log(`\nrows -> ${OUT}`); }
console.log(`\nThis measures the gate's verdict, which is itself a model comparison — not ground truth.`);
console.log(`Confirm against hand-graded pages before any write is gated on confidence.`);

function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function quant(a) {
  const s = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y);
  if (!s.length) return 'n/a';
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return `min ${s[0].toFixed(1)}  p10 ${q(0.1).toFixed(1)}  median ${q(0.5).toFixed(1)}  max ${s[s.length - 1].toFixed(1)}`;
}
function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
