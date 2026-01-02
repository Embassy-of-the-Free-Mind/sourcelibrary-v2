/**
 * Submit OCR batch jobs for all books that need OCR
 * Uses Gemini Batch API (50% cost savings)
 *
 * Logs all submissions to:
 * - logs/batch-submit.log (file)
 * - Console output
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
const BATCH_SIZE = 25; // Pages per batch job (reduced for smaller files)
const MAX_IMAGE_WIDTH = 800; // Resize images to max 800px width for OCR (tested: identical quality, 78% smaller)

const LOG_DIR = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'batch-submit.log');

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
  // Resize to max width, maintaining aspect ratio, and convert to JPEG
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
  // Delete uploaded file to free quota (files count against 20GB storage limit)
  try {
    await fetch(`${API_BASE}/${fileName}?key=${API_KEY}`, { method: 'DELETE' });
  } catch (e) {
    // Ignore delete errors - file will expire anyway
  }
}

const OCR_PROMPT = `Transcribe this {language} manuscript page to Markdown.

**Format:**
- # ## ### for headings (bigger text = bigger heading) — NEVER combine with centering syntax
- **bold**, *italic* for emphasis
- ->centered text<- for centered lines (NOT for headings)
- > blockquotes for quotes/prayers
- --- for dividers

**Tables:** Use markdown tables ONLY for actual tabular data with clear rows/columns:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| data | data | data |

**DO NOT use tables for:**
- Circular diagrams
- Charts or graphs
- Any visual layout that isn't truly tabular

**Metadata tags (hidden from readers):**
- <lang>detected</lang> — confirm the language
- <page-num>N</page-num> — visible page/folio numbers (NOT in body text)
- <header>X</header> — running headers (NOT in body text)
- <sig>X</sig> — printer's marks like A2, B1 (NOT in body text)
- <meta>X</meta> — hidden metadata (image quality, catchwords)
- <warning>X</warning> — quality issues (faded, damaged, blurry)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — boxed text, later additions (inline only, not around tables)
- <unclear>X</unclear> — illegible readings
- <note>X</note> — interpretive notes for readers
- <term>X</term> — technical vocabulary
- <image-desc>description</image-desc> — describe illustrations, diagrams, circular charts, woodcuts

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags only, never in body
3. IGNORE partial text at left/right edges (from facing page in spread)
4. Capture ALL text including margins and annotations
5. Describe any images/diagrams with <image-desc>...</image-desc> using prose, never tables
6. End with <vocab>key terms, names, concepts on this page</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>`;

async function submitAllOcr() {
  ensureLogDir();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  log('=== Submitting OCR Batch Jobs ===');
  log(`Started at: ${new Date().toISOString()}`);

  // Get books that already have batch jobs
  const booksWithJobs = await db.collection('batch_jobs').distinct('book_id');
  const booksWithJobsSet = new Set(booksWithJobs);
  log(`Books already with jobs: ${booksWithJobs.length}`);

  // Get all books, skip those with existing jobs
  const allBooks = await db.collection('books').find({}).toArray();
  const books = allBooks.filter(b => !booksWithJobsSet.has(b.id || b._id?.toString()));
  log(`Checking ${books.length} books (skipping ${allBooks.length - books.length} with existing jobs)...`);

  let totalJobsCreated = 0;
  let totalPagesQueued = 0;
  let booksProcessed = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const bookTitle = book.title || 'Untitled';

    // Get pages needing OCR with accessible images (not archive.org)
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
    log(`\n[${booksProcessed}] ${bookTitle} (${pages.length} pages)`);

    // Split into batches
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pages.length / BATCH_SIZE);

      try {
        // Build JSONL requests
        const requests = [];
        for (const page of batch) {
          const imageUrl = page.cropped_photo || page.archived_photo || page.photo;
          if (!imageUrl) continue;

          try {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) continue;

            const buf = await imgRes.arrayBuffer();
            // Resize image to reduce file size (1200px max width, 85% JPEG quality)
            const resizedBuf = await resizeImage(Buffer.from(buf));
            const base64 = resizedBuf.toString('base64');
            const mimeType = 'image/jpeg'; // Always JPEG after resize

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

        // Delete file to free quota (batch API copies data, original file not needed)
        await deleteFile(fileName);

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

        log(`  Batch ${batchNum}/${totalBatches}: ${batchJob.name} (${requests.length} pages)`);
        totalJobsCreated++;
        totalPagesQueued += requests.length;

        // Small delay to avoid rate limits
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
  log(`Completed at: ${new Date().toISOString()}`);

  await client.close();
}

submitAllOcr().catch(e => {
  log(`FATAL ERROR: ${e.message}`);
  console.error('Error:', e);
  process.exit(1);
});
