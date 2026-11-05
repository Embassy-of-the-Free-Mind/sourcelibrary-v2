#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-image-pick.mjs — same static-check shape; it guards which image a
 * reader picks, not whether a written display image is marked. scripts/audit/r2-key-book-scope.mjs
 * checks a key's book scope, not its content.
 *
 * provenance-writers — a script that writes a page's display image must mark it (#4406).
 *
 * WHY. The mark was "done" three times while new pages went out unmarked, because the writer that
 * mattered never called the shared path. Written rules did not hold: this is the check.
 *
 * WHAT IT FLAGS. A file that writes to storage AND names a display-shaped key
 * (`pages/<book>/NNNN.jpg`, or `paths.display` / `keys.display`) AND calls none of the shared
 * marking functions from scripts/workers/lib/display-image.mjs. A master belongs under
 * `archived/<book>/<n>.jpg`, which this check does not look at, and is never marked.
 *
 * THIS IS FILE-LEVEL. It catches a writer that forgot; it cannot prove every branch of a marked
 * file marks. scripts/audit/image-provenance-coverage.mjs reads the objects actually written, weekly.
 *
 * WAIVER. `provenance-ok: <reason>` anywhere in the file, for a file whose display-shaped write
 * is not a display image.
 *
 * Usage: node scripts/audit/provenance-writers.mjs   (exit 1 on findings; run by
 * tests/unit/provenance-writers.test.ts in CI)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WRITES = /PutObjectCommand|storagePut\(|uploadToR2\(|uploadFn\(|\bput\(|\bupload\(|r2Put\(/;
const DISPLAY_KEY = /[`'"]pages\/\$\{[^}]+\}\/(?![^`'"]*(?:-thumb|-full|thumb))[^`'"]*\.(?:jpe?g|png|\$\{)|[`'"]pages\/\$\{[^}]+\}\/(?:sp|lf|oe-|plate-)|\b(?:paths|keys)\.display\b|\$\{base\}\.jpg/;
const MARKS = /\b(?:markDisplay|generateDisplayVariants|uploadPageVariants|markImage)\(/;
const WAIVER = /provenance-ok:\s*\S/;
const EXCLUDE = /^scripts\/(?:_archived|eval|audit|analysis)\/|\.test\./;

/** Files that write a display-shaped key without marking. */
export function findUnmarkedWriters(cwd = process.cwd()) {
  const files = execFileSync('git', ['ls-files', 'scripts', 'src'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter((f) => /\.(?:mjs|js|ts|tsx)$/.test(f) && !EXCLUDE.test(f));
  const out = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(`${cwd}/${f}`, 'utf8'); } catch { continue; }
    if (!WRITES.test(src) || !DISPLAY_KEY.test(src)) continue;
    if (MARKS.test(src) || WAIVER.test(src)) continue;
    out.push(f);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const bad = findUnmarkedWriters();
  for (const f of bad) console.log(`UNMARKED DISPLAY WRITER  ${f}`);
  console.log(`${bad.length} file(s) write a display-shaped key without the shared marking path.`);
  process.exit(bad.length ? 1 : 0);
}
