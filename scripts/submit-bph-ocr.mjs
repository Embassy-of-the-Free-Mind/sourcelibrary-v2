/**
 * Submit OCR batch jobs for BPH matched books only
 * Uses Gemini Batch API (50% cost savings)
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 25;
const MAX_IMAGE_WIDTH = 800;

const LOG_DIR = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'bph-ocr-submit.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(message);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

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

async function deleteFile(fileName) {
  try {
    await fetch(`${API_BASE}/${fileName}?key=${API_KEY}`, { method: 'DELETE' });
  } catch (e) {}
}

const OCR_PROMPT = `Transcribe this manuscript page to Markdown.

**Format:**
- # ## ### for headings (bigger text = bigger heading)
- **bold**, *italic* for emphasis
- ->centered text<- for centered lines (NOT for headings)
- > blockquotes for quotes/prayers
- --- for dividers

**Metadata tags:**
- <lang>detected</lang>
- <page-num>N</page-num>
- <header>X</header>
- <warning>X</warning> — quality issues
- <vocab>key terms</vocab>

**Inline annotations:**
- <margin>X</margin> — marginal notes
- <unclear>X</unclear> — illegible readings
- <image-desc>description</image-desc> — describe illustrations

**Rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers go in metadata tags only
3. Capture ALL text including margins
4. End with <vocab>key terms on this page</vocab>`;

async function submitBphOcr() {
  ensureLogDir();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  log('=== Submitting BPH OCR Batch Jobs ===');
  log(`Started at: ${new Date().toISOString()}`);

  // Get BPH matched books (not EFM - they're already done)
  const bphBooks = await db.collection('books').find({
    bph_match: { $exists: true },
    'image_source.provider': { $ne: 'efm' }
  }).toArray();

  log(`BPH matched books: ${bphBooks.length}`);

  // Get books that already have batch jobs
  const booksWithJobs = await db.collection('batch_jobs').distinct('book_id');
  const booksWithJobsSet = new Set(booksWithJobs);

  const books = bphBooks.filter(b => !booksWithJobsSet.has(b.id || b._id?.toString()));
  log(`Books needing jobs: ${books.length} (${bphBooks.length - books.length} already have jobs)`);

  let totalJobsCreated = 0;
  let totalPagesQueued = 0;
  let booksProcessed = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const bookTitle = book.title || 'Untitled';

    // Get pages needing OCR with accessible images
    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        $and: [
          { $or: [
            { 'ocr.data': { $exists: false } },
            { 'ocr.data': null },
            { 'ocr.data': '' },
          ]},
          { $or: [
            { cropped_photo: { $exists: true, $ne: null } },
            { archived_photo: { $exists: true, $ne: null } },
            { photo: { $exists: true, $ne: null, $not: { $regex: 'archive\\.org' } } }
          ]}
        ],
      })
      .project({ id: 1, photo: 1, archived_photo: 1, cropped_photo: 1, page_number: 1 })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) continue;

    booksProcessed++;
    log(`\n[${booksProcessed}/${books.length}] ${bookTitle.slice(0, 50)} (${pages.length} pages)`);

    // Split into batches
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pages.length / BATCH_SIZE);

      try {
        const requests = [];
        for (const page of batch) {
          const imageUrl = page.cropped_photo || page.archived_photo || page.photo;
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
          } catch (e) {}
        }

        if (requests.length === 0) continue;

        const jsonlContent = requests.map(r => JSON.stringify(r)).join('\n');
        const displayName = `bph-ocr-${bookId.slice(0, 8)}-b${batchNum}`;

        const fileName = await uploadBatchFile(jsonlContent, `${displayName}.jsonl`);
        const batchJob = await createBatchJob(fileName, displayName);
        await deleteFile(fileName);

        const jobId = `bph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
          is_bph: true,
          created_at: new Date(),
          updated_at: new Date(),
        });

        log(`  Batch ${batchNum}/${totalBatches}: ${requests.length} pages`);
        totalJobsCreated++;
        totalPagesQueued += requests.length;

        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        log(`  Batch ${batchNum} failed: ${e.message}`);
      }
    }
  }

  log(`\n=== Submit Complete ===`);
  log(`Books processed: ${booksProcessed}`);
  log(`Jobs created: ${totalJobsCreated}`);
  log(`Pages queued: ${totalPagesQueued}`);

  await client.close();
}

submitBphOcr().catch(e => {
  log(`FATAL ERROR: ${e.message}`);
  process.exit(1);
});
