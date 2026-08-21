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
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parseLanguageField, languageFamily } from '../lib/language-normalize.mjs';

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
    // 1. the same long opening appears on three or more pages
    const rep = byPrefix.get(r.text.slice(0, 60).toLowerCase()) || [];
    if (rep.length >= 3) reasons.push(`repeated_opening_x${rep.length}`);
    // 2. the declared language is a tiny minority of this book
    if (r.langs.length && tagged) {
      const share = Math.min(...r.langs.map((l) => (counts.get(l) || 0) / tagged));
      if (share <= 0.06) reasons.push(`minority_language_${(share * 100).toFixed(1)}pct`);
    }
    // 3. the declared language is not one the catalogue knows about at all
    if (r.langs.length && bookLangs.size && r.langs.every((l) => !bookLangs.has(l))) {
      const share = r.langs.length && tagged ? Math.min(...r.langs.map((l) => (counts.get(l) || 0) / tagged)) : 1;
      if (share <= 0.20) reasons.push('language_absent_from_catalogue');
    }
    if (reasons.length) flagged.push({ ...r, reasons });
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
  let screened = 0, photographed = 0, confirmed = 0;

  for (const b of list) {
    const docs = await pages.find({ book_id: b.id, 'ocr.data': { $type: 'string' } },
      { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, display_photo: 1, archived_photo: 1, photo: 1 } })
      .maxTimeMS(90000).toArray();
    const { flagged } = screen(b, docs);
    screened += flagged.length;

    for (const f of flagged) {
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
