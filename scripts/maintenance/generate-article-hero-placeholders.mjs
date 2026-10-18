#!/usr/bin/env node
/**
 * Generate src/generated/article-hero-placeholders.json: a tiny blurred copy of
 * each article hero (src/generated/article-heroes.json), inlined in the page so
 * the hero shows its colours and shapes at once while the full picture loads.
 *
 *   node scripts/maintenance/generate-article-hero-placeholders.mjs
 *
 * Re-run after generate-article-heroes.mjs. Keeps entries it already has and
 * only fetches new heroes; drops heroes no longer used. A hero missing here just
 * loads without a placeholder, so this file is not checked by the tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const HEROES = path.join(ROOT, 'src', 'generated', 'article-heroes.json');
const OUT = path.join(ROOT, 'src', 'generated', 'article-hero-placeholders.json');

// 16 px wide is enough for a blur that is scaled up to fill the screen, and
// keeps each entry around 200 bytes.
const WIDTH = 16;

async function load(src) {
  if (src.startsWith('/')) return fs.readFileSync(path.join(ROOT, 'public', src));
  const res = await fetch(src, { headers: { 'User-Agent': 'SourceLibrary/1.0 (hero placeholders)' } });
  if (!res.ok) throw new Error(`${res.status} ${src}`);
  return Buffer.from(await res.arrayBuffer());
}

const heroes = [...new Set(Object.values(JSON.parse(fs.readFileSync(HEROES, 'utf8'))))].sort();
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const out = {};
let made = 0;
for (const src of heroes) {
  if (old[src]) {
    out[src] = old[src];
    continue;
  }
  try {
    const buf = await sharp(await load(src)).rotate().resize({ width: WIDTH }).webp({ quality: 40 }).toBuffer();
    out[src] = `data:image/webp;base64,${buf.toString('base64')}`;
    made++;
  } catch (e) {
    console.warn(`skipped ${src}: ${e.message}`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(out).length} placeholders (${made} new)`);
