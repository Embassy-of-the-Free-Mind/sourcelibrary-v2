#!/usr/bin/env node
/**
 * Export the OCR-eval observations as a self-contained, publishable dataset (#3235).
 *
 * Emits scripts/eval/dataset/<version>/ with:
 *   pages.jsonl       one row per pinned page: book + page metadata, page_class
 *                     covariates, and MEASURED image resolution (width/height/bytes,
 *                     fetched from the same image URL the models OCR'd)
 *   references.jsonl  one row per reference passage: provenance + license; the text
 *                     itself is included ONLY where the source license permits
 *                     redistribution — otherwise sha256 + retrieval instructions
 *   runs.jsonl        one row per (page × model × run): raw model output (ours),
 *                     scores re-derived at export time, scoring_version
 *   README.md         datasheet (written separately, not by this script)
 *   checksums.txt     sha256 of each jsonl
 *
 * Reference-license policy (conservative by design):
 *   include   First1KGreek (CC-BY-SA), Wikisource (CC BY-SA), Living Poets (CC-BY/PD),
 *             Clementine Vulgate via drbo (PD text), Sefaria versions marked
 *             Public Domain / CC0 / CC-BY
 *   pointer   TITUS (site forbids republication), ctext.org (terms restrict
 *             redistribution), any Sefaria version with unknown license
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/export-eval-dataset.mjs [--version=v0.1] [--obs=path.jsonl]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getPageSource } from '../lib/page-image-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const VERSION = args.version || 'v0.1';
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// source name → {license, include}. Matched by substring against gt.source.
const LICENSE_MAP = [
  { match: /First1KGreek/i, license: 'CC-BY-SA-4.0 (OpenGreekAndLatin First1KGreek)', include: true },
  { match: /Wikisource/i, license: 'CC BY-SA 4.0 (Wikisource)', include: true },
  { match: /Living Poets/i, license: 'CC-BY / Public Domain (Living Poets, Durham University)', include: true },
  { match: /drbo\.org|Clementine Vulgate \(drbo/i, license: 'Public Domain (Clementine Vulgate text)', include: true },
  { match: /Sefaria.*Sha'arei|Sha'arei_Orah/i, license: 'Public Domain (Sefaria he-version "Shaarei Orah, grimoar")', include: true },
  { match: /Sefaria.*(Masoretic|Miqra)/i, license: 'CC-BY (Sefaria, Miqra according to the Masorah)', include: true },
  { match: /Sefaria/i, license: 'UNKNOWN (Sefaria he-version license not stated)', include: false },
  { match: /TITUS/i, license: 'TITUS terms forbid republication — text NOT included', include: false },
  { match: /ctext/i, license: 'ctext.org terms restrict redistribution — text NOT included', include: false },
];
const licenseFor = source => LICENSE_MAP.find(l => l.match.test(source || '')) ||
  { license: 'UNKNOWN — text NOT included', include: false };

const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth);

const obsFile = args.obs || path.join(__dirname, 'observations',
  fs.readdirSync(path.join(__dirname, 'observations')).filter(f => f.endsWith('.jsonl')).sort().pop());
const obs = fs.readFileSync(obsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => r.slug); // reference-scored rows only in v0 (legacy MCR rows lack references)

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const B = db.collection('books'), P = db.collection('pages');

const pages = [], references = [];
for (const gt of gts) {
  const bk = await B.findOne({ $or: [{ id: gt.book_id }, { _id: gt.book_id }] },
    { projection: { title: 1, display_title: 1, author: 1, year: 1, language: 1, ia_identifier: 1, slug: 1 } });
  const pg = await P.findOne({ book_id: gt.book_id, page_number: gt.page_number },
    { projection: { id: 1, _id: 1, scan_quality: 1, display_photo: 1, archived_photo: 1, photo: 1, cropped_photo: 1, image_source: 1 } });
  const imageUrl = getPageSource(pg);

  // Resolution is a first-class covariate: measure the exact image the models saw.
  let image = { url: imageUrl, width: null, height: null, bytes: null, megapixels: null };
  try {
    const buf = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
    const meta = await sharp(buf).metadata();
    image = {
      url: imageUrl, width: meta.width, height: meta.height, bytes: buf.length,
      megapixels: +(meta.width * meta.height / 1e6).toFixed(2), format: meta.format,
    };
  } catch (e) {
    console.error(`  ! image fetch failed for ${gt.slug}: ${e.message}`);
  }

  pages.push({
    slug: gt.slug, book_id: gt.book_id, page_number: gt.page_number,
    book: {
      title: bk?.display_title || bk?.title, author: bk?.author || null, year: bk?.year || null,
      language: bk?.language, ia_identifier: bk?.ia_identifier || null,
      url: bk?.slug ? `https://sourcelibrary.org/book/${bk.slug}` : null,
    },
    reader_url: bk?.slug && (pg?.id || pg?._id) ? `https://sourcelibrary.org/book/${bk.slug}/page/${pg.id || pg._id}` : null,
    edition: gt.edition || null, script: gt.script, page_class: gt.page_class || null,
    scan_quality: pg?.scan_quality || null, image,
  });

  const lic = licenseFor(gt.source);
  references.push({
    slug: gt.slug, work: gt.work, language: gt.language, script: gt.script,
    source: gt.source, source_url: gt.source_url,
    non_canonical: gt.non_canonical || false,
    memorization_risk: gt.page_class?.memorization_risk || (gt.page_class?.canonical_text === false ? null : 'canonical'),
    license: lic.license, text_included: lic.include,
    reference_text: lic.include ? gt.ocr_ground_truth : null,
    reference_sha256: sha256(gt.ocr_ground_truth),
    reference_chars: [...gt.ocr_ground_truth].length,
    retrieval_note: lic.include ? null :
      `Fetch from source_url and locate the passage; verify integrity via reference_sha256 over the exact UTF-8 string. The repository's scripts/eval/reference-works/ files document the passage boundaries.`,
    audit_note: gt.audit_note || null,
  });
}
await client.close();

const runs = obs.map(r => ({
  slug: r.slug, source: r.source, run_id: r.run_id, model: r.model, run_index: r.run_index,
  finish_reason: r.finish_reason ?? null,
  aligned: r.aligned, guard_type: r.guard_type, guard_value: r.guard_value,
  cer: r.cer, char_accuracy: r.char_accuracy, ref_chars: r.ref_chars,
  output_norm_chars: r.output_norm_chars, scoring_version: r.scoring_version,
  // Raw model output: produced by us, included in full. (Pipeline OCR of PD scans.)
  raw_text: r.modal_output || undefined,
}));
// raw text for api/pipeline runs lives in scorecard-outputs + Mongo; join it in.
const rawByKey = new Map();
const resultsDir = path.join(__dirname, 'results');
for (const f of fs.readdirSync(resultsDir).filter(f => f.startsWith('scorecard-outputs-') && f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(resultsDir, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    rawByKey.set(`${f.replace('.jsonl', '')}|${o.work}|${o.model}|${o.run}`, o.text);
  }
}
const workBySlug = Object.fromEntries(gts.map(g => [g.slug, g.work]));
for (const r of runs) {
  if (r.source === 'api' && !r.raw_text) {
    r.raw_text = rawByKey.get(`${r.run_id}|${workBySlug[r.slug]}|${r.model}|${r.run_index}`) ?? null;
  }
}
// pipeline rows: fetch stored OCR text
const client2 = new MongoClient(process.env.MONGODB_URI);
await client2.connect();
const P2 = client2.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
const gtBySlug = Object.fromEntries(gts.map(g => [g.slug, g]));
for (const r of runs.filter(r => r.source === 'pipeline')) {
  const g = gtBySlug[r.slug];
  const pg = await P2.findOne({ book_id: g.book_id, page_number: g.page_number }, { projection: { 'ocr.data': 1 } });
  r.raw_text = pg?.ocr?.data ?? null;
}
await client2.close();

const outDir = path.join(__dirname, 'dataset', VERSION);
fs.mkdirSync(outDir, { recursive: true });
const write = (name, rows) => {
  const body = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, name), body);
  return `${sha256(body)}  ${name}`;
};
const sums = [
  write('pages.jsonl', pages),
  write('references.jsonl', references),
  write('runs.jsonl', runs),
];
fs.writeFileSync(path.join(outDir, 'checksums.txt'), sums.join('\n') + '\n');

console.log(`\nExported ${VERSION}: ${pages.length} pages, ${references.length} references (${references.filter(r => r.text_included).length} with text), ${runs.length} runs → ${outDir}`);
console.log(`Resolution coverage: ${pages.filter(p => p.image.width).length}/${pages.length} pages measured`);
for (const p of pages) console.log(`  ${p.slug.padEnd(42)} ${p.image.width}×${p.image.height} (${p.image.megapixels} MP)`);
