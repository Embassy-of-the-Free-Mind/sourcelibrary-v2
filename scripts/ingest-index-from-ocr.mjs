#!/usr/bin/env node
/**
 * Build the banned-books catalog from the OCR of our own scanned printed Indexes.
 *
 * For each scanned Index Librorum Prohibitorum (or Spanish Index, etc.) book in
 * Source Library, walk its OCR'd pages and ask Gemini to extract structured
 * entries — author, work, condemnation note — preserving the exact page-level
 * provenance so each catalog row cites back to its source page.
 *
 * Why not the Bujanda CSV? It's a third-party derivative; coverage is truncated
 * and titles have OCR-import artifacts. We have the primary documents already
 * scanned + OCR'd + translated. This script eats our own dogfood.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   # Validate on smallest edition first (1564 Tridentine, 76 pages, ~$0.08):
 *   node scripts/ingest-index-from-ocr.mjs --book-id 69b21d7db7c52df2b4f2a0c3 --index-id roman-1564-tridentine
 *   # With --apply to write to Supabase (default: dry-run, prints sample output):
 *   node scripts/ingest-index-from-ocr.mjs --book-id 69b21d7db7c52df2b4f2a0c3 --index-id roman-1564-tridentine --apply
 *
 * Flags:
 *   --book-id BOOK            Mongo _id or slug of the scanned Index edition (required)
 *   --index-id ID             Catalog id (e.g. roman-1564-tridentine, spanish-1632-zapata) (required)
 *   --apply                   Write to Supabase (default: dry-run; prints first N extracted entries)
 *   --concurrency K           Parallel page-extraction requests (default: 4)
 *   --max-pages N             Cap on pages processed (default: all)
 *   --start-page P            Start at this 1-indexed page (default: 1)
 *   --model M                 Gemini model (default: gemini-3.1-flash-lite-preview)
 *   --collection-slug SLUG    What index_catalogs.collection_slug to point at (default: index-librorum-prohibitorum)
 */

import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const BOOK_ID = arg('--book-id');
const INDEX_ID = arg('--index-id');
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', 4)));
const MAX_PAGES = Number(arg('--max-pages', 0)) || Infinity;
const START_PAGE = Number(arg('--start-page', 1));
const MODEL = arg('--model', 'gemini-3.1-flash-lite-preview');
const COLLECTION_SLUG = arg('--collection-slug', 'index-librorum-prohibitorum');

if (!BOOK_ID || !INDEX_ID) {
  console.error('--book-id and --index-id are required');
  process.exit(1);
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (APPLY && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required for --apply'); process.exit(1); }

const supaHeaders = SUPA_KEY ? { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' } : null;
async function supa(method, path, body) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const opts = { method, headers: { ...supaHeaders, Prefer: 'return=representation' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.status === 204 ? null : r.json();
}

// ─── Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a bibliographic-extraction assistant specialised in early-modern printed indices of prohibited books (Index Librorum Prohibitorum and its national equivalents). Given OCR'd pages from such an Index, extract every individual banned-book entry as structured JSON.

The Index entries are alphabetical and may take several forms:
  - "Bruno Nolanus (Iordanus). Opera omnia." → author with all works prohibited (Class I auctor damnatus)
  - "Spaccio della bestia trionfante." (under a named author) → specific work
  - "Alchimia Purgatorij." (anonymous) → anonymous work, just title
  - "Erasmus Roterodamus, donec corrigatur." → expurgatorial / conditional
  - Some entries cite the decree date or banning authority (e.g. "Decreto Clem. VIII")

Output one JSON entry per banned work. If a section is "Author. Work1. Work2. Work3", emit one entry per work; if it's "Author. Opera omnia.", emit one entry with scope=opera_omnia and work=null.

Ignore: page headers, signatures (e.g. "B 3"), catchwords, footnotes that are NOT entries, table-of-contents pages, prefatory matter ("Praefatio", "Index expurgatorius incipit", etc.), and decree texts. Only the actual condemned-book entries.

Output exactly this JSON shape:
{
  "entries": [
    {
      "author": "string — \\"Surname, Forename\\" form, or null if anonymous",
      "work": "string — work title, or null if author's complete works are condemned (scope=opera_omnia)",
      "scope": "opera_omnia | single_work | donec_corrigatur | expurgated | other",
      "decree_date": "string — explicit date if cited in the entry (YYYY or 'Decreto Clem. VIII'), else null",
      "reason": "string — short reason if explicitly stated (e.g. 'heretical', 'donec corrigatur'), else null",
      "raw_text": "string — verbatim OCR snippet from the page that this entry was extracted from"
    }
  ]
}
If the page contains no entries (front matter, decree, blank, etc.), output {"entries": []}.`;

// ─── Gemini call ───────────────────────────────────────────────────────────

async function extractFromPage(pageOcr, translation) {
  // Translation included as context: even if OCR is messy, the translation is clean.
  const userContent = `OCR (original):\n${pageOcr}\n\n${translation ? `Translation (English):\n${translation}\n` : ''}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 16384,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429 || res.status === 503) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No text in Gemini response');
      const usage = data.usageMetadata || {};
      const inTok = usage.promptTokenCount || 0;
      const outTok = usage.candidatesTokenCount || 0;
      // Approx Gemini 3.1 flash-lite pricing: $0.10 per 1M input, $0.40 per 1M output
      const cost = (inTok / 1_000_000) * 0.10 + (outTok / 1_000_000) * 0.40;
      return { ...JSON.parse(text), _meta: { inTok, outTok, cost } };
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('extractFromPage: exhausted retries');
}

// ─── Surname normaliser (shared with banned-books-via-ustc.mjs) ───────────

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function surname(a) {
  if (!a) return '';
  const c = a.replace(/\[[^\]]*\]/g, '').trim();
  if (c.includes(',')) return norm(c.split(',')[0]);
  const p = norm(c).split(/\s+/);
  return p[p.length - 1] || '';
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`OCR-based catalog ingest`);
  console.log(`  book_id        : ${BOOK_ID}`);
  console.log(`  index_id       : ${INDEX_ID}`);
  console.log(`  collection_slug: ${COLLECTION_SLUG}`);
  console.log(`  model          : ${MODEL}`);
  console.log(`  mode           : ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Resolve book. The catalog has ~1,186 legacy books where id !== _id (CLAUDE.md),
  // so even a valid ObjectId hex may NOT be the actual _id — fall back to id/slug.
  const projection = { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1, pages_ocr: 1 };
  let book = ObjectId.isValid(BOOK_ID)
    ? await db.collection('books').findOne({ _id: new ObjectId(BOOK_ID) }, { projection })
    : null;
  if (!book) {
    book = await db.collection('books').findOne({ $or: [{ id: BOOK_ID }, { slug: BOOK_ID }] }, { projection });
  }
  if (!book) { console.error(`Book not found: ${BOOK_ID}`); process.exit(1); }
  console.log(`Book: "${book.title}" by ${book.author} (${book.year})`);
  console.log(`Pages: total=${book.pages_count}, ocr=${book.pages_ocr}`);

  // Fetch OCR'd pages. For ~1,186 legacy books id !== _id; pages reference book.id
  // (the app-level identifier), not book._id. Try both to be safe.
  const bookIdCandidates = [book.id, String(book._id)].filter(Boolean);
  const pages = await db.collection('pages').find(
    { book_id: { $in: bookIdCandidates }, 'ocr.data': { $exists: true, $ne: null } },
    { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
  ).sort({ page_number: 1 }).toArray();
  console.log(`OCR'd pages available: ${pages.length}\n`);

  // Filter by range
  const slice = pages.filter(p => p.page_number >= START_PAGE).slice(0, MAX_PAGES);
  console.log(`Processing ${slice.length} pages (start=${START_PAGE}${MAX_PAGES !== Infinity ? `, max=${MAX_PAGES}` : ''}) at concurrency ${CONCURRENCY}\n`);

  const allEntries = [];
  let totalCost = 0;
  let processed = 0;
  let errors = 0;
  const startedAt = Date.now();

  // Worker pool
  const queue = [...slice];
  async function worker() {
    while (queue.length) {
      const page = queue.shift();
      try {
        const result = await extractFromPage(page.ocr.data, page.translation?.data);
        const entries = result.entries || [];
        for (const e of entries) {
          allEntries.push({ ...e, source_page: page.page_number });
        }
        totalCost += result._meta?.cost || 0;
      } catch (e) {
        errors++;
        console.error(`  page ${page.page_number}: ${String(e).slice(0, 120)}`);
      }
      processed++;
      if (processed % 5 === 0 || processed === slice.length) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = processed / elapsed;
        const eta = (slice.length - processed) / rate;
        process.stdout.write(`\r  ${processed}/${slice.length} pages | ${allEntries.length} entries | $${totalCost.toFixed(4)} | ${rate.toFixed(1)}p/s | ETA ${(eta/60).toFixed(1)}min      `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n\nDone in ${((Date.now() - startedAt)/60000).toFixed(1)} min.`);
  console.log(`  Pages processed: ${processed}`);
  console.log(`  Entries extracted: ${allEntries.length}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Cost: $${totalCost.toFixed(4)}`);

  // Sample
  console.log(`\nSample (first 8 entries):`);
  for (const e of allEntries.slice(0, 8)) {
    console.log(`  [p${e.source_page}] author="${e.author || '?'}" work="${(e.work || '').slice(0,50)}" scope=${e.scope} decree=${e.decree_date || '—'}`);
    console.log(`           raw: "${(e.raw_text || '').slice(0,90)}"`);
  }

  if (!APPLY) {
    console.log(`\n(dry run — pass --apply to write ${allEntries.length} entries to Supabase)`);
    await client.close();
    return;
  }

  // Upsert the index_catalogs row
  console.log(`\nUpserting index_catalogs row: ${INDEX_ID}`);
  const indexRow = {
    id: INDEX_ID,
    name: book.title,
    short_name: book.title.replace(/^Index Librorum Prohibitorum\s*/i, '').replace(/^\s*[(,]\s*|\s*[),]\s*$/g, '') || INDEX_ID,
    authority: book.author?.split(';')[0]?.trim() || 'Holy See',
    start_year: book.year,
    end_year: book.year,
    collection_slug: COLLECTION_SLUG,
    description: `Extracted directly from the OCR of our copy: ${book.title}. Page-level citations point to the scanned book.`,
    source: `Source Library book ${book.id} (${book.slug})`,
    source_url: `https://sourcelibrary.org/book/${book.slug}`,
  };
  // Upsert (PATCH if exists, POST if not)
  try { await supa('POST', 'index_catalogs', indexRow); }
  catch (e) { if (/duplicate/i.test(String(e))) await supa('PATCH', `index_catalogs?id=eq.${INDEX_ID}`, indexRow); else throw e; }

  // Replace any existing entries for this index_id (re-runnable ingest)
  console.log(`Deleting existing entries for index_id=${INDEX_ID}…`);
  await supa('DELETE', `index_catalog_entries?index_id=eq.${INDEX_ID}`);

  // Insert in chunks
  console.log(`Inserting ${allEntries.length} entries…`);
  const rows = allEntries.map(e => ({
    index_id: INDEX_ID,
    title: (e.work || e.author || '(untitled)').slice(0, 1500),
    author: e.author || null,
    author_normalized: surname(e.author),
    scope: e.scope || null,
    condemnation_period: e.decree_date || null,
    reason: e.reason || null,
    notes: null,
    source_book_id: book.id,
    source_book_slug: book.slug,
    source_page: e.source_page,
    source_excerpt: (e.raw_text || '').slice(0, 2000),
    match_method: 'ocr_extraction',
  }));
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    await supa('POST', 'index_catalog_entries', slice);
    inserted += slice.length;
    process.stdout.write(`\r  ${inserted}/${rows.length} inserted`);
  }
  console.log(`\nInserted ${inserted} entries.`);

  await client.close();
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
