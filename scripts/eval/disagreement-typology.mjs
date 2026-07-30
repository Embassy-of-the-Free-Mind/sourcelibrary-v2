#!/usr/bin/env node
/**
 * WHAT do two OCR passes disagree ABOUT? A typology of revision disagreement.
 *
 * "87% agreement" says nothing about quality on its own. PR #3273 found five
 * populations scoring identically as disagreement, and the calibration fit
 * (#3336) shows why the aggregate is so weak: across the anchor pages, 63 points
 * of agreement range map to about 5 points of accuracy. A page can disagree at
 * 35% between passes and still be 93% accurate.
 *
 * So the useful question is not HOW MUCH the passes differ but WHAT KIND of
 * difference it is. Two classes behave completely differently:
 *
 *   READING differences — the two passes produced the same word in the same
 *     place and resolved a GLYPH differently. That is the model struggling to
 *     read, and it is diagnostic of page quality.
 *
 *   STRUCTURAL differences — one pass emitted a marginal note, an image
 *     description, a header, or ordered the page differently. Nothing to do with
 *     legibility, and it dominates the raw metric.
 *
 * Restricted to LATIN because the confusions are known and enumerable: the long
 * s (ſ) misread as f is the classic early-modern OCR failure, alongside ligature
 * handling (æ/œ), tilde abbreviations (ā for am/an, q; for que), and u/v–i/j
 * normalization. Latin is also spaced, so it avoids the space-less-script
 * tokenization artifact that makes Chinese look catastrophically inconsistent
 * (22 whitespace tokens per page vs ~310 for Latin — one wrong glyph invalidates
 * a whole token).
 *
 * Read-only and free: Mongo reads plus local compute, no API calls.
 *
 *   node scripts/eval/disagreement-typology.mjs [--sample=300] [--show=12]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '300');
const SHOW = parseInt(args.show || '12');

/** Strip annotation so we compare BODY TEXT, not tagging choices. */
function bodyText(t) {
  return (t || '')
    // Block wrappers: drop content and all — these are editorial by definition.
    .replace(/<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc|detected-images)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ')
    // Inline marks: keep the CONTENT (it is real body text), drop the tags.
    .replace(/<\/?(?:note|margin|gloss|term|unclear|insert|header|sig|catchword|page-num|folio|column-break)(?:\s[^>]*)?\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Known early-modern Latin glyph confusions ────────────────────────
// Each maps a pair of readings to a named class. Order matters: the more
// specific tests run first so a long-s case is not swallowed by "generic".
// Every test must assert that NORMALIZING THE CONFUSION MAKES THE WORDS EQUAL.
// A test that fires on the mere PRESENCE of a glyph classifies unrelated words:
// the first version of this file matched any pair where either side contained
// `ſ`, and duly reported `eſt → hunc` as a long-s confusion.
const NORM = s => s.toLowerCase();

/**
 * Collapse the orthographic variation that the two passes disagree about as a
 * matter of POLICY rather than reading. Used only for ALIGNMENT — classification
 * always sees the raw forms, so a real long-s misreading is still reported.
 */
const fold = s => s.toLowerCase()
  .replace(/[\u017F]/g, 's')                                   // long s
  .replace(/\u00E6/g, 'ae').replace(/\u0153/g, 'oe')            // ligatures
  .replace(/\u0101/g, 'am').replace(/\u0113/g, 'em').replace(/\u012B/g, 'im')
  .replace(/\u014D/g, 'om').replace(/\u016B/g, 'um').replace(/\u00E3/g, 'an')
  .replace(/q;/g, 'que').replace(/&/g, 'et')                   // abbreviations
  .replace(/v/g, 'u').replace(/j/g, 'i')                       // u/v, i/j
  .normalize('NFD').replace(/\p{M}/gu, '')                     // accents
  .replace(/[.,;:!?()'"\u2014\u2013-]/g, '');                    // punctuation
const CLASSES = [
  // Long s misread as f (or vice versa) — the classic early-modern failure.
  // Equality after folding both glyphs to `s` is what makes it that, and nothing else.
  ['long-s ↔ f', (a, b) => {
    const fold = s => s.replace(/[ſ]/g, 's').replace(/f/g, 's');
    return fold(a) === fold(b) && a !== b;
  }],
  ['ligature æ/œ', (a, b) => a.replace(/æ/g, 'ae').replace(/œ/g, 'oe') === b.replace(/æ/g, 'ae').replace(/œ/g, 'oe') && a !== b],
  ['tilde abbreviation', (a, b) => {
    const ex = s => s.replace(/ā/g, 'am').replace(/ē/g, 'em').replace(/ī/g, 'im').replace(/ō/g, 'om').replace(/ū/g, 'um')
      .replace(/ã/g, 'an').replace(/ñ/g, 'nn').replace(/q;/g, 'que').replace(/q̃/g, 'que');
    return ex(a) === ex(b) && a !== b;
  }],
  ['u/v or i/j', (a, b) => a.replace(/v/g, 'u').replace(/j/g, 'i') === b.replace(/v/g, 'u').replace(/j/g, 'i') && a !== b],
  ['accent/diacritic', (a, b) => a.normalize('NFD').replace(/\p{M}/gu, '') === b.normalize('NFD').replace(/\p{M}/gu, '') && a !== b],
  ['case only', (a, b) => NORM(a) === NORM(b) && a !== b],
  ['punctuation only', (a, b) => a.replace(/[.,;:!?()'"—–-]/g, '') === b.replace(/[.,;:!?()'"—–-]/g, '') && a !== b],
];

/** Classify a single substituted word pair. */
function classify(a, b) {
  for (const [name, test] of CLASSES) { try { if (test(a, b)) return name; } catch { /* skip */ } }
  // Everything else is a genuine reading difference. Split by edit distance so
  // "one glyph misread" is separable from "completely different word".
  const d = lev(a, b);
  if (d === 1) return 'single-char substitution';
  if (d <= Math.ceil(Math.max(a.length, b.length) * 0.34)) return 'partial misread';
  return 'unrelated word';
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Word-level LCS diff. Substitutions (a word replaced by a different word in the
 * same position) are the READING signal; pure insertions/deletions are usually
 * one pass emitting material the other omitted — structural, not legibility.
 */
function diff(A, B, rawA = A, rawB = B) {
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return null; // guard: quadratic on very long pages
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      L[i][j] = A[i - 1] === B[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
  const ops = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) { i--; j--; }
    else if (L[i - 1][j] >= L[i][j - 1]) { ops.push(['del', rawA[i - 1]]); i--; }
    else { ops.push(['ins', rawB[j - 1]]); j--; }
  }
  while (i > 0) { --i; ops.push(['del', rawA[i]]); }
  while (j > 0) { --j; ops.push(['ins', rawB[j]]); }
  ops.reverse();
  // Collapse an adjacent del+ins into a substitution — that is the same slot
  // read two ways, which is exactly the reading signal we want.
  const out = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === 'del' && ops[k + 1]?.[0] === 'ins') { out.push(['sub', ops[k][1], ops[k + 1][1]]); k++; }
    else out.push(ops[k]);
  }
  return out;
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  const pages = db.collection('pages'), revs = db.collection('page_revisions');

  const cur = revs.find({ field: 'ocr' }, { projection: { page_id: 1, data: 1 }, limit: 14000 })
    .sort({ _id: -1 }).maxTimeMS(180000);

  const seen = new Set();
  const counts = {}; let subs = 0, ins = 0, del = 0, pagesUsed = 0, skippedMisaligned = 0;
  const examples = {};
  for await (const r of cur) {
    if (seen.has(r.page_id)) continue;   // newest revision per page only
    seen.add(r.page_id);
    if (pagesUsed >= SAMPLE) break;
    const p = await pages.findOne({ id: r.page_id }, { projection: { 'ocr.data': 1, book_id: 1, page_number: 1 } });
    const now = p?.ocr?.data; if (!now || !r.data) continue;
    // Latin only, per the header rationale.
    if (!/<language>\s*latin\s*<\/language>/i.test(now)) continue;

    const A = bodyText(r.data).split(' ').filter(Boolean);
    const B = bodyText(now).split(' ').filter(Boolean);
    if (A.length < 80 || B.length < 80) continue;

    // ALIGNMENT GATE. If the two passes share little vocabulary, they are not
    // two readings of the same words — they differ in reading order, or one
    // transcribed a different region. LCS on such a pair emits a cascade of
    // substitutions between unrelated words, and classifying those measures the
    // aligner, not the OCR. (Without this gate 94.6% of substitutions landed in
    // "unrelated word", with examples like `Albiere → iuventa:`.)
    const setA = new Set(A.map(fold)), shared = B.filter(w => setA.has(fold(w))).length;
    const overlap = shared / Math.max(A.length, B.length);
    if (overlap < 0.55) { skippedMisaligned++; continue; }

    // Length ratio guard: one pass far longer means truncation or a dropped
    // region, again structural rather than legibility.
    if (Math.min(A.length, B.length) / Math.max(A.length, B.length) < 0.7) { skippedMisaligned++; continue; }

    // ALIGN ON FOLDED FORMS, CLASSIFY ON RAW FORMS.
    //
    // Early-modern Latin passes differ in ORTHOGRAPHIC POLICY, not only in
    // reading: one expands `æ`→`ae`, `ſ`→`s`, `mirū`→`mirum`, `Atq;`→`Atque`,
    // the other preserves them. Aligned on exact strings, every such word is a
    // mismatch and the LCS drifts by one position, so each subsequent word gets
    // paired with its neighbour — producing a cascade of "unrelated word"
    // substitutions (`sæpissime → circumsonet.`) that are alignment artefacts,
    // not disagreements. Folding first lets those words MATCH, leaving genuine
    // reading differences as the only substitutions.
    const ops = diff(A.map(fold), B.map(fold), A, B); if (!ops) continue;
    pagesUsed++;

    for (const op of ops) {
      if (op[0] === 'sub') {
        subs++;
        const k = classify(op[1], op[2]);
        counts[k] = (counts[k] || 0) + 1;
        if (!examples[k]) examples[k] = [];
        if (examples[k].length < SHOW) examples[k].push(`${op[1]} → ${op[2]}  (p${p.page_number})`);
      } else if (op[0] === 'ins') ins++;
      else del++;
    }
  }

  const total = subs + ins + del;
  console.log(`\n  Latin pages with two OCR passes: ${pagesUsed} analysed, ${skippedMisaligned} SKIPPED as misaligned`);
  console.log(`  (skipped = the passes share <55% vocabulary or differ >30% in length — structural, not legibility)`);
  console.log(`  word-level operations: ${total}  (substitutions ${subs}, insertions ${ins}, deletions ${del})\n`);
  console.log(`  STRUCTURAL vs READING split:`);
  console.log(`    insert/delete (one pass emitted material the other did not): ${(100 * (ins + del) / total).toFixed(1)}%`);
  console.log(`    substitutions (same slot, read two ways): ${(100 * subs / total).toFixed(1)}%\n`);
  console.log(`  What the substitutions actually are:`);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`    ${k.padEnd(26)} ${String(v).padStart(6)}  ${(100 * v / subs).toFixed(1)}%`);
  }
  console.log(`\n  Examples:`);
  for (const [k] of sorted.slice(0, 6)) {
    console.log(`    ${k}:`);
    for (const e of (examples[k] || []).slice(0, 4)) console.log(`      ${e}`);
  }

  const out = path.join(__dirname, 'results', `disagreement-typology-latin-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ pagesUsed, subs, ins, del, counts, examples }, null, 2));
  console.log(`\n  → ${path.relative(process.cwd(), out)}\n`);
  await c.close();
}

main().catch(e => { console.error(e); process.exit(1); });
