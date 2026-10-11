#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/gemini-usage-perimeter.mjs — the baseline-ratchet shape copied
 * here (green today, red on NEW drift); it checks metering, not which image is read.
 * scripts/audit/tile-stitch-gutters.mjs mirrors getPageSource for one audit but guards
 * nothing. #1727 centralised the resolver in page-image-url.{ts,mjs}; nothing stopped new
 * code from going around it, which is how the bug below shipped again.
 *
 * page-image-pick — no hand-rolled `archived_photo || …` image pick outside the resolver.
 *
 * WHY. On a page split from a spread, `archived_photo` (and on ~18K pages `display_photo`)
 * is still the WHOLE two-page image: 60,585 pages in 614 books, counted 2026-10-11. A
 * reader that picks it first sends both pages, and a model transcribes them onto one.
 * It shipped twice in one week: `cli-ocr.mjs read` (#6420 calibration — 18 of 60 reads
 * held two pages) and three more readers fixed in #6465. The right pick is
 * `getPageSource(page)` (src/lib/page-image-url.ts, scripts/lib/page-image-url.mjs),
 * which checks `cropped_photo` and `split_from_spread` first.
 *
 * WHAT IT FLAGS. A line that chains `archived_photo` or `display_photo` with `||` or `??`
 * — the shape of a hand-rolled precedence list. Not a projection, a query filter, or a
 * write of the field.
 *
 * WAIVER. `// image-pick-ok: <reason>` on the line or the line above — e.g. a display
 * thumbnail where a spread is acceptable, or a script that never touches split books.
 * Findings that predate this guard are carried in the BASELINE (file + line text, so line
 * moves don't trip it). Fixing one and removing its line is the intended workflow.
 *
 * Usage:
 *   node scripts/audit/page-image-pick.mjs                     # report
 *   node scripts/audit/page-image-pick.mjs --ci                # exit 1 on new findings
 *   node scripts/audit/page-image-pick.mjs --update-baseline
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const CI = process.argv.includes('--ci');
const UPDATE = process.argv.includes('--update-baseline');
const SCAN_DIRS = ['src', 'scripts'];
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', '_archived', 'results', 'vendor']);
const BASELINE_PATH = join(ROOT, 'scripts/audit/page-image-pick.baseline.txt');
/** The resolver itself is allowed to spell out the precedence. */
const RESOLVERS = new Set(['src/lib/page-image-url.ts', 'scripts/lib/page-image-url.mjs']);

const FIELD = /\b(archived_photo|display_photo)\b/;
const CHAIN = /\b(?:archived_photo|display_photo)\b\s*(?:\)\s*)?(?:\|\||\?\?)|(?:\|\||\?\?)\s*[\w.?()[\]'"]*\b(?:archived_photo|display_photo)\b/;
const WAIVER = /\/\/\s*image-pick-ok:/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => name.endsWith(e)) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

const norm = (s) => s.trim().replace(/\s+/g, ' ');
const findings = [];
for (const d of SCAN_DIRS) {
  if (!existsSync(join(ROOT, d))) continue;
  for (const abs of walk(join(ROOT, d), [])) {
    const file = relative(ROOT, abs);
    if (RESOLVERS.has(file)) continue;
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!FIELD.test(line) || !CHAIN.test(line)) return;
      if (WAIVER.test(line) || (i > 0 && WAIVER.test(lines[i - 1]))) return;
      findings.push({ file, line: i + 1, key: `${file}\t${norm(line)}` });
    });
  }
}

const header = `# page-image-pick baseline — hand-rolled archived_photo/display_photo picks that predate
# the guard (2026-10-11). Each may send a split page's whole spread. Fix one (use
# getPageSource) and delete its line; do not add lines — waive with // image-pick-ok: <reason>.
`;

if (UPDATE) {
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  writeFileSync(BASELINE_PATH, header + keys.join('\n') + '\n');
  console.log(`baseline written: ${keys.length} lines`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(BASELINE_PATH)
    ? readFileSync(BASELINE_PATH, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    : [],
);
const fresh = findings.filter((f) => !baseline.has(f.key));
const seen = new Set(findings.map((f) => f.key));
const fixed = [...baseline].filter((k) => !seen.has(k));

console.log(`page-image-pick: ${findings.length} hand-rolled picks, ${findings.length - fresh.length} in baseline, ${fresh.length} new`);
for (const f of fresh) console.log(`  NEW ${f.file}:${f.line}  ${f.key.split('\t')[1].slice(0, 140)}`);
if (fixed.length) console.log(`  ${fixed.length} baseline line(s) no longer present — delete them from ${relative(ROOT, BASELINE_PATH)}`);
if (fresh.length) {
  console.log('\nA page split from a spread keeps the WHOLE spread in archived_photo/display_photo.');
  console.log('Use getPageSource(page) from page-image-url, or waive with // image-pick-ok: <reason>.');
  if (CI) process.exit(1);
}
