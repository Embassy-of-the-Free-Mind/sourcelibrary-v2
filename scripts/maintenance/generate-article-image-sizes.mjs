#!/usr/bin/env node
/**
 * Generate src/generated/article-image-sizes.json: for every picture in the body
 * of every article, its pixel size and a tiny blurred copy. ArticleImage uses
 * them to hold each picture's place at its own proportions and show the blur
 * until the picture fades in, so the text doesn't jump as pictures arrive.
 *
 *   node scripts/maintenance/generate-article-image-sizes.mjs [--base http://localhost:3000]
 *
 * Reads the articles as rendered by a running dev server (picture addresses are
 * often built from constants, so the source files alone don't give them), and
 * runs the blur through that server's image optimiser, which costs nothing
 * locally. Keeps entries it already has and only probes new pictures; drops
 * pictures no longer used. A picture missing here still loads, just without a
 * reserved box, so the tests don't check this file.
 *
 * Also prints pictures over 60 megapixels: the optimiser serves those
 * untouched, so bring them into public/articles/<slug>/ at 2,000 px.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(ROOT, 'src', 'generated', 'article-image-sizes.json');
const SLUGS = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'generated', 'blog-revisions.json'), 'utf8')));
const i = process.argv.indexOf('--base');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:3000';
const TOO_BIG = 60e6;

function absolute(src) {
  return src.startsWith('/') ? BASE + src : src;
}

async function size(src) {
  // The header of a JPEG, PNG or WebP is in its first bytes; fall back to the whole file.
  const head = await fetch(absolute(src), { headers: { Range: 'bytes=0-262143' } });
  if (!head.ok) throw new Error(`${head.status}`);
  try {
    const m = await sharp(Buffer.from(await head.arrayBuffer()), { failOn: 'none' }).metadata();
    if (m.width && m.height) return { w: m.width, h: m.height };
  } catch {
    /* fall through */
  }
  const full = await fetch(absolute(src));
  const m = await sharp(Buffer.from(await full.arrayBuffer()), { failOn: 'none', limitInputPixels: false }).metadata();
  return { w: m.width, h: m.height };
}

async function blur(src) {
  const small = `${BASE}/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`;
  const res = await fetch(small, { headers: { Accept: 'image/webp,image/jpeg' } });
  if (!res.ok) throw new Error(`optimiser ${res.status}`);
  const buf = await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: false })
    .resize({ width: 16 })
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const srcs = new Set();
for (const slug of SLUGS) {
  const html = await fetch(`${BASE}/articles/${slug}`).then((r) => (r.ok ? r.text() : ''));
  // The article body only: the books grid and related cards come after </main>.
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  for (const m of main.matchAll(/<img[^>]+>/g)) {
    let src = (m[0].match(/\ssrc="([^"]+)"/) || [])[1];
    if (!src) continue;
    src = src.replace(/&amp;/g, '&');
    if (src.startsWith('/_next/image')) src = new URL(src, BASE).searchParams.get('url') || '';
    if (!src || src.startsWith('data:') || src.endsWith('.svg')) continue;
    srcs.add(src);
  }
}

const out = {};
let probed = 0;
for (const src of [...srcs].sort()) {
  if (old[src]) {
    out[src] = old[src];
    continue;
  }
  try {
    const dims = await size(src);
    let b;
    try {
      b = await blur(src);
    } catch {
      /* no blur: the box is still reserved */
    }
    out[src] = b ? { ...dims, blur: b } : dims;
    probed++;
    if (dims.w * dims.h > TOO_BIG) console.warn(`over 60 MP, served untouched: ${dims.w}x${dims.h} ${src}`);
  } catch (e) {
    console.warn(`skipped ${src}: ${e.message}`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(out).length} pictures (${probed} new)`);
