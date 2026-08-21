#!/usr/bin/env node
/**
 * Standing detector: no new Vercel Blob dependencies.
 *
 * Source Library stores images in Cloudflare R2. Vercel Blob was the previous
 * home; the page images were copied across in Feb 2026 and the source was
 * never deleted, leaving 5,432,915 objects / 2,882.8 GB billed at ~$50/month
 * for a second copy (#3645, Finding 3).
 *
 * That cleanup was blocked for months by references nobody had counted,
 * because the migration repointed the DATABASE and the blog embeds Blob URLs
 * in JSX. A data sweep cannot see a URL that lives in a .tsx file. This check
 * is the thing that keeps the count at zero once it gets there.
 *
 * Three classes are refused:
 *
 *  1. `blob.vercel-storage.com` in application source — PLAIN or
 *     PERCENT-ENCODED. The encoded form (`https%3A%2F%2F…`) hides inside
 *     `/api/crop-image?url=`; a plain-string grep misses every one, and 13 of
 *     the original 29 offending references were of exactly that shape. A
 *     detector that only knows one encoding reports a clean tree that isn't.
 *  2. `import … from '@vercel/blob'` outside this file and the migration
 *     tooling. Direct imports bypass `storagePut()` and its R2 key guards —
 *     `scripts/archive-cover-pages.mjs` did this and wrote straight to Blob.
 *  3. A `@vercel/blob` dependency in package.json, once the migration is
 *     finished. Keeping the package installed is what makes (2) easy to
 *     reintroduce by autocomplete.
 *
 * Usage:  node scripts/audit/no-vercel-blob.mjs [--strict]
 *   Default tolerates the known, deliberate leftovers listed in ALLOW.
 *   --strict also fails on the package.json dependency (use once the Blob
 *   store is actually deleted).
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const STRICT = process.argv.includes('--strict');

/**
 * Deliberate, reviewed exceptions. Each needs a reason — an unexplained entry
 * here is how a guard quietly stops guarding.
 */
const ALLOW = [
  // Retired pages kept for provenance; not served.
  /(^|\/)_archived\//,
  // This detector, and the migration tooling that necessarily names the host.
  /scripts\/audit\/no-vercel-blob\.mjs$/,
  /scripts\/maintenance\/rehost-source-blob-urls-to-r2\.mjs$/,
  /scripts\/maintenance\/migrate-blob-.*\.mjs$/,
  /scripts\/maintenance\/repoint-blob-.*\.mjs$/,
  /scripts\/maintenance\/rehost-blob-.*\.mjs$/,
  /scripts\/maintenance\/verify-blob-residue-in-r2\.mjs$/,
  // The CSP allowlist and the reader's legacy-URL rewrite must keep naming the
  // host while ANY historical URL can still reach a browser. Remove these two
  // entries when the Blob store is deleted.
  /src\/lib\/csp-img-hosts\.ts$/,
  /src\/components\/ui\/ImageWithMagnifier\.tsx$/,
  // storage.ts holds the fallback path itself (which now throws — see below).
  /src\/lib\/storage\.ts$/,
];

const allowed = (file) => ALLOW.some((rx) => rx.test(file));

function grep(pattern, paths) {
  try {
    return execSync(`git grep -n -I -E ${JSON.stringify(pattern)} -- ${paths}`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 on no match
  }
}

const failures = [];

// 1. Hardcoded Blob URLs, both encodings.
const urlHits = [
  ...grep('blob\\.vercel-storage\\.com', 'src public'),
  ...grep('blob%2Evercel-storage%2Ecom', 'src public'),
]
  .filter((line) => !allowed(line.split(':')[0]));
for (const h of urlHits) failures.push(['hardcoded Blob URL', h]);

// 2. Direct @vercel/blob imports.
const importHits = grep("from '@vercel/blob'|require\\('@vercel/blob'\\)", 'src scripts')
  .filter((line) => !allowed(line.split(':')[0]));
for (const h of importHits) failures.push(['direct @vercel/blob import — use storagePut()', h]);

// 3. The dependency itself (strict mode only).
if (STRICT) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.dependencies?.['@vercel/blob'] || pkg.devDependencies?.['@vercel/blob']) {
    failures.push(['@vercel/blob still in package.json', 'package.json']);
  }
}

if (failures.length === 0) {
  console.log('no-vercel-blob: clean' + (STRICT ? ' (strict)' : ''));
  process.exit(0);
}

console.error(`no-vercel-blob: ${failures.length} finding(s)\n`);
for (const [why, where] of failures) console.error(`  [${why}]\n    ${where}`);
console.error('\nImages belong in R2. Use storagePut() (src/lib/storage.ts) for writes and');
console.error('R2_PUBLIC_URL for reads. To rehost existing URLs:');
console.error('  node scripts/maintenance/rehost-source-blob-urls-to-r2.mjs --apply');
console.error('If a reference is genuinely deliberate, add it to ALLOW with a reason.');
process.exit(1);
