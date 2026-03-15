import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { generateKdpCover } from '@/lib/kdp-cover';
import { generateKdpEpub } from '@/lib/kdp-epub';
import type { Book, Page } from '@/lib/types';
import archiver from 'archiver';

export const maxDuration = 120;

/**
 * GET /api/admin/kdp/bundle/[id] — Generate and download KDP bundle ZIP
 *
 * Bundle contains:
 * - {slug}.epub — Reflowable Kindle EPUB
 * - cover.jpg — 2560x1600 KDP cover image
 * - metadata.json — Machine-readable KDP metadata
 * - metadata.txt — Human-readable copy-paste version
 */
export const GET = withAdminAuth(async (request: NextRequest, session, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const db = await getDb();
    const { id } = await params;

    const publication = await db.collection('kdp_publications').findOne({ id });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const book = await db.collection('books').findOne({ id: publication.book_id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Fetch all pages with translations
    const pages = await db.collection('pages')
      .find(
        { book_id: publication.book_id },
        {
          projection: {
            id: 1, page_number: 1, book_id: 1,
            'translation.data': 1, 'translation.model': 1,
            'ocr.data': 1, 'ocr.model': 1,
          },
        }
      )
      .sort({ page_number: 1 })
      .toArray() as unknown as Page[];

    const bookRecord = book as unknown as Book;
    const slug = bookRecord.slug || bookRecord.id;
    const meta = publication.kdp_metadata;

    // Generate EPUB and cover in parallel
    const [epubBuffer, coverBuffer] = await Promise.all([
      generateKdpEpub(bookRecord, pages, {
        aiDisclosure: meta?.ai_disclosure,
      }),
      generateKdpCover(
        {
          title: bookRecord.title,
          display_title: bookRecord.display_title,
          author: bookRecord.author,
          language: bookRecord.language,
        },
        publication.cover_image_url || bookRecord.thumbnail_blob || bookRecord.thumbnail
      ),
    ]);

    // Build metadata.json
    const metadataJson = JSON.stringify({
      ...meta,
      book_id: bookRecord.id,
      slug,
      generated_at: new Date().toISOString(),
    }, null, 2);

    // Build metadata.txt — human-readable copy-paste version
    const metadataTxt = [
      'KDP METADATA — COPY-PASTE INTO AMAZON KDP',
      '='.repeat(50),
      '',
      `Title: ${meta?.title || ''}`,
      `Subtitle: ${meta?.subtitle || ''}`,
      `Author: ${meta?.author || ''}`,
      '',
      'Description:',
      meta?.description || '',
      '',
      'Keywords:',
      ...(meta?.keywords || []).map((k: string, i: number) => `  ${i + 1}. ${k}`),
      '',
      `BISAC Categories: ${(meta?.categories || []).join(', ')}`,
      '',
      `AI Disclosure: ${meta?.ai_disclosure || ''}`,
      '',
      `Price: ${meta?.price || '$2.99'}`,
      '',
      '='.repeat(50),
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');

    // Package into ZIP
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 6 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      const prefix = `${slug}-kdp-bundle`;
      archive.append(epubBuffer, { name: `${prefix}/${slug}.epub` });
      archive.append(coverBuffer, { name: `${prefix}/cover.jpg` });
      archive.append(metadataJson, { name: `${prefix}/metadata.json` });
      archive.append(metadataTxt, { name: `${prefix}/metadata.txt` });

      archive.finalize();
    });

    // Mark bundle generation timestamp
    await db.collection('kdp_publications').updateOne(
      { id },
      { $set: { bundle_generated_at: new Date(), updated_at: new Date() } }
    );

    const safeTitle = (bookRecord.display_title || bookRecord.title)
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeTitle}-kdp-bundle.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('KDP bundle generation error:', error);
    return NextResponse.json({ error: 'Failed to generate bundle' }, { status: 500 });
  }
});
