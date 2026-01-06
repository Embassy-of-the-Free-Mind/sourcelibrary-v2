/**
 * Batch translate EFM (direct BPH) pages
 * Uses Gemini API with rate limiting
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BATCH_SIZE = 50;
const DELAY_MS = 1000;

async function translateEFM() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  // Get EFM book IDs
  const efmBooks = await db.collection('books').find({
    'image_source.provider': 'efm'
  }).project({ id: 1 }).toArray();
  const bookIds = efmBooks.map(b => b.id).filter(Boolean);

  console.log('EFM books:', efmBooks.length);

  // Get pages needing translation (translation is null or translation.data is missing)
  const query = {
    book_id: { $in: bookIds },
    'ocr.data': { $exists: true, $ne: null, $ne: '' },
    $or: [
      { translation: null },
      { translation: { $exists: false } },
      { 'translation.data': null },
      { 'translation.data': { $exists: false } },
      { 'translation.data': '' }
    ]
  };

  const totalNeeding = await db.collection('pages').countDocuments(query);
  console.log('Pages needing translation:', totalNeeding);

  let translated = 0;
  let failed = 0;

  while (true) {
    const pages = await db.collection('pages')
      .find(query)
      .limit(BATCH_SIZE)
      .toArray();

    if (pages.length === 0) break;

    for (const page of pages) {
      const ocrText = page.ocr?.data;
      if (!ocrText || ocrText.length < 20) {
        // Mark as no text
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: { 'translation.data': '[No text to translate]', 'translation.is_empty': true } }
        );
        translated++;
        continue;
      }

      // Retry up to 3 times
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const prompt = `Translate this historical text to modern English. Preserve paragraph structure and formatting. If already in English, clean up and modernize the language while preserving meaning.

Text:
${ocrText.slice(0, 12000)}`;

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

          translated++;
          success = true;
          break;
        } catch (err) {
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 3000 * attempt));
          } else {
            console.log('✗ Failed page', page.page_number, '-', err.message?.slice(0, 40));
            failed++;
          }
        }
      }

      // Progress
      if (translated % 10 === 0) {
        const remaining = totalNeeding - translated - failed;
        console.log(`✓ ${translated} done | ${failed} failed | ${remaining} remaining`);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n=== Done ===');
  console.log('Translated:', translated);
  console.log('Failed:', failed);

  await client.close();
}

translateEFM().catch(console.error);
