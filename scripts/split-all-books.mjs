#!/usr/bin/env node
/**
 * Batch runner for split-book.mjs — splits all BPH books that have
 * collected spread OCR and still need splitting.
 *
 * Process isolation: each book runs as a child process so a crash/OOM
 * doesn't kill the whole batch. Resume-safe: skips split_completed books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/split-all-books.mjs                # all eligible books
 *   node scripts/split-all-books.mjs --dry-run      # preview only
 *   node scripts/split-all-books.mjs --limit=50     # first N books
 *   node scripts/split-all-books.mjs --skip=100     # skip first N
 */
import { MongoClient } from 'mongodb';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { appendFileSync, writeFileSync } from 'fs';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '9999');
const SKIP = parseInt(args.find(a => a.startsWith('--skip='))?.split('=')[1] || '0');
const LOG_FILE = `/tmp/split-all-${new Date().toISOString().slice(0, 10)}.log`;

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find books that:
// 1. Need splitting (needs_splitting: true, not already split_completed)
// 2. Have at least one saved spread OCR batch job
log('Finding eligible books...');

const savedBookIds = await db.collection('batch_jobs').distinct('book_id', {
  submission_method: 'file',
  prompt_version: { $regex: /spread/ },
  status: 'saved',
});

const books = await db.collection('books').find({
  id: { $in: savedBookIds },
  needs_splitting: true,
  split_completed: { $ne: true },
}).project({ id: 1, title: 1, pages_count: 1, slug: 1 })
  .sort({ pages_count: 1 })  // Small books first — fast wins, surface errors early
  .toArray();

const eligible = books.slice(SKIP, SKIP + LIMIT);

log(`Found ${books.length} eligible books (${savedBookIds.length} with spread OCR)`);
log(`Processing ${eligible.length} books (skip=${SKIP}, limit=${LIMIT})`);
if (DRY_RUN) log('DRY RUN — no changes will be made');
log(`Log: ${LOG_FILE}`);
writeFileSync(LOG_FILE, `=== Split batch run ${new Date().toISOString()} ===\n`, { flag: 'a' });

await client.close();

// Build env for child processes — pass through all env vars
const childEnv = { ...process.env };

let ok = 0, fail = 0, skipped = 0;
const failures = [];

for (let i = 0; i < eligible.length; i++) {
  const book = eligible[i];
  const label = `[${i + 1}/${eligible.length}]`;
  const slug = book.slug || book.id;

  if (DRY_RUN) {
    log(`${label} WOULD SPLIT: ${book.title?.slice(0, 50)} (${book.pages_count}pp) → ${slug}`);
    continue;
  }

  log(`${label} ${book.title?.slice(0, 50)} (${book.pages_count}pp)...`);

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      ['scripts/split-book.mjs', slug],
      {
        env: childEnv,
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000,  // 10 min per book
        maxBuffer: 10 * 1024 * 1024,  // 10MB output buffer
      }
    );

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Check if AR gate skipped it
    if (stdout.includes('AR gate') && stdout.includes('Skipping')) {
      log(`${label} SKIP (portrait) ${elapsed}s`);
      skipped++;
    } else {
      // Extract page count from output
      const match = stdout.match(/pages: (\d+) spread → (\d+) split/);
      const newCount = match?.[2] || '?';
      log(`${label} OK → ${newCount} pages ${elapsed}s`);
      ok++;
    }
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const errMsg = (e.stderr || e.message || '').split('\n')[0]?.slice(0, 100);
    log(`${label} FAIL ${elapsed}s: ${errMsg}`);
    fail++;
    failures.push({ slug, title: book.title?.slice(0, 50), error: errMsg });
  }

  // Brief pause between books to avoid hammering R2/Atlas
  if (i < eligible.length - 1) {
    await new Promise(r => setTimeout(r, 1000));
  }
}

// Summary
log('');
log('=== Summary ===');
log(`OK: ${ok} | Skipped (portrait): ${skipped} | Failed: ${fail} | Total: ${eligible.length}`);
if (failures.length > 0) {
  log('');
  log('Failures:');
  for (const f of failures) {
    log(`  ${f.slug}: ${f.error}`);
  }
}
log(`Log: ${LOG_FILE}`);
