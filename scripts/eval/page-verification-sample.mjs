#!/usr/bin/env node
/**
 * Draw a reproducible, stratified page sample for per-book OCR verification, and
 * score the verdicts into TWO independent numbers (#3592).
 *
 * WHY TWO NUMBERS
 *   A single "N% accurate" headline is a claim about a denominator we cannot
 *   support. On Kitab al-Bulhan ~40% of pages are numeral tables; nobody — human
 *   or model — can confirm from a scan whether an abjad cell reads ١٧ or ١٨. A
 *   figure derived from prose pages, quoted book-wide, silently generalises the
 *   part we can read onto the part we cannot. So we report:
 *
 *     TRANSCRIPTION AGREEMENT  — prose pages only, denominator stated.
 *     COVERAGE (grounded rate) — ALL page classes.
 *
 *   Coverage is the one that generalises and the one nobody currently measures.
 *   It asks: does every line of stored text correspond to visible ink, or is the
 *   model writing over a hole? In the #3591 pilot, page 60 of Kitab al-Bulhan
 *   would have scored EXCELLENT on agreement while being partly fabricated —
 *   invented text is more fluent than real transcription, not less.
 *
 * WHY A SECOND PASS IS NOT GROUND TRUTH
 *   The verifier (human or model) re-reads the same scan. On formulaic text two
 *   passes can recite the same memorised template and agree perfectly, so
 *   agreement measures CONSISTENCY. Only coverage catches invention. Nothing
 *   here should be presented as an accuracy certificate.
 *
 * WHY STRATIFY
 *   Prose / table / damaged / illustration pages fail in completely different
 *   ways. A uniform draw returns mostly whatever the book is mostly made of and
 *   says little about the rest. Damaged pages are deliberately OVER-sampled:
 *   that is where fabrication lives, and a proportional draw would mostly miss
 *   them.
 *
 * ABSTAIN IS A FIRST-CLASS OUTCOME
 *   "Could not verify at available resolution" must be reported, never folded
 *   into a pass. Dense 22-line naskh at our scan resolution is at the edge of
 *   what a second reader can check; an 8-line page is comfortable. A harness
 *   that cannot say "I don't know" manufactures confidence.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *
 *   # 1. draw the sample (writes a work-list; free, no model cost)
 *   node scripts/eval/page-verification-sample.mjs draw \
 *     --book 6953b56577f38f6761bd979d --n 30 --seed 20260804 \
 *     --out scripts/eval/results/verify-wonders.jsonl
 *
 *   # 2. a verifier fills in a verdict per row (see VERDICT SCHEMA below)
 *
 *   # 3. score the verdicts into the two numbers
 *   node scripts/eval/page-verification-sample.mjs report \
 *     --verdicts scripts/eval/results/verify-wonders-verdicts.jsonl
 *
 * VERDICT SCHEMA (one JSON object per line)
 *   {
 *     "page_number": 60,
 *     "coverage": "grounded" | "fabricated" | "partial" | "abstain",
 *     "transcription": null | 0.0-1.0 | "abstain",
 *     "note": "free text — why, and what was checked"
 *   }
 *   coverage       does every line of stored text correspond to visible ink?
 *                  "partial" = some of the page is grounded and some invented.
 *   transcription  agreement of an INDEPENDENT read with the stored OCR.
 *                  Only meaningful on prose; leave null elsewhere.
 *
 * READ-ONLY against Mongo. Drawing and reporting cost nothing.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const [, , cmd, ...rest] = process.argv;
const argVal = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : null);

// ── page classification (stratification only; never used in scoring) ──────────

const ZERO_WIDTH = /[​-‏⁠﻿]/g;
const WRAPPERS =
  /<(language|lang|page-type|scan-quality|script|columns|warning|meta|summary|keywords|vocab|image-desc)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
const TABLE_ROW = /^[ \t]*\|.+\|[ \t]*$/m;
const UNCLEAR = /<unclear(?:\s[^>]*)?>/gi;

function bodyOf(raw) {
  return raw
    .replace(WRAPPERS, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Damage is judged from the OCR's OWN signals — its `<warning>` text and its
 * `<unclear>` density — not from the image, because we have not looked at the
 * image yet. That is the point of the draw: pick what to look at.
 */
function classify(page) {
  const raw = page.ocr?.data || '';
  const type = (page.page_type || '').toLowerCase();
  const warning = (raw.match(/<warning(?:\s[^>]*)?>([\s\S]*?)<\/warning>/i)?.[1] || '').toLowerCase();
  const unclearCount = (raw.match(UNCLEAR) || []).length;
  const body = bodyOf(raw);

  const damaged =
    /\b(damag|torn|tear|loss|missing|obscur|faded|stain|repair|worm|illegible)\w*/.test(warning)
    || unclearCount >= 4;

  if (damaged) return 'damaged';
  if (TABLE_ROW.test(raw)) return 'table';
  if (['blank', 'exlibris', 'bookplate'].includes(type)) return 'blank';
  if (body.length < 120 && /<image-desc/i.test(raw)) return 'illustration';
  return 'prose';
}

/** Target mix. Damaged is over-weighted deliberately (see header). */
const STRATA = [
  ['prose', 0.40],
  ['table', 0.20],
  ['damaged', 0.25],
  ['illustration', 0.10],
  ['blank', 0.05],
];

// mulberry32 — small, seeded, reproducible. The seed goes in the output so a
// reviewer can redraw the identical sample.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFrom(pool, n, rnd) {
  const a = pool.slice();
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
  return out;
}

// ── commands ─────────────────────────────────────────────────────────────────

async function draw() {
  const bookId = argVal('--book');
  const n = Number(argVal('--n') || 30);
  const seed = Number(argVal('--seed') || 20260804);
  const out = argVal('--out');
  if (!bookId || !out) {
    console.error('usage: draw --book <id> --n 30 --seed 20260804 --out <file.jsonl>');
    process.exit(2);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const pages = await client
    .db('bookstore')
    .collection('pages')
    .find({ book_id: bookId }, {
      projection: {
        page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1,
        archived_photo: 1, display_photo: 1, photo: 1,
      },
    })
    .sort({ page_number: 1 })
    .toArray();
  await client.close();

  if (!pages.length) {
    console.error(`no pages for book ${bookId}`);
    process.exit(2);
  }

  const buckets = {};
  for (const p of pages) (buckets[classify(p)] ||= []).push(p);

  const rnd = mulberry32(seed);
  const picked = [];
  for (const [name, share] of STRATA) {
    const want = Math.round(n * share);
    const got = drawFrom(buckets[name] || [], want, rnd);
    picked.push(...got.map((p) => ({ p, cls: name })));
    if (got.length < want) {
      console.warn(`stratum "${name}": wanted ${want}, book only has ${(buckets[name] || []).length}`);
    }
  }
  picked.sort((a, b) => a.p.page_number - b.p.page_number);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fh = fs.createWriteStream(out);
  fh.write(JSON.stringify({
    _meta: true, book_id: bookId, seed, requested: n, drawn: picked.length,
    population: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    generated_at: new Date().toISOString(),
  }) + '\n');
  for (const { p, cls } of picked) {
    fh.write(JSON.stringify({
      page_number: p.page_number,
      page_class: cls,
      page_type: p.page_type || null,
      image_url: p.archived_photo || p.display_photo || p.photo || null,
      stored_ocr: (p.ocr?.data || '').replace(ZERO_WIDTH, ''),
      stored_translation: (p.translation?.data || '').replace(ZERO_WIDTH, ''),
      // verifier fills these:
      coverage: null,
      transcription: null,
      note: '',
    }) + '\n');
  }
  fh.end();

  console.log(`\ndrew ${picked.length} pages from ${pages.length} (seed ${seed})`);
  console.log('population by class:');
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
    const got = picked.filter((x) => x.cls === k).length;
    console.log(`  ${k.padEnd(14)} ${String(v.length).padStart(5)} in book → ${got} sampled`);
  }
  console.log(`\nwrote ${out}`);
  console.log('Fill in coverage + transcription per row, then run `report --verdicts <file>`.\n');
}

function report() {
  const file = argVal('--verdicts');
  if (!file) {
    console.error('usage: report --verdicts <file.jsonl>');
    process.exit(2);
  }
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = rows.find((r) => r._meta) || {};
  const scored = rows.filter((r) => !r._meta);

  const cov = scored.filter((r) => r.coverage && r.coverage !== 'abstain');
  const covAbstain = scored.filter((r) => r.coverage === 'abstain').length;
  const covUnscored = scored.filter((r) => !r.coverage).length;
  const grounded = cov.filter((r) => r.coverage === 'grounded').length;

  const tr = scored.filter((r) => typeof r.transcription === 'number');
  const trAbstain = scored.filter((r) => r.transcription === 'abstain').length;
  const trProse = tr.filter((r) => r.page_class === 'prose');

  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  console.log('\npage verification report');
  console.log('─'.repeat(64));
  console.log(`book ${meta.book_id || '(unknown)'}   seed ${meta.seed ?? '(unknown)'}   drawn ${scored.length}`);

  console.log('\n1. COVERAGE — does stored text correspond to visible ink?  [ALL classes]');
  console.log(`   grounded            ${grounded} / ${cov.length}   ${pct(grounded, cov.length)}`);
  for (const v of ['partial', 'fabricated']) {
    const k = cov.filter((r) => r.coverage === v).length;
    if (k) console.log(`   ${v.padEnd(20)}${k} / ${cov.length}   ${pct(k, cov.length)}`);
  }
  console.log(`   abstained           ${covAbstain}${covUnscored ? `   (unscored: ${covUnscored})` : ''}`);
  console.log('   by class:');
  for (const [name] of STRATA) {
    const inClass = cov.filter((r) => r.page_class === name);
    if (!inClass.length) continue;
    const g = inClass.filter((r) => r.coverage === 'grounded').length;
    console.log(`     ${name.padEnd(14)} ${g}/${inClass.length}  ${pct(g, inClass.length)}`);
  }

  console.log('\n2. TRANSCRIPTION AGREEMENT — independent re-read vs stored OCR  [PROSE only]');
  const m = mean(trProse.map((r) => r.transcription));
  console.log(`   mean agreement      ${m === null ? '— not measurable' : m.toFixed(3)}   n=${trProse.length}`);
  console.log(`   abstained           ${trAbstain}`);
  if (tr.length > trProse.length) {
    console.log(`   (${tr.length - trProse.length} non-prose scores recorded but EXCLUDED — see header)`);
  }

  const unverifiable = scored.filter((r) => r.page_class === 'table').length;
  console.log('\nCAVEATS — quote these with the numbers, not instead of them:');
  console.log('  · Agreement measures CONSISTENCY, not accuracy. Two passes can recite the');
  console.log('    same memorised formula and agree perfectly; only coverage catches invention.');
  console.log(`  · ${unverifiable} sampled page(s) are tables. Numeral cells are not verifiable`);
  console.log('    from a scan by any second reader, so no transcription figure covers them.');
  console.log('  · Damaged pages are OVER-sampled by design, so the coverage rate is not a');
  console.log('    book-wide expectation — it is a stress test of the failure mode.\n');
}

const main = { draw, report }[cmd];
if (!main) {
  console.error('usage: page-verification-sample.mjs <draw|report> [options]  (see file header)');
  process.exit(2);
}
// `draw` is async, `report` is sync — normalise so both surface errors.
Promise.resolve(main()).catch((e) => { console.error(e); process.exit(2); });
