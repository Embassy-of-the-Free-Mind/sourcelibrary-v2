#!/usr/bin/env node
/**
 * Refuse a NEW file that reads `translation.data` directly (#5942 roadmap step 2).
 *
 * PRIOR ART: scripts/audit/raw-book-inserts.mjs — the same baseline-ratchet lint (a list of
 * today's sites that may only shrink); this one watches the raw-translation field instead of
 * book inserts. The consumer census it ratchets is in
 * scripts/eval/experiments/2026-10-06-notes-layer-phase1-2-5942.md (342 files on 2026-10-06,
 * eval scripts included).
 *
 * WHY. A page's translation is one string with the model's notes inside it, and every surface
 * that reads `translation.data` re-parses it — each forgotten case shows the machine's words as
 * the author's (#3811, #3870, #3825, #5621, #5895, #4385). `translation.text` now holds the book's
 * words, read through ONE accessor that checks it against the data it was parsed from:
 *   src/lib/translation-text.ts      getTranslationText(page)
 *   scripts/lib/translation-text.mjs getTranslationText(page)
 * Rewriting today's readers is one surface per PR, later. What this lint stops is the NEXT one:
 * a new reader is usually written by copying an old one, and inherits the raw read.
 *
 * WHAT COUNTS: any `.ts/.tsx/.js/.mjs/.mts/.cjs` file under src/ or scripts/ that names
 * `translation.data` (property access, optional chaining, or a Mongo path string). Over-matching
 * is the safe direction: a query filter on the field counts too. Not scanned: tests/, the two
 * accessor files, `_archived/`, and scripts/eval/ — eval scripts study the model's raw output on
 * purpose and would stay on `data` after every surface moves (the census's "unchanged" row).
 *
 * A file that must keep reading the raw output (an editor, a writer, a gate on the model's markup)
 * is added to the baseline by hand with a reason; everything else uses the accessor.
 *
 * USAGE
 *   node scripts/audit/translation-data-readers.mjs                  # exit 1 on a new reader
 *   node scripts/audit/translation-data-readers.mjs --list           # every file, in baseline or not
 *   node scripts/audit/translation-data-readers.mjs --write-baseline # record today's set (shrinks it)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE = 'scripts/lib/translation-data-readers-baseline.json';
const SCAN = ['src', 'scripts'];
const SKIP_DIR = new Set(['node_modules', '_archived', 'worktrees', '.next', 'output']);
const SKIP_PATH = [/^scripts\/eval\//];
const ACCESSORS = new Set(['src/lib/translation-text.ts', 'scripts/lib/translation-text.mjs', 'scripts/audit/translation-data-readers.mjs']);
const READ = /\btranslation\??\.data\b|['"`]translation\.data['"`]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|cjs|mts|ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

export function scan(root = ROOT) {
  const files = [];
  for (const base of SCAN) {
    if (!existsSync(join(root, base))) continue;
    for (const f of walk(join(root, base))) {
      const rel = relative(root, f).split('\\').join('/');
      if (ACCESSORS.has(rel) || SKIP_PATH.some((r) => r.test(rel))) continue;
      if (READ.test(readFileSync(f, 'utf8'))) files.push(rel);
    }
  }
  return files.sort();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const found = scan();
  const baseline = existsSync(join(ROOT, BASELINE)) ? JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) : { files: [] };
  const known = new Set(baseline.files);

  if (args.includes('--list')) {
    for (const f of found) console.log(`${known.has(f) ? '  ' : '+ '}${f}`);
    console.log(`\n${found.length} files read translation.data (baseline ${baseline.files.length}).`);
    process.exit(0);
  }
  if (args.includes('--write-baseline')) {
    const added = found.filter((f) => !known.has(f));
    if (added.length && !args.includes('--allow-new')) {
      console.error(`Refusing to grow the baseline by ${added.length} file(s):\n  ${added.join('\n  ')}\nUse getTranslationText() instead, or pass --allow-new with a reason in the PR (an editor, writer or markup gate).`);
      process.exit(1);
    }
    const out = { _comment: 'Files that read pages.translation.data directly (#5942). A list to SHRINK: new readers use getTranslationText() (src/lib/translation-text.ts, scripts/lib/translation-text.mjs). Regenerate with node scripts/audit/translation-data-readers.mjs --write-baseline.', count: found.length, files: found };
    writeFileSync(join(ROOT, BASELINE), JSON.stringify(out, null, 2) + '\n');
    console.log(`Wrote ${BASELINE}: ${found.length} files (was ${baseline.files.length}).`);
    process.exit(0);
  }

  const added = found.filter((f) => !known.has(f));
  const gone = baseline.files.filter((f) => !found.includes(f));
  if (gone.length) console.log(`${gone.length} baseline file(s) no longer read translation.data — shrink the baseline with --write-baseline:\n  ${gone.join('\n  ')}`);
  if (added.length) {
    console.error(`\n✗ ${added.length} new file(s) read translation.data directly (#5942):\n  ${added.join('\n  ')}\n\n` +
      'Read the book\'s words through getTranslationText(page) — src/lib/translation-text.ts or scripts/lib/translation-text.mjs —\n' +
      'which serves translation.text only when it was parsed from the current translation.data.\n' +
      'A file that must read the raw model output (an editor, a writer, a gate on the markup) goes in the baseline\n' +
      `by hand: node scripts/audit/translation-data-readers.mjs --write-baseline --allow-new, with the reason in the PR.`);
    process.exit(1);
  }
  console.log(`✓ translation.data readers: ${found.length} (baseline ${baseline.files.length}); no new reader.`);
}
