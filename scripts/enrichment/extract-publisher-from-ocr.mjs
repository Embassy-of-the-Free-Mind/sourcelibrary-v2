#!/usr/bin/env node
/**
 * Extract publisher and place of publication from title page OCR.
 *
 * For each book without publisher data:
 *   1. Find the title page (page_type=title-page, usually pages 1-10)
 *   2. Send OCR text to Gemini to extract publisher + place
 *   3. Write to book.publisher, book.place_of_publication with field_provenance
 *
 * Usage:
 *   node scripts/enrichment/extract-publisher-from-ocr.mjs [--dry-run] [--limit N] [--author "Name"]
 *
 * GitHub issue: #694
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 50;
const AUTHOR_ARG = process.argv.indexOf('--author');
const AUTHOR_FILTER = AUTHOR_ARG > -1 ? process.argv[AUTHOR_ARG + 1] : null;

const MODEL = 'gemini-3.1-flash-lite-preview';

const PROMPT = `Extract the publisher/printer and place of publication from this historical book title page.

Rules:
- Return ONLY a JSON object: {"publisher": "...", "place": "..."}
- Use the original language name for the publisher (e.g., "Henricum Petri" not "Heinrich Petri")
- Use the modern English name for the place (e.g., "Basel" not "Basileae")
- If multiple publishers, separate with |
- If uncertain, set the field to null
- If this is clearly not a title page or has no publisher info, return {"publisher": null, "place": null}

Title page OCR:
`;

async function main() {
  console.log(`Publisher Extraction — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}, limit ${LIMIT}`);
  if (AUTHOR_FILTER) console.log(`  Author filter: ${AUTHOR_FILTER}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Find books without publisher
  const query = {
    visible: true,
    pages_count: { $gt: 0 },
    $or: [{ publisher: { $exists: false } }, { publisher: null }, { publisher: '' }],
  };
  if (AUTHOR_FILTER) query.author = AUTHOR_FILTER;

  const books = await db.collection('books').find(query, {
    projection: { id: 1, title: 1, author: 1, published: 1 },
  }).limit(LIMIT).toArray();

  console.log(`Found ${books.length} books without publisher\n`);

  let extracted = 0;
  let failed = 0;
  let noTitlePage = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (i > 0 && i % 10 === 0) console.log(`  ${i}/${books.length}...`);

    // Find title page (check first 10 pages)
    const pages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $lte: 10 }, 'ocr.data': { $exists: true } },
      { projection: { page_number: 1, 'ocr.data': 1 } }
    ).sort({ page_number: 1 }).toArray();

    let titlePageOcr = null;
    for (const p of pages) {
      const ocr = p.ocr?.data || '';
      if (ocr.includes('<page-type>title-page</page-type>') || ocr.includes('<page-type>title page</page-type>')) {
        titlePageOcr = ocr;
        break;
      }
    }

    // Fallback: use first non-blank page
    if (!titlePageOcr) {
      for (const p of pages) {
        const ocr = p.ocr?.data || '';
        if (!ocr.includes('<page-type>blank</page-type>') && ocr.length > 100) {
          titlePageOcr = ocr;
          break;
        }
      }
    }

    if (!titlePageOcr) {
      noTitlePage++;
      continue;
    }

    // Truncate OCR to ~2000 chars (title pages don't need more)
    const truncated = titlePageOcr.substring(0, 2000);

    try {
      const result = await ai.models.generateContent({
        model: MODEL,
        contents: PROMPT + truncated,
        config: { temperature: 0.1, maxOutputTokens: 200 },
      });

      const text = result.text?.trim() || '';
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { failed++; continue; }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.publisher && !parsed.place) { failed++; continue; }

      if (DRY_RUN) {
        console.log(`  ${book.title.substring(0, 50)} → ${parsed.publisher || '—'} (${parsed.place || '—'})`);
      } else {
        const update = {};
        if (parsed.publisher) update.publisher = parsed.publisher;
        if (parsed.place) update.place_of_publication = parsed.place;
        update['field_provenance.publisher'] = {
          source: 'gemini-ocr-extraction',
          method: MODEL,
          confidence: 'medium',
          date: new Date(),
        };

        await db.collection('books').updateOne(
          { id: book.id },
          { $set: update }
        );
        console.log(`  ✓ ${book.author?.substring(0, 20)} — ${parsed.publisher || '—'} (${parsed.place || '—'})`);
      }
      extracted++;
    } catch (err) {
      console.error(`  ✗ ${book.title.substring(0, 40)}: ${err.message}`);
      failed++;
    }

    // Rate limit
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Extracted: ${extracted}, Failed: ${failed}, No title page: ${noTitlePage}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
