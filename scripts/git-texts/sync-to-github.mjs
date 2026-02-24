#!/usr/bin/env node
/**
 * Sync book texts from MongoDB to the source-library-texts GitHub repo.
 *
 * Each book gets: metadata.json, ocr.txt, translation.txt
 * Each sync creates a git commit with model/prompt info.
 * Git naturally versions everything — re-processing a book updates the files.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/git-texts/sync-to-github.mjs [options]
 *
 * Options:
 *   --limit=N       Process at most N books (default: all)
 *   --book-id=ID    Process a specific book
 *   --dry-run       Show what would be synced without writing
 *   --batch-size=N  Books per git commit (default: 50)
 *   --changed-only  Only sync books whose content hash differs from last sync
 *   --min-ocr=N     Minimum OCR pages to include (default: 10)
 */

import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const REPO_DIR = join(process.env.HOME, 'source-library-texts');
const BOOKS_DIR = join(REPO_DIR, 'books');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : undefined;
const BOOK_ID = getArg('book-id');
const DRY_RUN = hasFlag('dry-run');
const BATCH_SIZE = getArg('batch-size') ? parseInt(getArg('batch-size')) : 50;
const CHANGED_ONLY = hasFlag('changed-only');
const MIN_OCR = getArg('min-ocr') ? parseInt(getArg('min-ocr')) : 10;

function git(cmd, opts = {}) {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_DIR, encoding: 'utf8', ...opts }).trim();
  } catch (e) {
    if (opts.ignoreError) return '';
    throw e;
  }
}

function contentHash(text) {
  return createHash('sha256').update(text || '').digest('hex').slice(0, 16);
}

function slugify(text) {
  return (text || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function formatPageText(pages, field) {
  const lines = [];
  for (const page of pages) {
    const text = field === 'ocr' ? page.ocr?.data : page.translation?.data;
    if (text) {
      lines.push(`--- Page ${page.page_number} ---`);
      lines.push(text);
      lines.push('');
    }
  }
  return lines.join('\n');
}

async function main() {
  // Verify repo exists
  if (!existsSync(join(REPO_DIR, '.git'))) {
    console.error(`Repo not found at ${REPO_DIR}. Clone it first:`);
    console.error(`  cd ~ && gh repo clone JDerekLomas/source-library-texts`);
    process.exit(1);
  }

  // Pull latest
  if (!DRY_RUN) {
    try { git('pull --rebase origin main 2>/dev/null', { ignoreError: true }); } catch {}
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Repo: ${REPO_DIR}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Build book query
  const bookQuery = {};
  if (BOOK_ID) {
    bookQuery.id = BOOK_ID;
  }

  // Get books with at least some OCR
  const books = await db.collection('books')
    .find(bookQuery)
    .project({
      id: 1, title: 1, display_title: 1, author: 1, language: 1,
      published: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
      license: 1, image_source: 1, reading_summary: 1, doi: 1,
      ia_identifier: 1, gallica_ark: 1, bsb_id: 1,
      'pipeline_auto.status': 1,
      _content_hash_ocr: 1, _content_hash_translation: 1,
    })
    .sort({ pages_ocr: -1 }) // Most content first
    .toArray();

  // Filter to books with meaningful OCR
  const eligible = books.filter(b => (b.pages_ocr || 0) >= MIN_OCR);
  const toProcess = LIMIT ? eligible.slice(0, LIMIT) : eligible;

  console.log(`Found ${books.length} total books, ${eligible.length} with >= ${MIN_OCR} OCR pages`);
  console.log(`Processing: ${toProcess.length} books`);
  console.log('');

  let totalSynced = 0;
  let totalSkipped = 0;
  let batchBooks = [];

  for (let i = 0; i < toProcess.length; i++) {
    const book = toProcess[i];
    const bookId = book.id;
    const bookDir = join(BOOKS_DIR, bookId);

    // Fetch all pages for this book
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .project({
        page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1,
        'translation.data': 1, 'translation.model': 1,
        page_type: 1, columns: 1,
      })
      .sort({ page_number: 1 })
      .toArray();

    // Build text content
    const ocrText = formatPageText(pages, 'ocr');
    const translationText = formatPageText(pages, 'translation');

    if (!ocrText && !translationText) {
      totalSkipped++;
      continue;
    }

    // Check if content changed (via hash)
    const ocrHash = contentHash(ocrText);
    const translationHash = contentHash(translationText);

    if (CHANGED_ONLY) {
      const existingMeta = join(bookDir, 'metadata.json');
      if (existsSync(existingMeta)) {
        try {
          const meta = JSON.parse(readFileSync(existingMeta, 'utf8'));
          if (meta._hashes?.ocr === ocrHash && meta._hashes?.translation === translationHash) {
            totalSkipped++;
            continue;
          }
        } catch {}
      }
    }

    // Count pages with content
    const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
    const pagesWithTranslation = pages.filter(p => p.translation?.data).length;

    // Determine dominant OCR model
    const modelCounts = {};
    for (const p of pages) {
      if (p.ocr?.model) {
        modelCounts[p.ocr.model] = (modelCounts[p.ocr.model] || 0) + 1;
      }
    }
    const dominantModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    // Build metadata
    const metadata = {
      id: bookId,
      title: book.title,
      display_title: book.display_title || book.title,
      author: book.author,
      language: book.language || 'Unknown',
      year: book.year || null,
      published: book.published || null,
      pages_count: book.pages_count || pages.length,
      pages_with_ocr: pagesWithOcr,
      pages_with_translation: pagesWithTranslation,
      source_url: `https://sourcelibrary.org/book/${bookId}`,
      license: book.license || book.image_source?.license || null,
      doi: book.doi || null,
      external_ids: {
        ...(book.ia_identifier && { internet_archive: book.ia_identifier }),
        ...(book.gallica_ark && { gallica: book.gallica_ark }),
        ...(book.bsb_id && { mdz: book.bsb_id }),
      },
      processing: {
        ocr_model: dominantModel,
        prompt_version: pages.find(p => p.ocr?.prompt_version)?.ocr?.prompt_version || null,
        translation_model: pages.find(p => p.translation?.model)?.translation?.model || null,
      },
      synced_at: new Date().toISOString(),
      _hashes: { ocr: ocrHash, translation: translationHash },
    };

    if (DRY_RUN) {
      const title = (book.display_title || book.title || '').slice(0, 50);
      console.log(`  [DRY] ${title} — ${pagesWithOcr} OCR, ${pagesWithTranslation} translation`);
      totalSynced++;
      continue;
    }

    // Write files
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(join(bookDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    if (ocrText) writeFileSync(join(bookDir, 'ocr.txt'), ocrText);
    if (translationText) writeFileSync(join(bookDir, 'translation.txt'), translationText);

    batchBooks.push(book);
    totalSynced++;

    // Commit in batches
    if (batchBooks.length >= BATCH_SIZE || i === toProcess.length - 1) {
      if (batchBooks.length > 0) {
        git('add books/');

        // Check if there are staged changes
        const status = git('diff --cached --stat', { ignoreError: true });
        if (status) {
          const titles = batchBooks
            .map(b => (b.display_title || b.title || 'Untitled').slice(0, 40))
            .slice(0, 5)
            .join(', ');
          const suffix = batchBooks.length > 5 ? ` +${batchBooks.length - 5} more` : '';
          const msg = batchBooks.length === 1
            ? `sync: ${titles} (${batchBooks[0].language || '?'}, ${pages.length} pages)`
            : `sync: ${batchBooks.length} books — ${titles}${suffix}`;

          git(`commit -m "${msg.replace(/"/g, '\\"')}"`);
          console.log(`  Committed ${batchBooks.length} books: ${titles}${suffix}`);
        }
        batchBooks = [];
      }
    }

    if ((totalSynced % 25) === 0) {
      process.stdout.write(`  ${totalSynced}/${toProcess.length} synced...\r`);
    }
  }

  // Push if we made changes
  if (!DRY_RUN && totalSynced > 0) {
    console.log('\nPushing to GitHub...');
    try {
      git('push origin main 2>&1');
      console.log('Pushed successfully.');
    } catch (e) {
      // If main doesn't exist yet (first push), try setting upstream
      try {
        git('push -u origin main 2>&1');
        console.log('Pushed successfully (first push).');
      } catch (e2) {
        console.error('Push failed:', e2.message);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Synced: ${totalSynced}`);
  console.log(`Skipped: ${totalSkipped}`);

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
