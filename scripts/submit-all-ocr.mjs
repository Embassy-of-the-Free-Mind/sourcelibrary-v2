/**
 * Submit OCR batch jobs for all books that need OCR
 * Uses Gemini Batch API (50% cost savings)
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.local' });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 50; // Pages per batch job

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
  const fileInfo = await uploadRes.json();
  return fileInfo.file.name;
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

async function submitAllOcr() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Submitting OCR Batch Jobs ===\n');

  // Get all books
  const books = await db.collection('books').find({}).toArray();
  console.log(`Checking ${books.length} books...\n`);

  let totalJobsCreated = 0;
  let totalPagesQueued = 0;
  let booksProcessed = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const bookTitle = book.title || 'Untitled';

    // Get pages needing OCR for this book
    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        $or: [
          { 'ocr.data': { $exists: false } },
          { 'ocr.data': null },
          { 'ocr.data': '' },
        ],
      })
      .project({ id: 1, photo: 1, cropped_photo: 1, page_number: 1 })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) continue;

    booksProcessed++;
    console.log(`\n[${booksProcessed}] ${bookTitle} (${pages.length} pages)`);

    // Split into batches
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pages.length / BATCH_SIZE);

      try {
        // Build JSONL requests
        const requests = [];
        for (const page of batch) {
          const imageUrl = page.cropped_photo || page.photo;
          if (!imageUrl) continue;

          try {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) continue;

            const buf = await imgRes.arrayBuffer();
            const base64 = Buffer.from(buf).toString('base64');
            const mimeType = imgRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

            requests.push({
              key: page.id,
              request: {
                contents: [{
                  parts: [
                    { text: OCR_PROMPT },
                    { inlineData: { mimeType, data: base64 } },
                  ],
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
              },
            });
          } catch (e) {
            // Skip failed image fetches
          }
        }

        if (requests.length === 0) continue;

        // Create JSONL
        const jsonlContent = requests.map(r => JSON.stringify(r)).join('\n');
        const displayName = `ocr-${bookId.slice(0, 8)}-batch${batchNum}`;

        // Upload and create batch job
        const fileName = await uploadBatchFile(jsonlContent, `${displayName}.jsonl`);
        const batchJob = await createBatchJob(fileName, displayName);

        // Save to database
        const jobId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection('batch_jobs').insertOne({
          id: jobId,
          gemini_job_name: batchJob.name,
          type: 'ocr',
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

        console.log(`  Batch ${batchNum}/${totalBatches}: ${batchJob.name} (${requests.length} pages)`);
        totalJobsCreated++;
        totalPagesQueued += requests.length;

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.error(`  Batch ${batchNum} failed: ${e.message}`);
      }
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`Books processed: ${booksProcessed}`);
  console.log(`Jobs created: ${totalJobsCreated}`);
  console.log(`Pages queued: ${totalPagesQueued}`);

  await client.close();
}

submitAllOcr().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
