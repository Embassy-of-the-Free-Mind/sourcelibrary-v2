#!/usr/bin/env node
/**
 * Resubmit OCR for the first 110 books in the library
 * These were processed with earlier (possibly lower quality) OCR
 *
 * Run: node scripts/resubmit-early-books.mjs
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 25;
const MAX_IMAGE_WIDTH = 800; // Tested: identical OCR quality, 78% smaller files
const BOOKS_TO_RESUBMIT = 110;

async function resizeImage(buffer) {
  return sharp(buffer)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function uploadBatchFile(jsonlContent, displayName) {
  const contentLength = Buffer.byteLength(jsonlContent);
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': contentLength.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({ file: { displayName } }),
    }
  );
  if (!startRes.ok) throw new Error(`Upload start failed: ${await startRes.text()}`);

  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: jsonlContent,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
  return (await uploadRes.json()).file.name;
}

async function createBatchJob(fileName, displayName) {
  const res = await fetch(
    `${API_BASE}/models/${MODEL}:batchGenerateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: { file_name: fileName },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Batch creation failed: ${await res.text()}`);
  return res.json();
}

async function deleteFile(fileName) {
  try {
    await fetch(`${API_BASE}/${fileName}?key=${API_KEY}`, { method: 'DELETE' });
  } catch (e) { /* ignore */ }
}

const OCR_PROMPT = `You are an expert paleographer and OCR specialist. Transcribe the text from this historical document image.

Instructions:
1. Transcribe ALL visible text exactly as written
2. Preserve original spelling, abbreviations, and punctuation
3. Use <lang>language</lang> tags to indicate the primary language
4. Use <page-num>X</page-num> if page number is visible
5. Use <header>text</header> for headers/titles
6. Use <vocab>term1, term2</vocab> for notable terms at the end
7. Preserve paragraph breaks with blank lines

Output the transcription directly without any commentary.`;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log(`=== Resubmitting OCR for First ${BOOKS_TO_RESUBMIT} Books ===\n`);

  // Get the first 110 books by creation date
  const books = await db.collection('books')
    .find({})
    .sort({ created_at: 1, _id: 1 })
    .limit(BOOKS_TO_RESUBMIT)
    .toArray();

  console.log(`Found ${books.length} books to resubmit\n`);

  // Mark these for resubmission by clearing OCR batch job references
  // We'll create new batch jobs with type 'ocr_resubmit' to track them separately

  let totalJobs = 0;
  let totalPages = 0;

  for (let bookIdx = 0; bookIdx < books.length; bookIdx++) {
    const book = books[bookIdx];
    const bookId = book.id || book._id?.toString();
    const bookTitle = book.title || 'Untitled';

    // Get ALL pages for this book (even those with existing OCR)
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .project({ id: 1, photo: 1, cropped_photo: 1, page_number: 1 })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) continue;

    console.log(`\n[${bookIdx + 1}/${books.length}] ${bookTitle} (${pages.length} pages)`);

    // Process in batches
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pages.length / BATCH_SIZE);

      try {
        const requests = [];
        for (const page of batch) {
          const imageUrl = page.cropped_photo || page.photo;
          if (!imageUrl) continue;

          try {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) continue;

            const buf = await imgRes.arrayBuffer();
            const resizedBuf = await resizeImage(Buffer.from(buf));
            const base64 = resizedBuf.toString('base64');

            requests.push({
              key: page.id,
              request: {
                contents: [{
                  parts: [
                    { text: OCR_PROMPT },
                    { inlineData: { mimeType: 'image/jpeg', data: base64 } },
                  ],
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
              },
            });
          } catch (e) { /* skip */ }
        }

        if (requests.length === 0) continue;

        const jsonlContent = requests.map(r => JSON.stringify(r)).join('\n');
        const displayName = `ocr-resub-${bookId.slice(0, 8)}-batch${batchNum}`;

        const fileName = await uploadBatchFile(jsonlContent, `${displayName}.jsonl`);
        const batchJob = await createBatchJob(fileName, displayName);
        await deleteFile(fileName);

        // Save to database with type 'ocr_resubmit'
        const jobId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection('batch_jobs').insertOne({
          id: jobId,
          gemini_job_name: batchJob.name,
          type: 'ocr_resubmit', // Different type to track resubmissions
          book_id: bookId,
          book_title: bookTitle,
          model: MODEL,
          language: book.language || 'Latin',
          status: 'pending',
          gemini_state: 'BATCH_STATE_PENDING',
          page_ids: requests.map(r => r.key),
          total_pages: requests.length,
          completed_pages: 0,
          failed_pages: 0,
          created_at: new Date(),
          updated_at: new Date(),
        });

        console.log(`  Batch ${batchNum}/${totalBatches}: ${requests.length} pages`);
        totalJobs++;
        totalPages += requests.length;

        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.error(`  Batch ${batchNum} failed: ${e.message}`);
        if (e.message.includes('quota')) {
          console.log('\nQuota exceeded - stopping');
          console.log(`\n=== Partial Summary ===`);
          console.log(`Jobs created: ${totalJobs}`);
          console.log(`Pages queued: ${totalPages}`);
          console.log(`Books processed: ${bookIdx + 1}/${books.length}`);
          await client.close();
          process.exit(0);
        }
      }
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`Jobs created: ${totalJobs}`);
  console.log(`Pages queued: ${totalPages}`);

  await client.close();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
