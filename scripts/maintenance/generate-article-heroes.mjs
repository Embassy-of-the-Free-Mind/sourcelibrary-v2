#!/usr/bin/env node
/**
 * Generate src/generated/article-heroes.json: each article's hero image (the
 * `image` of its <ContentHeader>), which withArticleMeta uses as the share
 * image, so the picture at the top of the page is the one shown in a link
 * preview.
 *
 *   node scripts/maintenance/generate-article-heroes.mjs
 *
 * Re-run after adding an article or changing a hero (tests/blog-posts.test.ts
 * fails if the file is out of date). Handles image="..." and image={NAME}
 * where NAME is a string constant in the article's folder.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const ARTICLES = path.join(ROOT, 'src', 'app', 'articles');
const OUT = path.join(ROOT, 'src', 'generated', 'article-heroes.json');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return filesUnder(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

// The opening <ContentHeader ...> tag, braces balanced.
function headerTag(src) {
  const i = src.indexOf('<ContentHeader');
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(i, j);
  }
  return null;
}

function constValue(sources, name) {
  const re = new RegExp(`(?:const|let)\\s+${name}\\s*(?::\\s*string)?\\s*=\\s*(['"\`])([^'"\`]+)\\1`);
  for (const s of sources) {
    const m = s.match(re);
    if (m) return m[2];
  }
  return null;
}

export function buildArticleHeroes() {
  const out = {};
  for (const d of fs.readdirSync(ARTICLES, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[') || d.name === 'page') continue;
    const files = filesUnder(path.join(ARTICLES, d.name));
    const sources = files.map((f) => fs.readFileSync(f, 'utf8'));
    for (const s of sources) {
      const tag = headerTag(s);
      if (!tag) continue;
      const literal = tag.match(/\bimage=(?:\{\s*)?(['"])([^'"]+)\1/);
      const named = tag.match(/\bimage=\{\s*([A-Za-z_$][\w$]*)\s*\}/);
      const value = literal ? literal[2] : named ? constValue(sources, named[1]) : null;
      if (value) out[d.name] = value;
      break;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.writeFileSync(OUT, `${JSON.stringify(buildArticleHeroes(), null, 2)}\n`);
  console.log(`wrote ${OUT}: ${Object.keys(JSON.parse(fs.readFileSync(OUT, 'utf8'))).length} heroes`);
}
