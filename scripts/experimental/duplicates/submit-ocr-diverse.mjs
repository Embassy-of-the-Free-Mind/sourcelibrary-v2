/**
 * Submit OCR batch jobs with DIVERSE ordering
 * Interleaves books by language and provider for variety
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
const MAX_IMAGE_WIDTH = 800;

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
  } catch (e) { /* ignore */ }
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

/**
 * Interleave books by language for diversity
 */
function diversifyBooks(books) {
  // Group by language
  const byLanguage = {};
  for (const book of books) {
    const lang = book.language || 'Unknown';
    if (!byLanguage[lang]) byLanguage[lang] = [];
    byLanguage[lang].push(book);
  }

  // Sort languages by count (most first) but we'll interleave
  const languages = Object.keys(byLanguage).sort((a, b) => byLanguage[b].length - byLanguage[a].length);

  console.log('\nLanguage distribution:');
  for (const lang of languages.slice(0, 10)) {
    console.log(`  ${lang}: ${byLanguage[lang].length} books`);
  }
  console.log('');

  // Interleave: take one book from each language in rotation
  const result = [];
  let maxLen = Math.max(...Object.values(byLanguage).map(arr => arr.length));

  for (let i = 0; i < maxLen; i++) {
    for (const lang of languages) {
      if (i < byLanguage[lang].length) {
        result.push(byLanguage[lang][i]);
      }
    }
  }

  return result;
}

async function submitDiverseOcr() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Submitting OCR Batch Jobs (DIVERSE ORDER) ===\n');

  // Get books that already have batch jobs
  const booksWithJobs = await db.collection('batch_jobs').distinct('book_id');
  const booksWithJobsSet = new Set(booksWithJobs);
  console.log(`Books already with jobs: ${booksWithJobs.length}`);

  // Get all books, skip those with existing jobs
  const allBooks = await db.collection('books').find({}).toArray();
  const booksToProcess = allBooks.filter(b => !booksWithJobsSet.has(b.id || b._id?.toString()));

  // Diversify the order
  const books = diversifyBooks(booksToProcess);
  console.log(`Processing ${books.length} books in diversified order\n`);

  let totalJobsCreated = 0;
  let totalPagesQueued = 0;
  let booksProcessed = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const bookTitle = book.title || 'Untitled';
    const bookLang = book.language || 'Unknown';

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
    console.log(`\n[${booksProcessed}] [${bookLang}] ${bookTitle} (${pages.length} pages)`);

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
          } catch (e) { /* skip failed images */ }
        }

        if (requests.length === 0) continue;

        const jsonlContent = requests.map(r => JSON.stringify(r)).join('\n');
        const displayName = `ocr-${bookId.slice(0, 8)}-batch${batchNum}`;

        const fileName = await uploadBatchFile(jsonlContent, `${displayName}.jsonl`);
        const batchJob = await createBatchJob(fileName, displayName);
        await deleteFile(fileName);

        const jobId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection('batch_jobs').insertOne({
          id: jobId,
          gemini_job_name: batchJob.name,
          type: 'ocr',
          book_id: bookId,
          book_title: bookTitle,
          model: MODEL,
          language: bookLang,
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

submitDiverseOcr().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
