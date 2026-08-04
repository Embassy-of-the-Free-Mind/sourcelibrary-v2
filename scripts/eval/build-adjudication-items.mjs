#!/usr/bin/env node
/**
 * Turn OCR disagreements into SPAN-LEVEL judgements a volunteer can answer in
 * seconds: "the image says X — which of these two readings matches it?"
 *
 * WHY NOT ASK FOR TRANSCRIPTION
 *
 *   Transcribing a page of early-modern Latin takes a careful volunteer 10-30
 *   minutes and introduces their own errors, which are then indistinguishable from
 *   the OCR errors being measured. Adjudicating one disputed span takes seconds,
 *   yields a labelled token, and asks the human only for the thing humans are
 *   reliably better at: looking at the mark on the page.
 *
 *   The two passes have already done the expensive work of proposing candidates.
 *   Where they AGREE there is nothing to adjudicate (that is a different task — see
 *   the recitation probe, which needs whole pages). Where they DISAGREE, one of
 *   them is wrong, and a human resolves it with one click.
 *
 * THE DESIGN CHOICES THAT MAKE THE ANSWERS USABLE
 *
 *   BLIND. Which reading is the current live text is never shown, and A/B order is
 *   randomised per item from a seeded PRNG. Otherwise a volunteer who notices that
 *   option A is usually the newer model starts scoring the model, not the page.
 *
 *   THREE ANSWERS, NOT TWO. "A", "B", and "neither" — because both passes are
 *   frequently wrong together on a hard hand, and a forced choice would record a
 *   false positive as a correct reading. "Can't tell" is separate again: it is
 *   evidence about the SCAN, not about the readings, and pages that collect it are
 *   themselves a finding.
 *
 *   GOLD CONTROLS. A fraction of items have a known answer — one side is degenerate
 *   (a repetition loop) or is untagged model commentary rather than transcription.
 *   A volunteer who fails those is not reading the image, and without them there is
 *   no way to tell a careful annotator from a fast one.
 *
 *   OVERLAP. A fraction of items go to more than one volunteer, so inter-annotator
 *   agreement is measurable. Without it, volunteer disagreement and OCR error are
 *   the same number and the calibration is against noise.
 *
 *   STRATUM CARRIED THROUGH. Each item records the language/era of its page so the
 *   resulting error rates can be weighted back rather than describing whatever
 *   material happened to be adjudicated.
 *
 * Free: Mongo reads and local compute. Writes a task manifest; ships nothing.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-adjudication-items.mjs [--items=600] [--per-page=3]
 *                                                 [--gold=0.08] [--overlap=0.10]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { stripWrappers } from './lib/metrics.mjs';
import { dominantScript } from '../lib/revision-pairs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const WANT = parseInt(args.items || '600');
const PER_PAGE = parseInt(args['per-page'] || '3');     // cap items from one page
const GOLD = parseFloat(args.gold || '0.08');
const OVERLAP = parseFloat(args.overlap || '0.10');
const CONTEXT = parseInt(args.context || '7');          // words either side
const SEED = parseInt(args.seed || '1');
const DATE = args.date || new Date().toISOString().slice(0, 10);
const OUT_DIR = args['out-dir'] || path.join(__dirname, 'results');
const SOURCE = args.source || path.join(OUT_DIR, `double-ocr-pages-${DATE}.jsonl`);
const OUT_JSONL = path.join(OUT_DIR, `adjudication-items-${DATE}.jsonl`);
const OUT_KEY = path.join(OUT_DIR, `adjudication-key-${DATE}.jsonl`);
const OUT_REPORT = path.join(OUT_DIR, `adjudication-items-${DATE}.md`);
const SITE = 'https://sourcelibrary.org';

let _s = SEED >>> 0;
const rand = () => (((_s = (_s * 1664525 + 1013904223) >>> 0)) / 4294967296);

// stripWrappers does NOT remove <image-desc>: it is not an OCR envelope block. But
// it is AI-written prose ABOUT a picture, and a preview run duly produced the item
// "does the page say `beginning` or `start`?" from inside one. Nothing on the page
// says either. Remove it and its sibling before tokenising.
const words = s => stripWrappers((s || '')
  .replace(/<(image-desc|detected-images)[^>]*>[\s\S]*?<\/\1>/gi, ' '))
  .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

// A word-level task needs word boundaries. In Han, kana, Tibetan and Thai a page is
// ~22 whitespace tokens against ~310 for Latin, so a "substitution" pairs whole
// clauses against fragments — the preview produced a 40-character run opposite two
// characters. Those scripts need a character-level task, which this is not.
const SPACED_SCRIPTS = new Set(['latin', 'greek', 'cyrillic', 'hebrew', 'arabic', 'armenian', 'georgian', 'devanagari']);

// Reject alignment artifacts rather than asking a human to judge them: a real
// substitution is one word read two ways, so the candidates should be comparable in
// length. `T` against `TABLEAU` is the aligner slipping, not a reading.
const plausibleSpan = (a, b) => {
  if (!a || !b) return false;
  const la = [...a].length, lb = [...b].length;
  if (la > 30 || lb > 30) return false;
  return Math.max(la, lb) <= 3 * Math.min(la, lb) + 2;
};

/** Degenerate: the model looped. Low type/token ratio over a long text. */
const isDegenerate = t => {
  const w = words(t).filter(x => x.length > 1);
  return w.length >= 120 && new Set(w).size / w.length < 0.15;
};
/** Untagged commentary standing in for a transcription. */
const META_RE = /(\bi(?:'ll| will| am going to)\s+(?:provide|transcribe|include)|\bhere is the (?:transcription|text)\b|\bthe image shows\b|->\s*wait\b|\blet me (?:transcribe|check|re-?read)\b)/i;

/** Word-level LCS; returns substitution spans (same slot, read two ways). */
function substitutions(A, B) {
  const n = A.length, m = B.length;
  if (!n || !m || n * m > 4_000_000) return [];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      L[i][j] = A[i - 1] === B[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
  const ops = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) { ops.push(['same', i - 1, j - 1]); i--; j--; }
    else if (L[i - 1][j] >= L[i][j - 1]) { ops.push(['del', i - 1, j]); i--; }
    else { ops.push(['ins', i, j - 1]); j--; }
  }
  while (i > 0) { i--; ops.push(['del', i, 0]); }
  while (j > 0) { j--; ops.push(['ins', 0, j]); }
  ops.reverse();
  // A substitution is one slot read two ways, and it can surface as del->ins OR
  // ins->del depending on how the backtrack broke ties before the reverse. Matching
  // only one order silently produced ZERO substitutions on every page — the script
  // ran clean and emitted an empty manifest.
  const out = [];
  for (let k = 0; k < ops.length - 1; k++) {
    const [t1, x1, y1] = ops[k], [t2, x2, y2] = ops[k + 1];
    if (t1 === 'del' && t2 === 'ins') { out.push({ ai: x1, bi: y2, a: A[x1], b: B[y2] }); k++; }
    else if (t1 === 'ins' && t2 === 'del') { out.push({ ai: x2, bi: y1, a: A[x2], b: B[y1] }); k++; }
  }
  return out.filter(o => o.a != null && o.b != null && o.a !== o.b);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SOURCE)) { console.error(`missing inventory: ${SOURCE}`); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  // Verified-same-leaf pages only. An unverified pair might be two different leaves,
  // and asking a volunteer "which of these matches the image" when NEITHER does is
  // a waste of the scarcest resource in the project.
  const candidates = [];
  for await (const line of readline.createInterface({ input: fs.createReadStream(SOURCE), crlfDelay: Infinity })) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!r.double_ocr || r.leaf_evidence !== 'verified-same-leaf') continue;
    candidates.push(r);
  }
  console.log(`${candidates.length.toLocaleString()} verified-same-leaf pages available`);

  // Spread across books: one page per book, then shuffle deterministically.
  const seenBook = new Set();
  const pool = [];
  for (const r of candidates) {
    if (seenBook.has(r.book_id)) continue;
    seenBook.add(r.book_id);
    pool.push(r);
  }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  console.log(`${pool.length.toLocaleString()} distinct books in the pool`);

  const items = [], key = [];
  let pagesUsed = 0, goldCount = 0, skippedScript = 0, skippedSpan = 0;
  const seenSpan = new Set();
  for (const r of pool) {
    if (items.length >= WANT) break;
    const pg = await db.collection('pages').findOne({ id: r.page_id },
      { projection: { 'ocr.data': 1, 'ocr.model': 1, archived_photo: 1, display_photo: 1, photo: 1, page_number: 1 } });
    const rev = await db.collection('page_revisions').findOne({ page_id: r.page_id, field: 'ocr' },
      { sort: { created_at: -1 }, projection: { data: 1, model: 1 } });
    if (!pg?.ocr?.data || !rev?.data) continue;
    const image = pg.archived_photo || pg.display_photo || pg.photo;
    if (!image) continue;

    // A degenerate or commentary side makes a GOLD item: the answer is known, and a
    // volunteer who picks the loop is not looking at the page.
    const degPrior = isDegenerate(rev.data), degCurr = isDegenerate(pg.ocr.data);
    const metaPrior = META_RE.test(rev.data.slice(0, 1200)), metaCurr = META_RE.test(pg.ocr.data.slice(0, 1200));
    const goldSide = (degPrior || metaPrior) && !(degCurr || metaCurr) ? 'current'
      : (degCurr || metaCurr) && !(degPrior || metaPrior) ? 'prior' : null;

    const script = dominantScript(pg.ocr.data) || dominantScript(rev.data);
    if (script && !SPACED_SCRIPTS.has(script)) { skippedScript++; continue; }

    const A = words(rev.data), B = words(pg.ocr.data);
    const subs = substitutions(A, B);
    if (!subs.length) continue;
    pagesUsed++;

    let taken = 0;
    for (const s of subs) {
      if (taken >= PER_PAGE || items.length >= WANT) break;
      // Skip pure punctuation/number noise — nothing to judge.
      if (!/\p{L}/u.test(s.a) && !/\p{L}/u.test(s.b)) continue;
      if (!plausibleSpan(s.a, s.b)) { skippedSpan++; continue; }
      // The same disputed word often recurs on a page (a running head, a repeated
      // phrase). Asking the same question five times wastes the volunteer.
      const spanKey = `${r.page_id}|${s.a}|${s.b}`;
      if (seenSpan.has(spanKey)) continue;
      seenSpan.add(spanKey);
      const before = B.slice(Math.max(0, s.bi - CONTEXT), s.bi).join(' ');
      const after = B.slice(s.bi + 1, s.bi + 1 + CONTEXT).join(' ');
      const flip = rand() < 0.5;                      // blind: randomise presentation
      const isGold = goldSide != null && rand() < 0.5;
      if (isGold) goldCount++;
      const id = `${r.page_id}:${s.bi}`;
      items.push({
        item_id: id,
        image,
        reader_url: r.book_slug ? `${SITE}/book/${r.book_slug}/page/${r.page_id}` : null,
        page_number: pg.page_number ?? null,
        language: r.language, year: r.year,
        stratum: `${r.language || 'Unknown'} | ${r.year || '?'}`,
        context_before: before,
        option_a: flip ? s.b : s.a,
        option_b: flip ? s.a : s.b,
        context_after: after,
        question: 'Which reading matches the image at this point?',
        answers: ['A', 'B', 'neither', "can't tell — scan unreadable"],
        gold: isGold,
        overlap: rand() < OVERLAP,      // give to a second volunteer
      });
      // The key is written SEPARATELY so the task file can be handed out without
      // leaking which option is the live text.
      key.push({
        item_id: id, page_id: r.page_id, book_id: r.book_id,
        option_a_is: flip ? 'current' : 'prior',
        option_b_is: flip ? 'prior' : 'current',
        prior_model: rev.model || null, current_model: pg.ocr.model || null,
        gold: isGold, gold_correct_side: isGold ? goldSide : null,
        gold_correct_option: isGold ? ((goldSide === 'current') === !flip ? 'B' : 'A') : null,
      });
      taken++;
    }
  }
  await client.close();

  fs.writeFileSync(OUT_JSONL, items.map(o => JSON.stringify(o)).join('\n') + '\n');
  fs.writeFileSync(OUT_KEY, key.map(o => JSON.stringify(o)).join('\n') + '\n');

  const langs = {};
  for (const it of items) langs[it.language || 'Unknown'] = (langs[it.language || 'Unknown'] || 0) + 1;
  const md = [
    `# Span adjudication items (${DATE})`, '',
    `${items.length.toLocaleString()} judgements drawn from ${pagesUsed.toLocaleString()} pages, at most ${PER_PAGE} per page,`,
    `one page per book. Each asks a volunteer to look at the scan and pick which of two`,
    `readings matches it — seconds per item, against 10–30 minutes to transcribe a page,`,
    `and it never asks a human to produce text whose own errors would then be`,
    `indistinguishable from the OCR errors being measured.`, '',
    '## What each item contains', '',
    '- the page image and a link to the reader',
    `- ${CONTEXT} words of context either side, taken from the CURRENT text so the volunteer`,
    '  can find the line on the page',
    '- two candidate readings, **blinded and order-randomised**, so nobody can score the',
    '  model instead of the page',
    "- four answers: A, B, neither, and \"can't tell — scan unreadable\". `neither` matters",
    '  because both passes are often wrong together on a hard hand, and a forced choice',
    "  would record that as a correct reading. \"Can't tell\" is evidence about the SCAN,",
    '  not the readings; pages that collect it are themselves a finding.', '',
    '## Quality controls', '',
    `- **${goldCount} gold items** (${(100 * goldCount / Math.max(1, items.length)).toFixed(1)}%) where one side is a repetition loop or model`,
    '  commentary rather than a transcription, so the answer is known. A volunteer who fails',
    '  these is not reading the image, and without them a careful annotator and a fast one',
    '  are indistinguishable.',
    `- **${items.filter(i => i.overlap).length} overlap items** (${(100 * items.filter(i => i.overlap).length / Math.max(1, items.length)).toFixed(1)}%) to be shown to a second volunteer.`,
    '  Without inter-annotator agreement, volunteer disagreement and OCR error are the same',
    '  number and the calibration is against noise.',
    `- the answer key is written to a SEPARATE file (\`${path.basename(OUT_KEY)}\`) so the task`,
    '  file can be handed out without leaking which option is the live text.', '',
    '## Rejected before a human sees them', '',
    `- ${skippedScript} pages in space-less scripts (Han, kana, Tibetan, Thai): a word-level task`,
    '  cannot pose a sensible question there, and they need a character-level variant',
    `- ${skippedSpan} spans whose two candidates were too dissimilar in length to be one word read`,
    '  two ways — the aligner slipping, not a reading',
    '- `<image-desc>` blocks, which are AI prose about a picture: a preview run asked whether',
    '  the page said "beginning" or "start" when nothing on the page said either', '',
    '## Coverage', '', '| language | items |', '|---|---:|',
    ...Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## What these answers buy', '',
    'Each adjudicated span is a labelled token: it converts "the two passes disagree, so at',
    'least one is wrong" — a lower bound — into an observed error rate per stratum. Pair it',
    'with the agreement measured on the same pages and the agreement→accuracy calibration',
    'stops resting on ~32 anchor pages.', '',
    '**Not covered by this task:** pages where both passes AGREE and are both wrong. Agreement',
    'is blind to recitation by construction, and no adjudication of disagreements can see it.',
    'That needs whole-page review of canonical texts, and it is the one question that cannot',
    'be answered by spending money instead of volunteer time.', '',
    `Items: \`${path.basename(OUT_JSONL)}\` · key: \`${path.basename(OUT_KEY)}\``, '',
  ].join('\n');
  fs.writeFileSync(OUT_REPORT, md);
  console.log(`\n${items.length} items from ${pagesUsed} pages · ${goldCount} gold · ${items.filter(i => i.overlap).length} overlap`);
  console.log(`→ ${OUT_JSONL}\n→ ${OUT_KEY}\n→ ${OUT_REPORT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
