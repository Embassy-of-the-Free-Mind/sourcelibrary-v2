#!/usr/bin/env node
/**
 * Check whether OCR has drifted from the page image.
 *
 * Strategy: for a sample of pages, fetch the cropped_photo, ask Gemini-3-flash
 * (vision) "what printed page number do you see on this page?" and compare to
 * the OCR-extracted <page-num>. If they disagree, OCR has drifted.
 *
 * If drift is real, the whole #1719 scan-order audit is invalid — the
 * misordering we see is OCR-image association, not curator scan order.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/check-ocr-drift.mjs --book <id> [--limit 20]
 *   node scripts/check-ocr-drift.mjs --book <id> --pages 13,21,27   # specific
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const args = process.argv.slice(2);
const BOOK = args[args.indexOf('--book') + 1];
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1], 10) : 20;
})();
const SPECIFIC = (() => {
  const i = args.indexOf('--pages');
  return i !== -1 ? args[i + 1].split(',').map(n => parseInt(n.trim(), 10)) : null;
})();

if (!BOOK || !/^[0-9a-f]{24}$/.test(BOOK)) {
  console.error('Usage: --book <24-hex> [--limit N] [--pages 13,21,27]');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI || !GEMINI_KEY) { console.error('env not set'); process.exit(1); }

function parseOcrPrinted(ocr) {
  if (!ocr) return null;
  const m = ocr.match(/<page-num>([^<]+)<\/page-num>/);
  if (!m) return null;
  return m[1].trim();
}

async function visionReadPageNum(imageUrl, ai) {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = buf.toString('base64');
  const model = ai.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const result = await model.generateContent([
    { inlineData: { mimeType: 'image/jpeg', data: b64 } },
    {
      text: `What is the printed page number visible on this page of a historical book?
Look for a number that the printer typeset at the top or bottom of the page (header or footer).
Ignore any handwritten annotations, library stamps, signatures, or modern catalog numbers.
Reply with ONLY the number (e.g. "42") or the word "none" if no printed page number is visible.
Do not reply with anything else.`
    },
  ]);
  return result.response.text().trim();
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const ai = new GoogleGenerativeAI(GEMINI_KEY);

  let pages;
  if (SPECIFIC) {
    pages = await db.collection('pages').find(
      { book_id: BOOK, page_number: { $in: SPECIFIC } }
    ).sort({ page_number: 1 }).toArray();
  } else {
    pages = await db.collection('pages').aggregate([
      { $match: { book_id: BOOK, page_number: { $gt: 0 }, 'cropped_photo': { $exists: true, $ne: null } } },
      { $sample: { size: LIMIT } },
      { $sort: { page_number: 1 } },
    ]).toArray();
  }
  console.log(`Checking ${pages.length} pages for OCR drift…\n`);

  let agree = 0, disagree = 0, ocrNone = 0, visionNone = 0;
  const conflicts = [];
  for (const p of pages) {
    const ocrPg = parseOcrPrinted(p.ocr?.data);
    let visionPg = null;
    try {
      visionPg = await visionReadPageNum(p.cropped_photo, ai);
    } catch (e) {
      console.log(`  pg ${p.page_number}: vision FAIL ${e.message}`);
      continue;
    }
    // Compare numerically; "none" vs null vs missing
    const ocrNum = ocrPg ? (ocrPg.match(/^(\d+)/)?.[1] ?? null) : null;
    const visionNum = /^\d+$/.test(visionPg) ? visionPg : null;
    let verdict;
    if (!ocrNum && !visionNum) { verdict = 'both-none'; agree++; }
    else if (ocrNum && !visionNum) { verdict = 'OCR-only'; ocrNone++; }
    else if (!ocrNum && visionNum) { verdict = 'VISION-only'; visionNone++; }
    else if (ocrNum === visionNum) { verdict = 'AGREE'; agree++; }
    else { verdict = 'DISAGREE'; disagree++; conflicts.push({ digital: p.page_number, ocr: ocrPg, vision: visionPg, cropped: p.cropped_photo }); }
    console.log(`  pg ${String(p.page_number).padStart(3)}: ocr="${ocrPg ?? '-'}" vision="${visionPg}" → ${verdict}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Agree (both number, same): ${agree}`);
  console.log(`Disagree:                  ${disagree}`);
  console.log(`OCR has, vision doesn't:   ${ocrNone}`);
  console.log(`Vision has, OCR doesn't:   ${visionNone}`);
  if (conflicts.length > 0) {
    console.log(`\nConflicts:`);
    for (const c of conflicts) {
      console.log(`  pg ${c.digital}: OCR says "${c.ocr}", vision says "${c.vision}"`);
      console.log(`    ${c.cropped}`);
    }
  }
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
