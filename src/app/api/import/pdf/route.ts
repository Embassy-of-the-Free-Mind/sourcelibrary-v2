import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { storagePut } from '@/lib/storage';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';

export const maxDuration = 300;

/**
 * Import a book from a PDF URL
 *
 * Downloads the PDF, extracts page images with pdftoppm, uploads to Vercel Blob,
 * creates book + page records. Works with any publicly accessible PDF.
 *
 * Provenance chain preserved at every level:
 *   Source catalog → PDF URL → extraction method → Blob URL
 *   All stored on book.image_source + page.archive_metadata
 *
 * POST /api/import/pdf
 * Body: {
 *   pdf_url: string,             // Direct URL to the PDF file
 *   title: string,               // Required
 *   author?: string,             // Default: "Unknown"
 *   display_title?: string,      // Optional English title
 *   language?: string,           // Default: "Unknown" (AI detects later)
 *   published?: string,          // Default: "Unknown"
 *   categories?: string[],
 *   provider: string,            // e.g., "cmc_kloss", "user_upload"
 *   provider_name: string,       // e.g., "CMC Prins Frederik — Bibliotheca Klossiana"
 *   source_url?: string,         // Catalog/collection page URL
 *   identifier?: string,         // External ID (e.g., CMC priref, shelf mark)
 *   dpi?: number,                // Extraction DPI (default: 150)
 *   dublin_core?: object,        // Additional Dublin Core metadata
 *   catalog_metadata?: object,   // Full original catalog record for provenance
 * }
 */
export const POST = withAuth(async (request) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sl-pdf-'));

  try {
    const body = await request.json();
    const {
      pdf_url,
      title,
      author = 'Unknown',
      display_title,
      language = 'Unknown',
      published = 'Unknown',
      categories = [],
      provider,
      provider_name,
      source_url,
      identifier,
      dpi = 150,
      dublin_core,
      catalog_metadata,
    } = body;

    if (!pdf_url || !title || !provider || !provider_name) {
      return NextResponse.json(
        { error: 'Missing required fields: pdf_url, title, provider, provider_name' },
        { status: 400 },
      );
    }

    // Validate URL
    let pdfUrlObj: URL;
    try {
      pdfUrlObj = new URL(pdf_url);
      if (!['http:', 'https:'].includes(pdfUrlObj.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid pdf_url — must be a valid HTTP(S) URL' },
        { status: 400 },
      );
    }

    const db = await getDb();

    // Check for duplicates — match on pdf_url or provider+identifier combo
    const dupeQuery: Record<string, unknown>[] = [
      { 'image_source.pdf_url': pdf_url },
    ];
    if (identifier) {
      dupeQuery.push({
        'image_source.provider': provider,
        'image_source.identifier': identifier,
      });
    }
    const existing = await db.collection('books').findOne({ $or: dupeQuery });
    if (existing) {
      return NextResponse.json(
        { error: 'Book already imported from this PDF', existingId: existing.id || existing._id.toString() },
        { status: 409 },
      );
    }

    // Cross-source dedup check
    const dedupResult = await checkDuplicate(db, {
      title, author,
      image_source: { provider, identifier: identifier || undefined, pdf_url, source_url: source_url || pdf_url },
    });
    if (dedupResult.isDuplicate) {
      const best = dedupResult.matches[0];
      return NextResponse.json(
        { error: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`, existingId: best.matchedBookId, matches: dedupResult.matches },
        { status: 409 },
      );
    }

    // 1. Download PDF
    const pdfPath = join(tmpDir, 'book.pdf');
    const pdfRes = await fetch(pdf_url, {
      signal: AbortSignal.timeout(120000), // 2 min timeout for large PDFs
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
    });
    if (!pdfRes.ok) {
      return NextResponse.json(
        { error: `PDF download failed: ${pdfRes.status} ${pdfRes.statusText}` },
        { status: 502 },
      );
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    writeFileSync(pdfPath, pdfBuffer);
    const pdfSizeBytes = pdfBuffer.length;

    // 2. Extract pages with pdftoppm
    const pagesDir = join(tmpDir, 'pages');
    execFileSync('mkdir', ['-p', pagesDir]);

    try {
      execFileSync('pdftoppm', [
        '-jpeg', '-r', String(dpi), '-jpegopt', 'quality=85',
        pdfPath, join(pagesDir, 'page'),
      ], { timeout: 600000 }); // 10 min for large PDFs
    } catch (err) {
      return NextResponse.json(
        { error: `PDF page extraction failed: ${err instanceof Error ? err.message : 'pdftoppm error'}` },
        { status: 500 },
      );
    }

    const pageFiles = readdirSync(pagesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (pageFiles.length === 0) {
      return NextResponse.json(
        { error: 'PDF extraction produced 0 pages — file may be corrupt or password-protected' },
        { status: 400 },
      );
    }

    // 3. Upload page images to Vercel Blob
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const blobUrls: Array<{ photo: string; bytes: number }> = [];
    const CONCURRENCY = 10;

    for (let batch = 0; batch < pageFiles.length; batch += CONCURRENCY) {
      const chunk = pageFiles.slice(batch, batch + CONCURRENCY);
      const results = await Promise.all(chunk.map(async (file, idx) => {
        const pageIdx = batch + idx;
        const imgBuffer = readFileSync(join(pagesDir, file));
        const blobPath = `books/${bookIdStr}/pages/${String(pageIdx).padStart(4, '0')}.jpg`;
        const blob = await storagePut(blobPath, imgBuffer, {
          access: 'public',
          contentType: 'image/jpeg',
        });
        return { pageIdx, photo: blob.url, bytes: imgBuffer.length };
      }));
      for (const r of results) {
        blobUrls[r.pageIdx] = { photo: r.photo, bytes: r.bytes };
      }
    }

    const pageCount = pageFiles.length;
    const totalBlobBytes = blobUrls.reduce((sum, b) => sum + b.bytes, 0);

    // 4. Create book record — full provenance chain
    const slug = await generateUniqueBookSlug(db, title, author, display_title);
    const now = new Date();

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author,
      language,
      published,
      categories,
      thumbnail: blobUrls[0]?.photo || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: dublin_core || {
        dc_identifier: identifier ? [`${provider.toUpperCase()}:${identifier}`] : [],
        dc_source: source_url || pdf_url,
      },
      image_source: {
        provider,
        provider_name,
        source_url: source_url || pdf_url,
        pdf_url,                          // Original PDF URL — always preserved
        identifier: identifier || null,
        license: 'unknown',               // To be determined per collection
        access_date: now,
        extraction: {
          method: 'pdftoppm',
          dpi,
          jpeg_quality: 85,
          pdf_size_bytes: pdfSizeBytes,
          pages_extracted: pageCount,
          total_blob_bytes: totalBlobBytes,
          extracted_at: now,
        },
      },
      // Preserve full original catalog record for provenance
      ...(catalog_metadata ? { catalog_metadata } : {}),
      page_count_source: 'pdf_extraction',
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ image_source: { provider, identifier: identifier || undefined, pdf_url } }),
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: now,
      updated_at: now,
    };

    await db.collection('books').insertOne(bookDoc);

    // 5. Create page records — each page traces back to source PDF
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      const photoUrl = blobUrls[i]?.photo || '';
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: i + 1,
        photo: photoUrl,
        photo_original: pdf_url,    // Source provenance: the PDF this page came from
        archived_photo: photoUrl,   // Already on Blob — no separate archive step needed
        archive_metadata: {
          source_url: pdf_url,
          source_page: i + 1,       // Which PDF page this image was extracted from
          archived_at: now,
          method: 'pdf_extraction',
          dpi,
          bytes: blobUrls[i]?.bytes || 0,
        },
        // Do NOT initialize ocr/translation — causes false completion bug
        created_at: now,
        updated_at: now,
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // 6. Post-import hooks (all non-blocking)
    queuePreviewOcr(bookIdStr, title).catch(() => {});

    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageCount,
      metadata: {
        provider,
        identifier: identifier || pdf_url,
        method: 'pdf_extraction',
        pdf_size_mb: (pdfSizeBytes / 1048576).toFixed(1),
      },
    });

    notifyBookImport(bookIdStr, slug).catch(() => {});

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      slug,
      title,
      pagesCreated: pageCount,
      bookUrl: `/book/${bookIdStr}`,
      pdf_url,
      pdf_size_mb: (pdfSizeBytes / 1048576).toFixed(1),
      blob_size_mb: (totalBlobBytes / 1048576).toFixed(1),
      message: `Imported ${pageCount} pages from PDF. Preview OCR queued.`,
    });
  } catch (error) {
    console.error('PDF Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 },
    );
  } finally {
    // Always clean up temp files
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
