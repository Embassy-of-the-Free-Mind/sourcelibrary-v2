#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/select-batch.mjs writes one prompt per book from the API record, which for
// a translated book carries our own first-translation fields (priming) and holds no title-page text for an
// untranslated, un-OCR'd book. #7651 needs identity from OUR scan and an unprimed searcher, so this writes
// prompts from Mongo: catalogue fields (no FT/card/attempt fields) + first-page OCR text, or page images.
//
// Writes <dir>/<id>.prompt for every id in the manifest's run_order (sample + blind controls), plus
// <dir>/ids.txt in run order. Images go to <dir>/img/<id>/pN.jpg, resized with ffmpeg.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ft-untranslated-7651-prompts.mjs \
//     --manifest scripts/eval/results/ft-untranslated-sample-7651-manifest.json --out $JOB_SCRATCH/run
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPageSource } from '../lib/page-image-url.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MANIFEST = arg('--manifest', 'scripts/eval/results/ft-untranslated-sample-7651-manifest.json');
const OUT = arg('--out');
const ONLY = arg('--ids'); // optional comma list
if (!OUT) { console.error('Missing --out <dir>'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const briefMd = readFileSync(join(here, 'results/ft-untranslated-7651-brief.md'), 'utf8');
const BRIEF = briefMd.split('\n---\n').slice(1).join('\n---\n').trim();

const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const ids = ONLY ? ONLY.split(',') : m.run_order;
mkdirSync(OUT, { recursive: true });

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const MAX_PAGES = 6;

const isBlank = (t) => /<page-type>\s*blank/i.test(t) || t.replace(/<[^>]+>[^<]*<\/[^>]+>/g, '').trim().length < 20;
const clean = (t) => t.replace(/<(language|script|page-type)>[^<]*<\/\1>\n?/g, '').trim();

function fetchImage(url, path) {
  let u = url;
  if (/\/full\/full\/0\/default\.jpg$/.test(u)) u = u.replace('/full/full/', '/full/1400,/');
  const raw = `${path}.raw`;
  try {
    execFileSync('curl', ['-s', '-L', '-m', '60', '-A', 'Mozilla/5.0 (SourceLibrary research)', '-o', raw, u]);
    if (!existsSync(raw) || statSync(raw).size < 2000) return false;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', "scale='min(1400,iw)':-2", '-q:v', '4', path]);
    execFileSync('rm', ['-f', raw]);
    return existsSync(path) && statSync(path).size > 2000;
  } catch { execFileSync('rm', ['-f', raw]); return false; }
}

const stats = { text: 0, image: 0, catalogue_only: 0 };
for (const id of ids) {
  const b = await db.collection('books').findOne({ $or: [{ id }, { _id: id }] }, {
    projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1, dublin_core: 1 },
  });
  if (!b) { console.error(`missing book ${id}`); continue; }
  const pages = await db.collection('pages').find({ book_id: id, page_number: { $lte: 14 } }, {
    projection: { page_number: 1, 'ocr.data': 1, photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 },
  }).sort({ page_number: 1 }).toArray();
  const texts = pages.filter((p) => p.ocr?.data && !isBlank(p.ocr.data)).slice(0, MAX_PAGES);
  let scan;
  if (texts.length) {
    scan = 'Text read (OCR) from the first pages of OUR scan:\n' +
      texts.map((p) => `--- page ${p.page_number} ---\n${clean(p.ocr.data).slice(0, 1500)}`).join('\n') + '\n';
    stats.text++;
  } else {
    const dir = join(OUT, 'img', id);
    mkdirSync(dir, { recursive: true });
    const got = [];
    for (const p of pages.slice(0, MAX_PAGES)) {
      const url = getPageSource(p);
      if (!url) continue;
      const path = join(dir, `p${p.page_number}.jpg`);
      if ((existsSync(path) && statSync(path).size > 2000) || fetchImage(url, path)) got.push(path);
    }
    if (got.length) {
      scan = `Our scan has no text yet. Images of its first pages (open each with the Read tool; the title page is usually among them):\n${got.join('\n')}\n`;
      stats.image++;
    } else {
      scan = 'No text or page image of our copy could be retrieved: identify from the catalogue record alone and say so (identity.source = catalogue_only).\n';
      stats.catalogue_only++;
    }
  }
  const rec = [
    `id: ${id}`,
    `catalogue title: ${b.title || ''}`,
    b.display_title && b.display_title !== b.title ? `display title (ours, may be an English rendering): ${b.display_title}` : null,
    `author: ${b.author || 'unknown'}`,
    `edition language (catalogue): ${b.language || 'unknown'}`,
    `published: ${b.published || b.year || 'unknown'}`,
    `pages in our copy: ${b.pages_count || 0}`,
  ].filter(Boolean).join('\n');
  writeFileSync(join(OUT, `${id}.prompt`), `${BRIEF.replace('"id":"<id>"', `"id":"${id}"`)}\n\n## The book\n${rec}\n\n${scan}`);
}
writeFileSync(join(OUT, 'ids.txt'), ids.join('\n') + '\n');
console.log(`wrote ${ids.length} prompts to ${OUT}: ${JSON.stringify(stats)}`);
await c.close();
