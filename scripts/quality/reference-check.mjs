#!/usr/bin/env node
/**
 * Reference text quality check for OCR pages.
 *
 * Compares OCR output against known-correct reference texts (Sefaria, Quran API, etc.)
 * using embedding similarity. This catches confabulation that internal OCR↔translation
 * alignment scoring misses.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/quality/reference-check.mjs --book BOOK_ID --source sefaria --ref "Zohar, Shemot"
 *   node scripts/quality/reference-check.mjs --book BOOK_ID --source quran --ref 2
 *   node scripts/quality/reference-check.mjs --book BOOK_ID --source sefaria --ref "Genesis" --save
 *   node scripts/quality/reference-check.mjs --scan  # find books with available references
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Config ---
const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;
const MAX_TEXT_LENGTH = 8000;
const CHUNK_SIZE = 800;       // characters per reference chunk
const CHUNK_OVERLAP = 200;    // overlap between chunks
const FLAG_THRESHOLD = 0.65;  // below this = likely bad OCR
const WARN_THRESHOLD = 0.75;  // below this = suspect

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_ID = getArg('book');
const SOURCE = getArg('source') || 'sefaria';
const REF = getArg('ref');
const SAVE = hasFlag('save');
const SCAN = hasFlag('scan');
const SAMPLE = parseInt(getArg('sample') || '0', 10); // 0 = all pages
const VERBOSE = hasFlag('verbose');

// --- Text processing ---
function stripAnnotations(text) {
  return text
    .replace(/<(?:meta|language|lang|page-type|page-num|header|sig|folio|warning|vocab|keywords|summary|abbrev|columns|detected-images|script)>[\s\S]*?<\/(?:meta|language|lang|page-type|page-num|header|sig|folio|warning|vocab|keywords|summary|abbrev|columns|detected-images|script)>/gi, '')
    .replace(/<\/?(?:note|term|margin|gloss|unclear|gap|del|supplied|sic|corr)>/gi, '')
    .replace(/^#+\s.*$/gm, '')     // strip markdown headings
    .replace(/^>\s.*$/gm, '')      // strip blockquotes
    .replace(/->.*?<-/g, '')       // strip centered text markers
    .replace(/\*\*/g, '')          // strip bold
    .replace(/---+/g, '')          // strip horizontal rules
    .replace(/\[\[.*?\]\]/g, '')   // strip legacy bracket tags
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

// --- Embedding ---
async function getEmbeddings(genai, texts) {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text: text.slice(0, MAX_TEXT_LENGTH) }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) {
        results.push(emb.values);
      }
    } catch {
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch {
          results.push(null);
        }
      }
    }

    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return results;
}

function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- Reference text sources ---

async function fetchSefaria(ref) {
  // Sefaria refs use comma-space for complex texts: "Zohar, Shemot"
  const encoded = encodeURIComponent(ref);
  const url = `https://www.sefaria.org/api/v3/texts/${encoded}`;

  console.log(`  Fetching Sefaria: ${ref}`);
  const response = await fetch(url);
  if (!response.ok) {
    // Try with range
    const rangeUrl = `${url}:1-50`;
    const rangeResponse = await fetch(rangeUrl);
    if (!rangeResponse.ok) {
      throw new Error(`Sefaria API error: ${response.status} for ref "${ref}". Try a more specific ref (e.g., "Genesis.1" or "Zohar, Shemot:1-10")`);
    }
    const data = await rangeResponse.json();
    return extractSefariaText(data);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Sefaria: ${data.error}`);
  }
  return extractSefariaText(data);
}

function extractSefariaText(data) {
  const versions = data.versions || [];
  const heVersion = versions.find(v => v.language === 'he');
  if (!heVersion) {
    throw new Error('No Hebrew version found in Sefaria response');
  }

  const flat = [];
  function flatten(x) {
    if (Array.isArray(x)) {
      for (const item of x) flatten(item);
    } else if (typeof x === 'string' && x.trim()) {
      flat.push(stripHtml(x.trim()));
    }
  }
  flatten(heVersion.text);
  return flat.join('\n');
}

async function fetchSefariaChunked(ref, chunkCount = 10) {
  // For large texts, fetch in sections
  const chunks = [];
  for (let i = 1; i <= chunkCount * 10; i += 10) {
    try {
      const rangeRef = `${ref}:${i}-${i + 9}`;
      const text = await fetchSefaria(rangeRef);
      if (text.trim()) chunks.push(text);
      await new Promise(r => setTimeout(r, 300)); // rate limit
    } catch {
      break; // reached end of text
    }
  }
  return chunks.join('\n');
}

async function fetchQuran(surahNumber) {
  console.log(`  Fetching Quran surah ${surahNumber}`);
  const url = `https://api.alquran.cloud/v1/surah/${surahNumber}/ar`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Quran API error: ${response.status}`);
  const data = await response.json();

  if (data.code !== 200) throw new Error(`Quran API: ${data.status}`);

  return data.data.ayahs.map(a => a.text).join('\n');
}

async function fetchReference(source, ref) {
  switch (source) {
    case 'sefaria': {
      // Try direct fetch first, then chunked
      try {
        return await fetchSefaria(ref);
      } catch (e) {
        if (e.message.includes('complex')) {
          console.log('  Complex ref — fetching in chunks...');
          return await fetchSefariaChunked(ref);
        }
        throw e;
      }
    }
    case 'quran':
      return await fetchQuran(parseInt(ref, 10));
    default:
      throw new Error(`Unknown source: ${source}. Supported: sefaria, quran`);
  }
}

// --- Chunking ---
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) { // skip tiny trailing chunks
      chunks.push({ text: chunk, start, end });
    }
    start += chunkSize - overlap;
  }
  return chunks;
}

// --- Scanning for auto-detectable references ---
const SEFARIA_TITLE_MAP = [
  // Hebrew Bible
  { pattern: /biblia hebraica|hebrew bible|tanakh|codex.*hebraicus/i, refs: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
  { pattern: /chumshe torah|humshei torah|pentateuch|up-biblium/i, refs: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
  { pattern: /geneva bible|estienne bible|codex gigas/i, refs: ['Genesis', 'Exodus'] },
  // Zohar
  { pattern: /zohar.*(?:shemot|exodus)/i, refs: ['Zohar, Shemot'] },
  { pattern: /zohar.*(?:bereshit|genesis|genèse)/i, refs: ['Zohar, Bereshit'] },
  { pattern: /zohar.*(?:vayikra|leviticus)/i, refs: ['Zohar, Vayikra'] },
  { pattern: /zohar.*(?:bamidbar|numbers)/i, refs: ['Zohar, Bamidbar'] },
  { pattern: /zohar.*(?:devarim|deuteronomy)/i, refs: ['Zohar, Devarim'] },
  { pattern: /zohar.*(?:splendour|splendor|cremona|mantua)/i, refs: ['Zohar, Bereshit', 'Zohar, Shemot'] },
  { pattern: /luria.*zohar.*genesis/i, refs: ['Zohar, Bereshit'] },
  { pattern: /zohar/i, refs: ['Zohar, Bereshit'] },
  // Talmud tractates
  { pattern: /berakhot|berachot/i, refs: ['Berakhot'] },
  { pattern: /shabbat/i, refs: ['Shabbat'] },
  { pattern: /sanhedrin/i, refs: ['Sanhedrin'] },
  // Mishnah
  { pattern: /mishnah|mishnaioth/i, refs: ['Mishnah Berakhot'] },
  // Kabbalistic
  { pattern: /sefer ha-?bahir|bahir/i, refs: ['Bahir'] },
  { pattern: /sefer yetzirah|sefer yezirah/i, refs: ['Sefer Yetzirah'] },
  // Prayer books
  { pattern: /siddur|prayer book/i, refs: ['Siddur Ashkenaz, Weekday, Shacharit'] },
  // Bhagavad Gita
  { pattern: /bhagavad.?gita|bhagavadgita/i, refs: [] }, // Sefaria doesn't have this
];

const QURAN_TITLE_MAP = [
  { pattern: /qur[a']n|koran|al-quran|al-kitab al-muqaddas/i, surah: 2 },
];

async function scanForReferences(db) {
  console.log('\nScanning library for books with available reference texts...\n');

  const books = await db.collection('books').find(
    { pages_ocr: { $gt: 10 } },
    { projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'semantic_alignment.mean_alignment': 1 } }
  ).toArray();

  const matches = [];

  for (const book of books) {
    const title = book.title || '';

    for (const mapping of SEFARIA_TITLE_MAP) {
      if (mapping.pattern.test(title)) {
        matches.push({
          book_id: book.id || book._id.toString(),
          title: book.title,
          source: 'sefaria',
          refs: mapping.refs,
          pages_ocr: book.pages_ocr,
          alignment: book.semantic_alignment?.mean_alignment,
        });
        break;
      }
    }

    for (const mapping of QURAN_TITLE_MAP) {
      if (mapping.pattern.test(title)) {
        matches.push({
          book_id: book.id || book._id.toString(),
          title: book.title,
          source: 'quran',
          refs: [String(mapping.surah)],
          pages_ocr: book.pages_ocr,
          alignment: book.semantic_alignment?.mean_alignment,
        });
        break;
      }
    }
  }

  console.log(`Found ${matches.length} books with available reference texts:\n`);
  console.log('Book ID                       | Title                                    | Source  | Refs                    | OCR Pages | Alignment');
  console.log('------------------------------|------------------------------------------|---------|-------------------------|-----------|----------');
  for (const m of matches) {
    const id = m.book_id.padEnd(30);
    const title = (m.title || '').slice(0, 40).padEnd(40);
    const source = m.source.padEnd(7);
    const refs = m.refs.join(', ').slice(0, 23).padEnd(23);
    const pages = String(m.pages_ocr || 0).padStart(9);
    const align = m.alignment ? m.alignment.toFixed(3).padStart(9) : '      n/a';
    console.log(`${id} | ${title} | ${source} | ${refs} | ${pages} | ${align}`);
  }

  return matches;
}

// --- Main ---
async function main() {
  if (!SCAN && !BOOK_ID) {
    console.error('Usage: node reference-check.mjs --book BOOK_ID --source sefaria --ref "Genesis.1"');
    console.error('       node reference-check.mjs --scan');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db('bookstore');
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  try {
    if (SCAN) {
      await scanForReferences(db);
      return;
    }

    // --- Single book check ---
    if (!REF) {
      console.error('--ref required. For Sefaria: "Genesis.1", "Zohar, Shemot:1-10". For Quran: surah number.');
      process.exit(1);
    }

    // Get book
    const book = await db.collection('books').findOne(
      { $or: [{ id: BOOK_ID }, { _id: new (await import('mongodb')).ObjectId(BOOK_ID) }] },
      { projection: { id: 1, title: 1, language: 1 } }
    );
    if (!book) { console.error(`Book not found: ${BOOK_ID}`); process.exit(1); }

    const bookId = book.id || book._id.toString();
    console.log(`\nBook: ${book.title}`);
    console.log(`Language: ${book.language || 'unknown'}`);
    console.log(`Reference: ${SOURCE} / ${REF}\n`);

    // Fetch reference text
    console.log('Fetching reference text...');
    const referenceText = await fetchReference(SOURCE, REF);
    console.log(`  Reference text: ${referenceText.length} chars\n`);

    if (referenceText.length < 100) {
      console.error('Reference text too short. Check your ref.');
      process.exit(1);
    }

    // Chunk reference text
    const refChunks = chunkText(referenceText);
    console.log(`  ${refChunks.length} reference chunks (${CHUNK_SIZE} chars, ${CHUNK_OVERLAP} overlap)\n`);

    // Embed reference chunks
    console.log('Embedding reference chunks...');
    const refEmbeddings = await getEmbeddings(genai, refChunks.map(c => c.text));
    const validRefCount = refEmbeddings.filter(e => e !== null).length;
    console.log(`  ${validRefCount}/${refChunks.length} chunks embedded\n`);

    // Get OCR pages
    const query = { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } };
    let pages = await db.collection('pages').find(
      query,
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 } }
    ).sort({ page_number: 1 }).toArray();

    // Filter to body text pages (skip title pages, blanks, etc.)
    pages = pages.filter(p => {
      const ocr = p.ocr?.data || '';
      const stripped = stripAnnotations(ocr);
      return stripped.length > 100; // skip near-empty pages
    });

    if (SAMPLE > 0 && SAMPLE < pages.length) {
      // Sample evenly across the book
      const step = Math.floor(pages.length / SAMPLE);
      pages = pages.filter((_, i) => i % step === 0).slice(0, SAMPLE);
    }

    console.log(`Checking ${pages.length} pages with OCR...\n`);

    // Embed OCR pages
    const ocrTexts = pages.map(p => stripAnnotations(p.ocr.data));
    console.log('Embedding OCR pages...');
    const ocrEmbeddings = await getEmbeddings(genai, ocrTexts);
    console.log(`  ${ocrEmbeddings.filter(e => e !== null).length}/${pages.length} pages embedded\n`);

    // Compare each page against all reference chunks, find best match
    const results = [];

    console.log('Page  | Best Match | Score  | Status');
    console.log('------|------------|--------|--------');

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const ocrEmb = ocrEmbeddings[i];

      if (!ocrEmb) {
        results.push({ page_number: page.page_number, score: null, status: 'no_embedding' });
        continue;
      }

      // Find best matching reference chunk
      let bestScore = -1;
      let bestChunkIdx = -1;
      for (let j = 0; j < refEmbeddings.length; j++) {
        if (!refEmbeddings[j]) continue;
        const sim = cosineSimilarity(ocrEmb, refEmbeddings[j]);
        if (sim > bestScore) {
          bestScore = sim;
          bestChunkIdx = j;
        }
      }

      const status = bestScore < FLAG_THRESHOLD ? 'FAIL' :
                     bestScore < WARN_THRESHOLD ? 'WARN' : 'OK';

      results.push({
        page_number: page.page_number,
        page_id: page.id || page._id.toString(),
        score: bestScore,
        best_chunk: bestChunkIdx,
        status,
      });

      const pageNum = String(page.page_number).padStart(5);
      const chunkStr = String(bestChunkIdx).padStart(10);
      const scoreStr = bestScore.toFixed(4).padStart(6);
      const statusStr = status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' :
                        status === 'WARN' ? '\x1b[33mWARN\x1b[0m' :
                        '\x1b[32m  OK\x1b[0m';
      console.log(`${pageNum} | ${chunkStr} | ${scoreStr} | ${statusStr}`);

      if (VERBOSE && status !== 'OK') {
        console.log(`        OCR preview: ${ocrTexts[i].slice(0, 120)}...`);
        if (bestChunkIdx >= 0) {
          console.log(`        Ref preview: ${refChunks[bestChunkIdx].text.slice(0, 120)}...`);
        }
      }
    }

    // Summary
    const scored = results.filter(r => r.score !== null);
    const failed = scored.filter(r => r.status === 'FAIL');
    const warned = scored.filter(r => r.status === 'WARN');
    const passed = scored.filter(r => r.status === 'OK');
    const meanScore = scored.length > 0
      ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length
      : 0;

    console.log('\n--- Summary ---');
    console.log(`Pages checked:  ${scored.length}`);
    console.log(`Mean ref score: ${meanScore.toFixed(4)}`);
    console.log(`Passed (>=${WARN_THRESHOLD}): ${passed.length}`);
    console.log(`Warned (${FLAG_THRESHOLD}-${WARN_THRESHOLD}): ${warned.length}`);
    console.log(`Failed (<${FLAG_THRESHOLD}): ${failed.length}`);

    if (failed.length > 0) {
      console.log(`\nWorst pages:`);
      const worst = [...scored].sort((a, b) => a.score - b.score).slice(0, 10);
      for (const r of worst) {
        console.log(`  Page ${r.page_number}: ${r.score.toFixed(4)}`);
      }
    }

    // Save results
    if (SAVE && scored.length > 0) {
      console.log('\nSaving reference check results...');
      const bulkOps = scored.map(r => ({
        updateOne: {
          filter: { id: r.page_id },
          update: {
            $set: {
              'reference_check': {
                source: SOURCE,
                ref: REF,
                score: r.score,
                best_chunk: r.best_chunk,
                status: r.status,
                checked_at: new Date(),
              }
            }
          }
        }
      }));

      await db.collection('pages').bulkWrite(bulkOps);

      // Book-level summary
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            'reference_check': {
              source: SOURCE,
              ref: REF,
              pages_checked: scored.length,
              mean_score: meanScore,
              pages_failed: failed.length,
              pages_warned: warned.length,
              checked_at: new Date(),
            }
          }
        }
      );

      console.log(`  Saved ${scored.length} page scores + book summary`);
    }

    // Exit code based on results
    if (failed.length > scored.length * 0.5) {
      console.log('\n⚠ More than 50% of pages failed reference check.');
      process.exit(2);
    }

  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
