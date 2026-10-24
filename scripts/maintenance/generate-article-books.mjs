#!/usr/bin/env node
/**
 * Generate src/generated/article-books.json: for each article under
 * src/app/articles/<slug>/, the books it links to (/book/<id-or-slug>), in the
 * order they first appear. Read by /api/articles/books, which turns them into
 * the "Books in this article" card grid at the end of each article.
 *
 *   node scripts/maintenance/generate-article-books.mjs
 *
 * Re-run after adding or editing an article (tests/blog-posts.test.ts fails if
 * the file is out of date).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const ARTICLES = path.join(ROOT, 'src', 'app', 'articles');
const OUT = path.join(ROOT, 'src', 'generated', 'article-books.json');

// /book/<ref> where ref is a hex id, a uuid or a slug; stops at /, ?, #, quotes.
const BOOK_LINK = /\/book\/([A-Za-z0-9][A-Za-z0-9_-]*)/g;
// book="<ref>" or book={NAME}
const BOOK_PROP = /\bbook=(?:"([A-Za-z0-9][A-Za-z0-9_-]*)"|\{\s*([A-Z_][A-Z0-9_]*)\s*\})/g;

function constValue(sources, name) {
  const re = new RegExp(`const\\s+${name}\\s*(?::\\s*string)?\\s*=\\s*(['"\`])([^'"\`]+)\\1`);
  for (const s of sources) {
    const m = s.match(re);
    if (m) return m[2];
  }
  return null;
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return filesUnder(p);
    return /\.(tsx?|json|md)$/.test(d.name) ? [p] : [];
  });
}

export function buildArticleBooks() {
  const out = {};
  for (const d of fs.readdirSync(ARTICLES, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[') || d.name === 'page') continue;
    const seen = new Set();
    const sources = filesUnder(path.join(ARTICLES, d.name)).sort().map((f) => fs.readFileSync(f, 'utf8'));
    for (const src of sources) {
      // Links (/book/<ref>), and components that take the book as a prop
      // (book="<id>" or book={NAME} with NAME a string constant).
      const hits = [
        ...[...src.matchAll(BOOK_LINK)].map((m) => ({ at: m.index, ref: m[1] })),
        ...[...src.matchAll(BOOK_PROP)].map((m) => ({ at: m.index, ref: m[1] || constValue(sources, m[2]) })),
      ].sort((a, b) => a.at - b.at);
      for (const h of hits) if (h.ref && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(h.ref)) seen.add(h.ref);
    }
    if (seen.size) out[d.name] = [...seen];
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.writeFileSync(OUT, `${JSON.stringify(buildArticleBooks(), null, 2)}\n`);
  const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const total = Object.values(data).reduce((n, refs) => n + refs.length, 0);
  console.log(`wrote ${OUT}: ${Object.keys(data).length} articles, ${total} book links`);
}
