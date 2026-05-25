#!/usr/bin/env node
/**
 * Backfill author for books where `author === "[s.n.]"` (MARC "no name" sigil
 * mistakenly stored as a real string by the e-rara importer).
 *
 * Usage:
 *   node scripts/maintenance/backfill-sn-authors.mjs               # dry-run
 *   node scripts/maintenance/backfill-sn-authors.mjs --apply       # write to DB
 *   node scripts/maintenance/backfill-sn-authors.mjs --limit 10    # cap LLM calls
 *
 * Expects env loaded via:
 *   set -a; source .env.production.local; set +a
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient, ObjectId } from 'mongodb';

const MODEL = 'gemini-3.1-flash-lite-preview';
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY / GOOGLE_API_KEY not set'); process.exit(1); }

const SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: MODEL, safetySettings: SAFETY });

function titleStem(t) {
  return String(t || '')
    .replace(/&amp;/g, '&')
    .replace(/\s*(tom(?:e|us)?|vol(?:ume)?|part(?:e)?|theil|band|deel)[.\s]*[ivxlcdm0-9]+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function extractAuthor({ title, year, language, ocrText }) {
  const prompt = `You are a bibliographic expert. Given the first pages of a historical book, identify the author named on the title page.

Book metadata:
- Title: ${title}
- Year: ${year || 'unknown'}
- Language: ${language || 'unknown'}

Title-page OCR (first ~3 pages, may include blanks / colophons):
"""
${ocrText.slice(0, 6000)}
"""

Return STRICT JSON with this shape (no markdown, no commentary):
{
  "author": "Lastname, Firstname (YYYY-YYYY)" or null,
  "anonymous": true | false,
  "confidence": "high" | "medium" | "low",
  "evidence": "<short quote from OCR that names the author, or 'no author named'>"
}

Rules:
- If the title page clearly names an author, return that name in "Lastname, Firstname" format with life dates if you know them.
- If it's a translation/edition by a known person, the original author goes in "author"; mention the translator/editor in "evidence".
- If the title page genuinely names no author (treaties, official documents, anonymous polemics, "sine nomine" works), set anonymous: true and author: null.
- Do NOT guess from title alone. If the OCR is too damaged or doesn't show the title page, return confidence: "low".`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });
  const text = result.response.text();
  return JSON.parse(text);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const affected = await db.collection('books').find({
    author: { $in: ['[s.n.]', '[S.N.]', 's.n.', '[s.n]'] },
  }).project({
    _id: 1, id: 1, title: 1, published: 1, language: 1, pages_count: 1, categories: 1,
  }).toArray();

  console.log(`Found ${affected.length} books with [s.n.] author.`);

  // Dedupe by title stem — multi-volume sets get one LLM call
  const groups = new Map();
  for (const b of affected) {
    const stem = titleStem(b.title);
    if (!groups.has(stem)) groups.set(stem, []);
    groups.get(stem).push(b);
  }
  console.log(`Grouped into ${groups.size} title-stems (multi-volume dedupe).`);

  let llmCalls = 0;
  let plannedWrites = 0;
  let skipped = 0;
  const results = [];

  for (const [stem, books] of groups) {
    if (llmCalls >= LIMIT) break;
    const representative = books[0];

    const pages = await db.collection('pages').find({
      book_id: String(representative._id),
    }).sort({ page_number: 1 }).limit(8).project({ page_number: 1, 'ocr.data': 1 }).toArray();

    const ocrText = pages.map(p => p?.ocr?.data || '').filter(Boolean).join('\n\n').trim();

    if (!ocrText) {
      skipped += books.length;
      results.push({ stem, books: books.map(b => b._id), status: 'no_ocr' });
      continue;
    }

    let extracted;
    try {
      extracted = await extractAuthor({
        title: representative.title,
        year: representative.published,
        language: representative.language,
        ocrText,
      });
      llmCalls++;
    } catch (e) {
      results.push({ stem, books: books.map(b => b._id), status: 'llm_error', error: String(e).slice(0, 200) });
      continue;
    }

    const proposed = extracted.anonymous ? null : (extracted.author || null);
    const status = extracted.anonymous ? 'anonymous_flag' : (proposed ? 'extracted' : 'unparseable');

    for (const b of books) {
      results.push({
        bookId: String(b._id),
        title: b.title,
        currentAuthor: '[s.n.]',
        proposedAuthor: proposed,
        anonymous: extracted.anonymous,
        confidence: extracted.confidence,
        evidence: extracted.evidence?.slice(0, 160),
        status,
        groupSize: books.length,
      });
      if (proposed || extracted.anonymous) plannedWrites++;
    }

    // Gentle throttle — Gemini Flash Lite handles bursts but be polite
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Report ──
  console.log('\n=== DRY-RUN REPORT ===');
  console.log(`LLM calls: ${llmCalls} | Planned writes: ${plannedWrites} | Skipped (no OCR): ${skipped}`);
  console.log('\nBy status:');
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);

  console.log('\nFirst 20 proposed changes:');
  for (const r of results.filter(r => r.bookId).slice(0, 20)) {
    const tag = r.anonymous ? '[ANON]' : `[${r.confidence?.toUpperCase()}]`;
    console.log(`  ${tag} ${r.bookId.slice(-8)} ${JSON.stringify(r.title).slice(0, 60)}`);
    console.log(`    → ${r.anonymous ? 'null + anonymous=true' : r.proposedAuthor}`);
    if (r.evidence) console.log(`    evidence: ${r.evidence}`);
  }

  // Write full results to a file so Derek can review the whole set
  const outPath = '/tmp/sn-backfill-dryrun.json';
  await import('node:fs').then(fs => fs.promises.writeFile(outPath, JSON.stringify(results, null, 2)));
  console.log(`\nFull results: ${outPath}`);

  if (APPLY) {
    console.log('\n=== APPLYING WRITES ===');
    let written = 0;
    const now = new Date();
    for (const r of results) {
      if (!r.bookId) continue;
      if (!r.proposedAuthor && !r.anonymous) continue;
      const update = r.anonymous
        ? { $set: { author: null, _author_backfill: { at: now, source: MODEL, anonymous: true, evidence: r.evidence, confidence: r.confidence } } }
        : { $set: { author: r.proposedAuthor, _author_backfill: { at: now, source: MODEL, anonymous: false, evidence: r.evidence, confidence: r.confidence } } };
      const oid = ObjectId.isValid(r.bookId) ? new ObjectId(r.bookId) : r.bookId;
      const res = await db.collection('books').updateOne({ _id: oid }, update);
      if (res.modifiedCount === 0) console.warn(`  WARN: no match for ${r.bookId}`);
      written++;
    }
    console.log(`Wrote ${written} books.`);
  } else {
    console.log('\nDRY RUN — no writes. Re-run with --apply to commit.');
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
