#!/usr/bin/env node
/**
 * Find OCR text that was invented for a page that has (almost) nothing on it.
 *
 * WHY (#4149)
 * -----------
 * Four published books were confirmed to carry fluent early-modern Latin on
 * BLANK leaves — `Zuni Fetiches` (English ethnography), `Geschichte der
 * Hexenprozesse` (German), `The Sushruta Samhita` (English Ayurveda) and
 * `Spanda-Karikas` (Kashmir Shaivism). The model does not decline an unreadable
 * page; it falls into an attractor and writes scholastic Latin, complete with an
 * invented running header, signature mark, decorative initial and page number.
 * A fabricated page number means a fabricated citation, which is the failure
 * `.claude/docs/invariants/quote-and-snippet-integrity.md` exists to prevent.
 *
 * TEXT HEURISTICS ARE A SCREEN, NOT A DETECTOR. Measured against the three
 * cases known when this was written, every single-signal probe missed at least
 * one:
 *
 *   probe                                    Zuni  Hexen  Sushruta
 *   repeated block, key = chars 40..260      miss  miss   flag
 *   repeated block, key = first 60 chars     flag  miss   flag
 *   declared language <=6% of the book       miss  flag   flag
 *
 * So the screen is the UNION of several weak signals, and the verdict comes
 * from the page image: a leaf whose ink coverage is near zero cannot be the
 * source of 1,000 characters of transcription. Screening is cheap; only
 * screened pages are ever downloaded and measured.
 *
 * This script NEVER writes. Quarantine is a separate, reviewed step.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/detect-fabricated-ocr.mjs --book-id=<id>
 *   node scripts/audit/detect-fabricated-ocr.mjs --books=300 --out=scripts/output/fabricated.jsonl
 *
 * Flags:
 *   --books=N        how many random live books to screen (default 200)
 *   --book-id=ID     screen one book (repeatable via comma separation)
 *   --out=FILE       JSONL of confirmed + screened rows
 *   --ink=F          ink-coverage fraction below which a page counts as blank (default 0.004)
 *   --min-body=N     characters of OCR body text that make a claim worth testing (default 300)
 *   --max-images=N   safety cap on page images downloaded (default 400)
 *   --no-images      screen only; skip the authoritative image check
 *
 * RULE `self_declared_blank` (#4149, 2026-10-02) — `--self-declared-blank`
 * ---------------------------------------------------------------------
 * The language screen above is blind to a page invented in the book's OWN
 * language. A second, independent signal: the model often SAYS the leaf is
 * blank — `<page-type>blank</page-type>`, or a `<warning>`/`<meta>`/
 * `<image-desc>` reading "blank", "show-through", "mirrored" — and then
 * transcribes a body anyway. Measured on the 409 confirmed fabrications vs 409
 * `has_ink` controls (pages still holding the scored text, 305 / 276): any such
 * tag on 46.6% of fabrications vs 4.7% of controls. The rule fires when body
 * letters (outside the apparatus tags) exceed 20 AND one of those tags fires.
 *
 * It matters most for SHOW-THROUGH leaves: bleed-through measures as ink, so
 * the write-time pixel guard (#4184) and the quarantine tool both let them pass.
 *
 * The walk covers the whole `pages` collection with a server-side regex
 * prefilter and a checkpoint, one phase per `_id` BSON type (see
 * backfill-script-type-4195.mjs for why). Read-only; writes a JSONL of
 * flagged pages, never the database.
 *
 *   node --env-file=.env.production.local scripts/audit/detect-fabricated-ocr.mjs \
 *     --self-declared-blank [--out=scripts/output/self-declared-blank-<date>.jsonl] \
 *     [--checkpoint=F] [--reset] [--limit=N]
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parseLanguageField, languageFamily } from '../lib/language-normalize.mjs';
import { bodyText } from '../eval/blank-page-study.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const N_BOOKS = Number(arg('books', '200'));
const BOOK_IDS = arg('book-id', '').split(',').filter(Boolean);
const OUT = arg('out', 'scripts/output/fabricated-ocr.jsonl');
const INK_MAX = Number(arg('ink', '0.004'));
const MIN_BODY = Number(arg('min-body', '300'));
const MAX_IMAGES = Number(arg('max-images', '400'));
const NO_IMAGES = flag('no-images');
/** Also screen on the weak signals alone. Useful for tuning, useless for rates. */
const INCLUDE_WEAK = flag('include-weak');
/** Seed for choosing WHICH flagged pages get measured when the cap bites. */
const SEED = Number(arg('seed', '4149'));

/** Metadata elements whose CONTENTS are not transcription. */
const META = ['language', 'page-type', 'script', 'quality', 'scan-quality', 'image-desc',
  'vocab', 'header', 'sig', 'page-num', 'catchword', 'meta'];

function body(data) {
  let out = data || '';
  for (const t of META) {
    out = out.replace(new RegExp(`<${t}[^>]*>[\\s\\S]*?</${t}>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${t}[^>]*/?>`, 'gi'), ' ');
  }
  return out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ink coverage: fraction of pixels meaningfully darker than the page ground.
 * Uses the image's own bright end as the ground so that grey/yellowed scans are
 * not read as covered in ink. Returns null if the image cannot be read.
 */
export async function inkCoverage(buf) {
  try {
    const img = sharp(buf, { failOn: 'none' }).greyscale().resize(400, null, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const hist = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    const total = info.width * info.height;
    // Page ground = the 95th brightness percentile.
    let seen = 0, ground = 255;
    for (let v = 255; v >= 0; v--) {
      seen += hist[v];
      if (seen >= total * 0.05) { ground = v; break; }
    }
    const threshold = Math.max(0, ground - 60);
    let dark = 0;
    for (let v = 0; v <= threshold; v++) dark += hist[v];
    return { coverage: dark / total, ground, threshold, pixels: total };
  } catch {
    return null;
  }
}

/** What a tag says when the model itself thinks the leaf carries nothing of its own. */
export const BLANKISH = /\b(blank|empty|no (visible )?text|no content|unprinted|nothing (is )?(written|printed)|show-?through|bleed-?through|mirror(ed)?|reversed|offset)\b/i;
/**
 * Server-side prefilter for the corpus walk. Must stay a SUPERSET of
 * `selfDeclaredBlank` (a term missing here is a page silently never scored) —
 * hence unanchored stems. It only sees tag contents up to the first `<`.
 */
const BLANK_WORDS = /\b(blank|empty|no (visible )?text|no content|unprinted|nothing (is )?(written|printed))\b/i;
const SHOWTHROUGH_WORDS = /\b(show-?through|bleed-?through|mirror(ed)?|reversed|offset)\b/i;
export const SELF_DECLARED_PREFILTER =
  '<(page-type|warning|meta|image-desc)[^>]*>[^<]*(blank|empty|no (visible )?text|no content|unprinted|nothing|show-?through|bleed-?through|mirror|reversed|offset)';
const SELF_DECLARED_MIN_LETTERS = 20;

const tagContents = (t, n) => (t.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'gi')) || [])
  .map((m) => m.replace(/<[^>]+>/g, ' ').trim());

/**
 * Rule `self_declared_blank`: the page's own tags say blank, its body has text.
 * Returns `{ signals, bodyLetters, body }` when it fires, else null.
 */
export function selfDeclaredBlank(data) {
  if (typeof data !== 'string') return null;
  const body = bodyText(data);
  const bodyLetters = (body.match(/\p{L}/gu) || []).length;
  if (bodyLetters <= SELF_DECLARED_MIN_LETTERS) return null;
  const signals = [];
  if (tagContents(data, 'page-type').some((v) => v.toLowerCase() === 'blank')) signals.push('page_type_blank');
  // Each tag signal is recorded with the CLASS of word that fired it. On the first
  // 3,000 prefiltered pages the show-through class was dominated by routine quality
  // notes on real pages ("some bleed-through from the reverse, text legible"), so
  // the two classes must be measured separately or the blank class drowns.
  for (const t of ['warning', 'meta', 'image-desc']) {
    const vals = tagContents(data, t);
    const name = t.replace('-', '_');
    if (vals.some((v) => BLANK_WORDS.test(v))) signals.push(`${name}:blank`);
    if (vals.some((v) => SHOWTHROUGH_WORDS.test(v))) signals.push(`${name}:showthrough`);
  }
  return signals.length ? { signals, bodyLetters, body } : null;
}

/**
 * Frozen fixtures (measurement-instruments.md: a positive control the corpus
 * can repair out from under you is not a control). The first is the shape of a
 * confirmed #4149 fabrication; the second a real page that merely mentions
 * show-through in passing — which DOES fire, by design: that is the false
 * positive the precision sample exists to measure.
 */
const SELF_DECLARED_FIXTURES = [
  ['<language>Latin</language><page-type>blank</page-type><warning>Page is blank; faint show-through of the verso text.</warning>Quod autem in hoc negotio, & in aliis omnibus, quæ ad salutem animarum pertinent', ['page_type_blank', 'warning:blank', 'warning:showthrough']],
  ['<page-type>blank</page-type><warning>Blank page with show-through.</warning>', null],
  ['<page-type>text</page-type><warning>Some foxing in the lower margin.</warning>Quod autem in hoc negotio, & in aliis omnibus, quæ ad salutem', null],
];
function selfTestSelfDeclared() {
  for (const [text, want] of SELF_DECLARED_FIXTURES) {
    const got = selfDeclaredBlank(text)?.signals ?? null;
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`self_declared_blank fixture failed: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    if (want && !new RegExp(SELF_DECLARED_PREFILTER, 'i').test(text)) throw new Error('prefilter misses a fixture the rule fires on');
  }
}

async function walkSelfDeclaredBlank() {
  selfTestSelfDeclared();
  const date = new Date().toISOString().slice(0, 10);
  const out = arg('out', `scripts/output/self-declared-blank-${date}.jsonl`);
  const checkpoint = arg('checkpoint', out.replace(/\.jsonl$/, '.checkpoint.json'));
  const limit = Number(arg('limit', '0'));
  const PHASES = ['string', 'objectId'];
  const cp = (!flag('reset') && fs.existsSync(checkpoint))
    ? JSON.parse(fs.readFileSync(checkpoint, 'utf8'))
    : { phase: 0, last_id: null, prefiltered: 0, flagged: 0, by_signal: {} };
  const save = () => fs.writeFileSync(checkpoint, JSON.stringify(cp));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Resume appends. The checkpoint lags the sink by up to 2,000 pages, so a crash
  // can re-emit rows on resume: dedupe on page_id before counting.
  const sink = fs.createWriteStream(out, { flags: cp.last_id == null && cp.phase === 0 ? 'w' : 'a' });

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const pages = client.db('bookstore').collection('pages');
  const started = Date.now();
  let thisRun = 0;
  try {
    while (cp.phase < PHASES.length) {
      const phase = PHASES[cp.phase];
      const filter = { 'ocr.data': { $regex: SELF_DECLARED_PREFILTER, $options: 'i' } };
      // `$gt` compares within one BSON type only, so each phase keeps its native type.
      filter._id = cp.last_id == null ? { $type: phase }
        : { $type: phase, $gt: phase === 'objectId' ? new ObjectId(cp.last_id) : cp.last_id };
      const cursor = pages.find(filter, {
        projection: { _id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.source': 1 },
      }).sort({ _id: 1 }).batchSize(500).maxTimeMS(14400000);
      let n = 0;
      for await (const d of cursor) {
        n++; thisRun++; cp.prefiltered++;
        const hit = selfDeclaredBlank(d.ocr?.data);
        if (hit) {
          cp.flagged++;
          for (const s of hit.signals) cp.by_signal[s] = (cp.by_signal[s] || 0) + 1;
          sink.write(JSON.stringify({
            page_id: String(d._id), book_id: d.book_id, page_number: d.page_number,
            signals: hit.signals, body_letters: hit.bodyLetters,
            model: d.ocr?.model ?? null, prompt_version: d.ocr?.prompt_version ?? null, source: d.ocr?.source ?? null,
            opening: hit.body.slice(0, 140),
          }) + '\n');
        }
        cp.last_id = String(d._id);
        if (n % 2000 === 0) {
          save();
          if (n % 20000 === 0) {
            const rate = Math.round(thisRun / ((Date.now() - started) / 1000));
            console.log(`  [${phase}] prefiltered ${cp.prefiltered} (${rate}/s) · flagged ${cp.flagged} · ${JSON.stringify(cp.by_signal)} · at ${cp.last_id}`);
          }
        }
        if (limit && thisRun >= limit) break;
      }
      if (limit && thisRun >= limit) break;
      cp.phase++; cp.last_id = null; save();
    }
  } finally {
    save();
    await new Promise((r) => sink.end(r));
    await client.close();
  }
  console.log(JSON.stringify({ complete: cp.phase >= PHASES.length, ...cp, out, checkpoint }, null, 2));
  console.log('\nNothing was written to the database (#4149).');
}

/** Weak signals. Any one of them makes a page worth photographing. */
function screen(book, docs) {
  const counts = new Map();
  let tagged = 0;
  const rows = [];
  for (const d of docs) {
    const tag = (d.ocr?.data?.match(/<language>([^<]{0,60})<\/language>/) || [])[1];
    const langs = parseLanguageField(tag).map(languageFamily);
    const text = body(d.ocr?.data);
    if (langs.length) {
      tagged++;
      for (const l of langs) counts.set(l, (counts.get(l) || 0) + 1);
    }
    rows.push({ page: d.page_number, langs, text, model: d.ocr?.model, source: d.ocr?.source, img: d.display_photo || d.archived_photo || d.photo });
  }

  const bookLangs = new Set(parseLanguageField(book.language).map(languageFamily));
  const byPrefix = new Map();
  for (const r of rows) {
    if (r.text.length < MIN_BODY) continue;
    const k = r.text.slice(0, 60).toLowerCase();
    if (!byPrefix.has(k)) byPrefix.set(k, []);
    byPrefix.get(k).push(r.page);
  }

  const flagged = [];
  for (const r of rows) {
    if (r.text.length < MIN_BODY) continue;
    const reasons = [];

    // PRIMARY signal. Measured over 600 page images (2026-08-21): this is the
    // only one that predicts anything — 4 confirmed of 188 measured (2.1%).
    // A blank leaf gets a language the book does not otherwise contain, because
    // the fabrication is drawn from the model's prior, not from the book.
    let primary = false;
    if (r.langs.length && bookLangs.size && r.langs.every((l) => !bookLangs.has(l))) {
      const share = tagged ? Math.min(...r.langs.map((l) => (counts.get(l) || 0) / tagged)) : 1;
      if (share <= 0.20) { reasons.push('language_absent_from_catalogue'); primary = true; }
    }

    // SUPPORTING signals. Neither fires usefully on its own — measured
    // 0 confirmed of 316 for repeated openings and 0 of 135 for minority
    // language. They earn their place by sharpening a primary hit (all four
    // confirmed pages in the first sweep also repeated an opening), so they are
    // recorded but never trigger a download by themselves. Flagging on them
    // alone produced 8,533 useless candidates in 1,000 books — legitimate
    // running heads, indexes and catalogue entries repeat openings constantly.
    const rep = byPrefix.get(r.text.slice(0, 60).toLowerCase()) || [];
    if (rep.length >= 3) reasons.push(`repeated_opening_x${rep.length}`);
    if (r.langs.length && tagged) {
      const share = Math.min(...r.langs.map((l) => (counts.get(l) || 0) / tagged));
      if (share <= 0.06) reasons.push(`minority_language_${(share * 100).toFixed(1)}pct`);
    }

    if (primary || (INCLUDE_WEAK && reasons.length)) flagged.push({ ...r, reasons, primary });
  }
  return { flagged, tagged, counts };
}

async function main() {
  // Guarded HERE, not at module scope: `quarantine-fabricated-ocr.mjs` imports
  // inkCoverage from this file and is legitimately invoked with --apply. A
  // top-level check reads that argv and refused the caller's own flag.
  if (flag('apply') || flag('fix')) {
    console.error('This script never writes. Quarantining fabricated OCR is a reviewed, separate step (#4149).');
    process.exit(2);
  }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  if (flag('self-declared-blank')) return walkSelfDeclaredBlank();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const list = BOOK_IDS.length
    ? await books.find({ id: { $in: BOOK_IDS } }, { projection: { id: 1, title: 1, language: 1 } }).toArray()
    : await books.aggregate([
        { $match: { visible: true, pages_ocr: { $gt: 10 } } },
        { $sample: { size: N_BOOKS } },
        { $project: { id: 1, title: 1, language: 1 } },
      ], { maxTimeMS: 180000 }).toArray();

  const sink = fs.createWriteStream(OUT, { flags: 'w' });
  let photographed = 0, confirmed = 0;

  // Screen EVERY book first, then choose which flagged pages to photograph.
  // Measuring in encounter order until the cap bites measures import order, not
  // the corpus: the first sweep's 600 images all came from the earliest books,
  // so its per-signal precision could not be read as a rate. Shuffle with a
  // fixed seed instead, so the cap yields a reproducible random subsample.
  const allFlagged = [];
  for (const b of list) {
    const docs = await pages.find({ book_id: b.id, 'ocr.data': { $type: 'string' } },
      { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, display_photo: 1, archived_photo: 1, photo: 1 } })
      .maxTimeMS(90000).toArray();
    for (const f of screen(b, docs).flagged) allFlagged.push({ ...f, book: b });
  }
  const screened = allFlagged.length;

  let s = SEED >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = allFlagged.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [allFlagged[i], allFlagged[j]] = [allFlagged[j], allFlagged[i]];
  }

  {
    for (const f of allFlagged) {
      const b = f.book;
      let ink = null;
      if (!NO_IMAGES && f.img && photographed < MAX_IMAGES) {
        try {
          const res = await fetch(f.img);
          if (res.ok) {
            ink = await inkCoverage(Buffer.from(await res.arrayBuffer()));
            photographed++;
          }
        } catch { /* leave ink null — an unreadable image is not evidence either way */ }
      }
      const verdict = ink == null ? 'unverified' : (ink.coverage <= INK_MAX ? 'FABRICATED' : 'has_ink');
      if (verdict === 'FABRICATED') confirmed++;
      sink.write(JSON.stringify({
        book_id: b.id, title: b.title, catalogued: b.language,
        page: f.page, langs: f.langs, model: f.model, source: f.source,
        chars: f.text.length, reasons: f.reasons,
        ink_coverage: ink ? Number(ink.coverage.toFixed(5)) : null,
        verdict, opening: f.text.slice(0, 140), image: f.img,
      }) + '\n');
      if (verdict === 'FABRICATED') {
        console.log(`FABRICATED  ${b.title.slice(0, 40).padEnd(40)} p.${String(f.page).padStart(5)}  ` +
          `${f.langs.join('/')}  ink=${(ink.coverage * 100).toFixed(3)}%  ${f.text.length}ch  [${f.reasons.join(' ')}]`);
      }
    }
  }

  await new Promise((r) => sink.end(r));
  await client.close();
  console.log(`\nbooks screened: ${list.length}`);
  console.log(`pages flagged by the text screen: ${screened}`);
  console.log(`page images measured: ${photographed}${photographed >= MAX_IMAGES ? ' (hit --max-images cap)' : ''}`);
  console.log(`CONFIRMED fabricated (ink <= ${(INK_MAX * 100).toFixed(2)}%): ${confirmed}`);
  console.log(`rows -> ${OUT}`);
  console.log('\nNothing was written to the database. Quarantine is a separate reviewed step (#4149).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
