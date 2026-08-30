/**
 * test-bundle.ts — generate a KDP bundle to disk for one book (no dashboard/login).
 *
 * Produces the SAME artifacts as the /api/admin/kdp/bundle/[id] route
 * (reflowable EPUB + 1600x2560 portrait cover + metadata), writing them to a
 * local folder so you can run book.epub through Kindle Previewer and inspect
 * the cover before uploading to KDP.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/kdp/test-bundle.ts <bookId|slug> [--out <dir>]
 *
 * Example:
 *   npx tsx scripts/kdp/test-bundle.ts easy-and-charitable-chemistry-for-ladies-meurdrac
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb } from '@/lib/mongodb';
import { generateKdpCover, pickKdpCoverImageUrl } from '@/lib/kdp-cover';
import { generateKdpEpub } from '@/lib/kdp-epub';
import { generateKdpMetadata } from '@/lib/kdp-scoring';
import type { Book, Page } from '@/lib/types';

function parseArgs(argv: string[]): { key: string; out: string } {
  const args = argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : join(process.cwd(), 'kdp-out');
  const key = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
  if (!key) {
    console.error('Usage: npx tsx scripts/kdp/test-bundle.ts <bookId|slug> [--out <dir>]');
    process.exit(1);
  }
  return { key, out: resolve(out) };
}

async function main() {
  const { key, out } = parseArgs(process.argv);
  const db = await getDb();

  const book = (await db.collection('books').findOne({
    $or: [{ id: key }, { slug: key }],
  })) as unknown as (Book & { thumbnail_blob?: string; thumbnail?: string }) | null;

  if (!book) {
    console.error(`No book found with id or slug "${key}"`);
    process.exit(1);
  }

  const pages = (await db.collection('pages')
    .find(
      { book_id: book.id },
      {
        projection: {
          id: 1, page_number: 1, book_id: 1,
          page_type: 1, photo: 1, cropped_photo: 1, archived_photo: 1,
          'translation.data': 1, 'translation.model': 1,
          'ocr.data': 1, 'ocr.model': 1,
        },
      }
    )
    .sort({ page_number: 1 })
    .toArray()) as unknown as Page[];

  const slug = book.slug || book.id;
  const translated = pages.filter(p => p.translation?.data).length;
  console.log(`Book: "${book.display_title || book.title}" by ${book.author}`);
  console.log(`  ${pages.length} pages, ${translated} translated, ${book.chapters?.length ?? 0} chapters`);

  const meta = generateKdpMetadata(book as Parameters<typeof generateKdpMetadata>[0]);

  // Lead with the book's best illustration when it has one; fall back to the
  // binding/first-page thumbnail otherwise.
  const coverImageUrl =
    (await pickKdpCoverImageUrl(db, book.id, pages)) ||
    book.thumbnail_blob ||
    book.thumbnail;
  console.log(`Generating cover… (source: ${coverImageUrl ? coverImageUrl.slice(0, 70) : 'solid fallback'})`);
  const coverBuffer = await generateKdpCover(
    {
      title: book.title,
      display_title: book.display_title,
      author: book.author,
      language: book.language,
    },
    coverImageUrl
  );

  console.log('Generating EPUB (fetching facsimile/illustration images)…');
  const epubBuffer = await generateKdpEpub(book as Book, pages, db, {
    aiDisclosure: meta.ai_disclosure,
    coverImage: coverBuffer,
  });

  const metadataTxt = [
    'KDP METADATA — COPY-PASTE INTO AMAZON KDP',
    '='.repeat(50),
    '',
    `Title: ${meta.title || ''}`,
    `Subtitle: ${meta.subtitle || ''}`,
    `Author: ${meta.author || ''}`,
    '',
    'Description:',
    meta.description || '',
    '',
    'Keywords:',
    ...(meta.keywords || []).map((k: string, i: number) => `  ${i + 1}. ${k}`),
    '',
    `BISAC Categories: ${(meta.categories || []).join(', ')}`,
    '',
    `AI Disclosure: ${meta.ai_disclosure || ''}`,
    '',
    `Price: ${meta.price || '$2.99'}`,
    '',
    '='.repeat(50),
    `Generated: ${new Date().toISOString()}`,
  ].join('\n');

  mkdirSync(out, { recursive: true });
  const epubPath = join(out, `${slug}.epub`);
  const coverPath = join(out, 'cover.jpg');
  writeFileSync(epubPath, epubBuffer);
  writeFileSync(coverPath, coverBuffer);
  writeFileSync(join(out, 'metadata.json'), JSON.stringify({ ...meta, book_id: book.id, slug, generated_at: new Date().toISOString() }, null, 2));
  writeFileSync(join(out, 'metadata.txt'), metadataTxt);

  console.log('\nWrote KDP bundle to:');
  console.log(`  ${epubPath} (${(epubBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  ${coverPath} (${(coverBuffer.length / 1024).toFixed(0)} KB)`);
  console.log(`  ${join(out, 'metadata.json')}`);
  console.log(`  ${join(out, 'metadata.txt')}`);
  console.log('\nNext: open the EPUB in Kindle Previewer, then upload EPUB + cover at kdp.amazon.com.');

  process.exit(0);
}

main().catch(err => {
  console.error('Bundle generation failed:', err);
  process.exit(1);
});
