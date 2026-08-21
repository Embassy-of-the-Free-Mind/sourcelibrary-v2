#!/usr/bin/env node
/**
 * Generate src/generated/blog-revisions.json — per-post publication and
 * last-revision dates derived from git history.
 *
 * Consumed by src/components/blog/NoteFooter.tsx ("Last revised … · Revision
 * history"). Revision reframed as a feature: the notes are living research
 * reports, and their history is public on GitHub.
 *
 * Run from a git checkout (Vercel's upload has no .git — the committed JSON is
 * the fallback there). scripts/deploy-prod.sh regenerates it before every prod
 * deploy so the dates ship fresh; commit the refreshed file when convenient.
 *
 *   node scripts/maintenance/generate-blog-revisions.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG = path.join(ROOT, 'src/app/blog');
const OUT = path.join(ROOT, 'src/generated/blog-revisions.json');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'page.tsx') files.push(p);
  }
})(BLOG);

const out = {};
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const slug = path.relative(BLOG, path.dirname(file));
  if (!slug) continue; // the /blog index page is not a note
  // Follow renames so a moved post keeps its original publication date.
  const dates = git('log', '--follow', '--format=%cI', '--', rel).split('\n').filter(Boolean);
  if (dates.length === 0) continue; // not yet committed
  out[slug] = {
    path: rel,
    published: dates[dates.length - 1],
    revised: dates[0],
    revisions: dates.length,
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${Object.keys(out).length} entries to ${path.relative(ROOT, OUT)}`);
