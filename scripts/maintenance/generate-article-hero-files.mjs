#!/usr/bin/env node
/**
 * Make every article hero ahead of time as static AVIF files, so opening an
 * article never waits on the image optimiser.
 *
 *   node scripts/maintenance/generate-article-hero-files.mjs
 *
 * Why: the optimiser converts a picture on its first request, and for a hero
 * scan that took 0.5 to 2 s before the first byte (measured 2026-10-18 on
 * sourcelibrary.org; 0.16 s once cached). The hero is the first thing an
 * article shows, so that wait was the whole page. Static files under public/
 * come straight from the CDN.
 *
 * Reads src/generated/article-heroes.json (run generate-article-heroes.mjs
 * first), writes public/articles/heroes/<key>-<width>.avif at two widths and
 * src/generated/article-hero-files.json (hero src -> files), which
 * ContentHeader reads. Keeps files it already made; drops heroes no longer
 * used. A hero missing here falls back to the optimiser, so the tests don't
 * check this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const HEROES = path.join(ROOT, 'src', 'generated', 'article-heroes.json');
const OUT = path.join(ROOT, 'src', 'generated', 'article-hero-files.json');
const DIR = path.join(ROOT, 'public', 'articles', 'heroes');
// 1280 covers a phone at 3x and most laptops; 1920 a wide or high-density screen.
// The hero sits under a dark gradient and the title, so quality 50 doesn't show.
const WIDTHS = [1280, 1920];
const QUALITY = 50;

async function load(src) {
  if (src.startsWith('/')) return fs.readFileSync(path.join(ROOT, 'public', src));
  const res = await fetch(src, { headers: { 'User-Agent': 'SourceLibrary/1.0 (article heroes)' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

fs.mkdirSync(DIR, { recursive: true });
const heroes = [...new Set(Object.values(JSON.parse(fs.readFileSync(HEROES, 'utf8'))))].sort();
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const out = {};
const keep = new Set();
let made = 0;

for (const src of heroes) {
  const key = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
  const files = WIDTHS.map((w) => `/articles/heroes/${key}-${w}.avif`);
  if (old[src] && files.every((f) => fs.existsSync(path.join(ROOT, 'public', f)))) {
    out[src] = old[src];
    files.forEach((f) => keep.add(path.basename(f)));
    continue;
  }
  try {
    const input = sharp(await load(src), { limitInputPixels: false }).rotate();
    const { width, height } = await input.metadata();
    const srcset = [];
    for (const w of WIDTHS) {
      const target = Math.min(w, width);
      const file = `/articles/heroes/${key}-${w}.avif`;
      // A tall page scan is cut to a centred square: the hero frame is wider than
      // tall on a computer, so only the middle band ever shows, and the rest was
      // half the file. ParallaxImage centres the picture, so the band is unchanged.
      const resize = height > width ? { width: target, height: target, fit: 'cover', position: 'centre' } : { width: target };
      await input.clone().resize(resize).avif({ quality: QUALITY, effort: 4, chromaSubsampling: '4:2:0' }).toFile(path.join(ROOT, 'public', file));
      srcset.push({ src: file, w: target });
      keep.add(path.basename(file));
    }
    out[src] = { srcset };
    made++;
  } catch (e) {
    console.warn(`skipped ${src}: ${e.message}`);
  }
}

for (const f of fs.readdirSync(DIR)) if (!keep.has(f)) fs.unlinkSync(path.join(DIR, f));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const bytes = [...keep].reduce((s, f) => s + fs.statSync(path.join(DIR, f)).size, 0);
console.log(`wrote ${OUT}: ${Object.keys(out).length} heroes (${made} new), ${(bytes / 1e6).toFixed(1)} MB in public/articles/heroes`);
