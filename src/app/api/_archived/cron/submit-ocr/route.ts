import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';

export const maxDuration = 300; // 5 minute timeout

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 25; // Pages per batch job
const MAX_IMAGE_WIDTH = 800; // Resize images for OCR

// OCR prompt for document transcription - UPDATED with metadata and annotation tags
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

async function resizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function uploadBatchFile(jsonlContent: string, displayName: string): Promise<string> {
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

  if (!startRes.ok) {
    throw new Error(`Upload start failed: ${await startRes.text()}`);
  }

  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('No upload URL returned');

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

async function createBatchJob(fileName: string, displayName: string): Promise<any> {
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

async function deleteFile(fileName: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/${fileName}?key=${API_KEY}`, { method: 'DELETE' });
  } catch (e) {
    // Ignore - file will expire anyway
  }
}

/**
 * Diversify books by language and provider
 * Interleaves books across different language traditions
 * Ensures variety in OCR processing (Latin, Greek, Sanskrit, etc.)
 */
function diversifyBooks(books: any[]): any[] {
  const byLanguage: { [key: string]: any[] } = {};

  for (const book of books) {
    const lang = book.language || 'Unknown';
    if (!byLanguage[lang]) {
      byLanguage[lang] = [];
    }
    byLanguage[lang].push(book);
  }

  const languages = Object.keys(byLanguage).sort(
    (a, b) => byLanguage[b].length - byLanguage[a].length
  );

  const result: any[] = [];
  const maxLen = Math.max(...Object.values(byLanguage).map(arr => arr.length));

  // Cycle through languages, picking one book from each in turn
  for (let i = 0; i < maxLen; i++) {
    for (const lang of languages) {
      if (i < byLanguage[lang].length) {
        result.push(byLanguage[lang][i]);
      }
    }
  }

  return result;
}

/**
 * POST /api/cron/submit-ocr
 *
 * Submit batch OCR jobs for all books that need OCR.
 * Uses Gemini Batch API for 50% cost savings.
 *
 * Can be called via:
 * - curl https://your-domain.com/api/cron/submit-ocr
 * - Vercel cron: "0 0 * * *" (daily)
 */
export async function POST(request: NextRequest) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    }

    const db = await getDb();

    // Find all pages that need OCR
    const pagesNeedingOcr = await db
      .collection('pages')
      .find({ 'ocr.data': { $in: ['', null] } })
      .project({ _id: 1, book_id: 1, page_number: 1, photo: 1 })
      .toArray();

    if (pagesNeedingOcr.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pages need OCR',
        pagesFound: 0,
      });
    }

    // Get book info for language detection
    const books = await db
      .collection('books')
      .find({})
      .project({ _id: 1, id: 1, language: 1, title: 1 })
      .toArray();

    const bookMap = new Map(
      books.map((b: any) => [
        b._id ? b._id.toString() : b.id,
        {
          id: b.id,
          title: b.title,
          language: b.language || 'Latin',
        },
      ])
    );

    // Group pages by book
    const pagesByBook = new Map<string, any[]>();
    for (const page of pagesNeedingOcr) {
      const bookId = page.book_id ? page.book_id.toString() : String(page.book_id);
      if (!pagesByBook.has(bookId)) {
        pagesByBook.set(bookId, []);
      }
      pagesByBook.get(bookId)!.push(page);
    }

    // Get books that need OCR in diverse order
    const booksNeedingOcr = Array.from(pagesByBook.keys())
      .map(bookId => ({ ...bookMap.get(bookId), _id: bookId }))
      .filter(b => b.id); // Only include books with valid IDs

    const diverseBooks = diversifyBooks(booksNeedingOcr);

    // Create batch jobs in diverse order
    const batchJobs = [];
    let batchCount = 0;
    let currentBatchContent = '';
    let currentBatchPages = 0;

    for (const book of diverseBooks) {
      const bookId = book._id;
      const pages = pagesByBook.get(bookId) || [];
      const bookInfo = bookMap.get(bookId);
      const language = bookInfo?.language || 'Latin';

      for (const page of pages) {
        try {
          // Fetch and resize image
          const imageRes = await fetch(page.photo);
          if (!imageRes.ok) continue;

          const imageBuffer = await imageRes.arrayBuffer();
          const resizedBuffer = await resizeImage(Buffer.from(imageBuffer));
          const base64Image = Buffer.from(resizedBuffer).toString('base64');

          // Add to JSONL batch
          const request = {
            custom_id: page._id.toString(),
            request: {
              model: MODEL,
              system_instruction: {
                parts: [
                  {
                    text: 'You are a manuscript OCR expert. Transcribe the page accurately.',
                  },
                ],
              },
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: OCR_PROMPT.replace('{language}', language),
                    },
                    {
                      inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64Image,
                      },
                    },
                  ],
                },
              ],
            },
          };

          currentBatchContent += JSON.stringify(request) + '\n';
          currentBatchPages++;

          // Submit batch when it reaches BATCH_SIZE
          if (currentBatchPages >= BATCH_SIZE) {
            const fileName = await uploadBatchFile(
              currentBatchContent,
              `ocr-batch-${batchCount + 1}`
            );
            const batchJob = await createBatchJob(
              fileName,
              `OCR Batch ${batchCount + 1}`
            );
            await deleteFile(fileName);

            // Save batch job record
            await db.collection('batch_jobs').insertOne({
              _id: new ObjectId(),
              gemini_job_name: batchJob.name,
              type: 'ocr',
              status: 'processing',
              gemini_state: batchJob.metadata?.state || 'PROCESSING',
              total_pages: currentBatchPages,
              completed_pages: 0,
              failed_pages: 0,
              created_at: new Date(),
              updated_at: new Date(),
            });

            batchJobs.push({
              batchNumber: batchCount + 1,
              pages: currentBatchPages,
              jobName: batchJob.name,
            });

            batchCount++;
            currentBatchContent = '';
            currentBatchPages = 0;
          }
        } catch (e) {
          console.error(`Error processing page ${page._id}:`, e);
        }
      }
    }

    // Submit final batch if there are remaining pages
    if (currentBatchPages > 0) {
      const fileName = await uploadBatchFile(
        currentBatchContent,
        `ocr-batch-${batchCount + 1}`
      );
      const batchJob = await createBatchJob(fileName, `OCR Batch ${batchCount + 1}`);
      await deleteFile(fileName);

      await db.collection('batch_jobs').insertOne({
        _id: new ObjectId(),
        gemini_job_name: batchJob.name,
        type: 'ocr',
        status: 'processing',
        gemini_state: batchJob.metadata?.state || 'PROCESSING',
        total_pages: currentBatchPages,
        completed_pages: 0,
        failed_pages: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      batchJobs.push({
        batchNumber: batchCount + 1,
        pages: currentBatchPages,
        jobName: batchJob.name,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Submitted ${batchJobs.length} batch jobs`,
      pagesNeedingOcr: pagesNeedingOcr.length,
      batchJobs: batchJobs,
      estimatedCost: `$${(pagesNeedingOcr.length * 2.5 / 1000).toFixed(2)}`,
      nextStep: 'Set up cron job to monitor results every 6 hours',
    });
  } catch (error) {
    console.error('Batch OCR submission error:', error);
    return NextResponse.json(
      { error: 'Batch OCR submission failed', details: String(error) },
      { status: 500 }
    );
  }
}
