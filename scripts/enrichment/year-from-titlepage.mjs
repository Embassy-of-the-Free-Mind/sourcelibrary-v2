#!/usr/bin/env node
/**
 * Recover publication `year` from the OCR'd TITLE PAGE (and frontispiece /
 * colophon) for books that have no usable `published` metadata string.
 *
 * Complements `backfill-year-from-published.mjs`, which only parses the
 * catalog `published` string. Many books arrive with `published: null` /
 * "Unknown" yet the printed imprint date is plainly visible in the scan
 * ("BANDOENG „FORTUNA." 1912."). This reads that.
 *
 * PROVENANCE: every write records where the year came from, so a machine
 * guess is never mistaken for a catalogued fact:
 *   year_source: 'ocr-titlepage'
 *   year_provenance: { evidence, page_number, confidence, model, extracted_at }
 *
 * The title-page imprint is frequently MORE authoritative than the catalog
 * `published` (which often carries a reprint / digitization year), but we do
 * NOT overwrite an existing year — this only fills books that are dateless.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/enrichment/year-from-titlepage.mjs --dry-run            # default
 *   node scripts/enrichment/year-from-titlepage.mjs --apply
 *   node scripts/enrichment/year-from-titlepage.mjs --apply --live-only  # visible books first
 *   node scripts/enrichment/year-from-titlepage.mjs --apply --min-confidence=medium
 *   node scripts/enrichment/year-from-titlepage.mjs --limit=50           # cap candidates (testing)
 */
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const BATCH_SIZE = 25;          // books per Gemini call
const CONCURRENCY = 3;
const EARLY_PAGE_LIMIT = 14;    // how deep to look for a title/imprint page
const MAX_OCR_CHARS = 1800;     // per book sent to Gemini

const SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dryRun = !argv.includes('--apply');
const liveOnly = argv.includes('--live-only');
const limitArg = argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 0;
const confArg = argv.find(a => a.startsWith('--min-confidence='));
const MIN_CONFIDENCE = confArg ? confArg.split('=')[1] : 'medium'; // low|medium|high
const CONF_RANK = { low: 0, medium: 1, high: 2 };

// ── env ─────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
const apiKeys = [];
if (process.env.GEMINI_API_KEY) apiKeys.push(process.env.GEMINI_API_KEY);
for (let i = 1; i <= 9; i++) if (process.env[`GEMINI_API_KEY_${i}`]) apiKeys.push(process.env[`GEMINI_API_KEY_${i}`]);
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY* set'); process.exit(1); }
let keyIndex = 0;
function getModel() {
  const key = apiKeys[keyIndex++ % apiKeys.length];
  return new GoogleGenerativeAI(key).getGenerativeModel({ model: GEMINI_MODEL, safetySettings: SAFETY });
}

// ── OCR cleaning ────────────────────────────────────────────────────
// Drop the CONTENT of editorial / description wrappers so we never read a
// date the annotator mentioned from an ADJACENT page (the documented
// "mercury on page 89" trap). Keep printed body text + real page marks.
const WRAPPER_CONTENT = /<(meta|summary|keywords|vocab|image-desc|scan-quality|language|script|page-type|columns|warning)\b[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING = /<(meta|summary|keywords|vocab|image-desc|scan-quality|language|script|page-type|columns|warning|page-num)\b[^>]*\/?>/gi;
function cleanOcr(raw) {
  if (!raw) return '';
  let s = typeof raw === 'string' ? raw : (raw.data || raw.text || '');
  s = s.replace(WRAPPER_CONTENT, ' ').replace(SELF_CLOSING, ' ');
  s = s.replace(/<[^>]+>/g, ' ');           // strip any remaining tags
  s = s.replace(/->|<-/g, ' ');             // SL centering marks
  return s.replace(/\s+/g, ' ').trim();
}

function ocrText(page) {
  const o = page.ocr;
  if (!o) return '';
  return typeof o === 'string' ? o : (o.data || o.text || '');
}

// pick the most date-bearing pages: title-page / frontispiece first, then the
// earliest few pages, then the last page (colophon often carries the imprint).
function pickPages(pages) {
  const byNum = [...pages].sort((a, b) => (a.page_number || 0) - (b.page_number || 0));
  const titleish = byNum.filter(p => ['title-page', 'frontispiece', 'colophon'].includes(p.page_type));
  const picked = [];
  const seen = new Set();
  const add = p => { if (p && !seen.has(p.page_number)) { seen.add(p.page_number); picked.push(p); } };
  titleish.forEach(add);
  byNum.slice(0, 6).forEach(add);   // earliest pages as fallback
  if (byNum.length) add(byNum[byNum.length - 1]); // colophon candidate
  return picked.slice(0, 6);
}

// ── Gemini extraction ───────────────────────────────────────────────
async function extractBatch(items) {
  const model = getModel();
  const prompt = `You are a rare-books cataloguer. For each book you are given the OCR text of its title page / opening leaves / colophon. Determine the PUBLICATION or PRINTING year (the imprint date).

Rules:
- Use ONLY a date that is actually printed in the text. Convert Roman numerals (M.DC.XVII = 1617) and chronograms if unambiguous.
- Prefer the imprint/printing date over a dedication, privilege, or "approbation" date if several appear; if unsure which, pick the latest plausible printing year.
- "evidence" MUST be the exact substring as printed (e.g. "1912", "M.DC.XVII", "Anno 1650").
- confidence: "high" = a clear printed year on a title/imprint page; "medium" = a year present but ambiguous which it is; "low" = inferred/uncertain.
- If no printed year is present, return year null, confidence "low", evidence "".
- Return STRICT JSON, no markdown fences: { "results": [ { "id": "...", "year": 1617, "confidence": "high", "evidence": "M.DC.XVII", "note": "" } ] }

Books:
${JSON.stringify(items, null, 2)}`;

  const res = await model.generateContent(prompt);
  const text = res.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(text);
  const map = {};
  for (const r of parsed.results || []) {
    if (r && r.year && typeof r.year === 'number' && r.year >= 800 && r.year <= 2100) {
      map[r.id] = { year: r.year, confidence: (r.confidence || 'low').toLowerCase(), evidence: r.evidence || '', note: r.note || '' };
    }
  }
  return map;
}

async function mapLimit(arr, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < arr.length) { const idx = i++; try { out[idx] = await fn(arr[idx], idx); } catch (e) { out[idx] = { __err: e.message }; } }
  });
  await Promise.all(workers);
  return out;
}

// ── main ────────────────────────────────────────────────────────────
async function run() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write\n' : 'APPLY — writing year + provenance\n');
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const noYear = { $or: [{ year: { $in: [null, 0] } }, { year: { $exists: false } }] };
  const q = { $and: [noYear, { pages_ocr: { $gt: 0 } }] };
  if (liveOnly) q.$and.push({ visible: true });

  let cursor = books.find(q).project({ id: 1, title: 1, display_title: 1, author: 1, visible: 1 }).sort({ visible: -1, pages_ocr: -1 });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const candidates = await cursor.toArray();
  console.log(`Candidates (dateless + OCR${liveOnly ? ' + visible' : ''}): ${candidates.length}\n`);
  if (!candidates.length) { await client.close(); return; }

  // Build per-book payloads from title-page OCR
  const payloads = [];
  for (const bk of candidates) {
    const pg = await pages.find({ book_id: bk.id, page_number: { $lte: EARLY_PAGE_LIMIT } })
      .project({ page_number: 1, page_type: 1, ocr: 1 }).toArray();
    // also grab last page for colophon
    const last = await pages.find({ book_id: bk.id }).sort({ page_number: -1 }).limit(1)
      .project({ page_number: 1, page_type: 1, ocr: 1 }).toArray();
    const all = [...pg, ...last];
    const chosen = pickPages(all);
    const text = chosen.map(p => `[p${p.page_number}${p.page_type ? '/' + p.page_type : ''}] ${cleanOcr(ocrText(p))}`)
      .join('\n').slice(0, MAX_OCR_CHARS);
    if (!text.replace(/\[p\d+[^\]]*\]/g, '').trim()) continue; // no usable OCR
    payloads.push({ _bookId: bk.id, _title: bk.display_title || bk.title, id: bk.id, title: (bk.display_title || bk.title || '').slice(0, 120), author: (bk.author || '').slice(0, 80), ocr: text });
  }
  console.log(`Built ${payloads.length} payloads with usable title-page OCR\n`);

  // Batch through Gemini
  const batches = [];
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) batches.push(payloads.slice(i, i + BATCH_SIZE));
  let done = 0;
  const results = await mapLimit(batches, CONCURRENCY, async (batch) => {
    const items = batch.map(({ id, title, author, ocr }) => ({ id, title, author, ocr }));
    let map = {};
    try { map = await extractBatch(items); } catch (e) { console.error(`  batch error: ${e.message}`); }
    done += batch.length;
    process.stdout.write(`\r  ${done}/${payloads.length} processed   `);
    return batch.map(p => ({ ...p, result: map[p.id] || null }));
  });
  console.log('\n');

  const flat = results.flat().filter(r => r && !r.__err);
  const resolved = flat.filter(r => r.result && r.result.year);
  const writable = resolved.filter(r => CONF_RANK[r.result.confidence] >= CONF_RANK[MIN_CONFIDENCE]);

  const byConf = { high: 0, medium: 0, low: 0 };
  resolved.forEach(r => { byConf[r.result.confidence] = (byConf[r.result.confidence] || 0) + 1; });
  console.log(`Extracted a year for ${resolved.length}/${payloads.length} (high ${byConf.high||0} / medium ${byConf.medium||0} / low ${byConf.low||0})`);
  console.log(`Writable at --min-confidence=${MIN_CONFIDENCE}: ${writable.length}\n`);

  console.log('Sample extractions:');
  for (const r of resolved.slice(0, 15)) {
    console.log(`  ${r.result.year}  [${r.result.confidence}]  ev="${r.result.evidence}"  — ${(r._title||'').slice(0, 60)}`);
  }
  console.log('');

  if (dryRun) {
    console.log(`DRY RUN — would write ${writable.length} books (year + year_source:'ocr-titlepage' + provenance). Pass --apply.`);
    await client.close();
    return;
  }

  const now = new Date();
  let written = 0;
  for (const r of writable) {
    const { year, confidence, evidence, note } = r.result;
    const ev = evidence;
    await books.updateOne({ id: r._bookId, ...noYear }, {
      $set: {
        year,
        year_source: 'ocr-titlepage',
        year_provenance: { evidence: ev, confidence, note: note || '', model: GEMINI_MODEL, extracted_at: now },
      },
    });
    written++;
    if (written % 100 === 0) process.stdout.write(`\r  wrote ${written}/${writable.length}   `);
  }
  console.log(`\nWrote year for ${written} books (source=ocr-titlepage, min-confidence=${MIN_CONFIDENCE}).`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
