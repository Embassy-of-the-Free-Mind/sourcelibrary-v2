/**
 * Translate remaining BPH pages
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function translateBPH() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  // Get BPH books
  const bphBooks = await db.collection('books').find({
    bph_match: { $exists: true }
  }).project({ _id: 1 }).toArray();
  const bookIds = bphBooks.map(b => b._id.toString());

  // Get pages needing translation
  const pages = await db.collection('pages').find({
    book_id: { $in: bookIds },
    'ocr.data': { $exists: true, $ne: null },
    $or: [
      { 'translation.data': { $exists: false } },
      { 'translation.data': null }
    ]
  }).toArray();

  console.log('Translating', pages.length, 'BPH pages...\n');

  for (const page of pages) {
    const ocrText = page.ocr?.data;
    if (!ocrText || ocrText.length < 10) {
      console.log('Skipping page', page.page_number, '- no OCR text');
      continue;
    }

    // Retry up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const prompt = `Translate this historical text to modern English. Preserve paragraph structure. If already in English, clean up and modernize the language.

Text:
${ocrText.slice(0, 8000)}`;

        const result = await model.generateContent(prompt);
        const translation = result.response.text();

        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              'translation.data': translation,
              'translation.model': 'gemini-2.0-flash-exp',
              'translation.translated_at': new Date()
            }
          }
        );

        console.log('✓ Translated page', page.page_number);
        break;
      } catch (err) {
        console.log('✗ Attempt', attempt, 'failed for page', page.page_number, '-', err.message?.slice(0, 40));
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 5000 * attempt));
        }
      }
    }

    // Longer delay to avoid rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nDone!');
  await client.close();
}

translateBPH().catch(console.error);
