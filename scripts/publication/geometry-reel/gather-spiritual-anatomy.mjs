// Hunt the gallery for "spiritual anatomy" — the historical ancestors of the
// Alex Grey / Android Jones aesthetic: bodies fused with cosmos, energy
// channels, chakras, auras, planetary organs, transparent/x-ray mystical
// figures, wrathful deity density. Downloads candidates + labeled montage.
import sharp from 'sharp';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://sourcelibrary.org';
const OUT = '/tmp/geo-out/spiritual-anatomy';
const CAP = 42;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const QUERIES = [
  'theosophical man spiritual anatomy planets body',
  'astral man body planets heart divine gichtel',
  'subtle body energy channels nadis kundalini figure',
  'human figure chakras spine serpent energy',
  'man microcosm zodiac organs cosmic body',
  'transparent body soul anatomy mystical figure',
  'aura human figure radiating colors astral',
  'meditation figure radiant energy body deity',
  'wrathful deity flames dense symmetrical thangka',
  'anatomical figure alchemical symbols organs mystical',
  'body of light glorified spiritual rebirth figure',
  'yogi meditation cosmic diagram body universe',
];

function key(it) { return `${it.pageId}-${it.detectionIndex}`; }
const pool = new Map();
for (const q of QUERIES) {
  for (let offset = 0; offset < 120; offset += 60) {
    const u = new URL('/api/gallery', BASE);
    u.searchParams.set('limit', '60'); u.searchParams.set('maxPerBook', '5');
    u.searchParams.set('q', q);
    if (offset) u.searchParams.set('offset', String(offset));
    try {
      const r = await fetch(u); if (!r.ok) break;
      const items = (await r.json()).items || [];
      for (const it of items) {
        if (!it.extractedUrl && !it.imageUrl) continue;
        if (!pool.has(key(it))) { it._q = q; pool.set(key(it), it); }
      }
      if (items.length < 60) break;
    } catch { break; }
  }
}
// Score: body+cosmos fusion language.
const BODY_RE = /\b(body|man|figure|anatom|yogi|meditat|deity)\b/i;
const COSMIC_RE = /\b(planet|zodiac|chakra|aura|astral|energy|channel|nadis?|kundalini|serpent|radiant|cosmic|divine|spiritual|subtle|flames?|halo|emanat)\b/i;
const ranked = [...pool.values()]
  .map(it => {
    const text = `${it.bookTitle || ''} ${it.description || ''}`;
    const score = (BODY_RE.test(text) ? 1 : 0) + (COSMIC_RE.test(text) ? 1 : 0) + (it.galleryQuality ?? 0);
    return { it, score };
  })
  .sort((a, b) => b.score - a.score);
console.log(`Pool: ${ranked.length} unique candidates`);

const manifest = [], tiles = [];
let n = 0;
for (const { it } of ranked) {
  if (n >= CAP) break;
  const src = it.extractedUrl || it.imageUrl;
  try {
    const r = await fetch(src); if (!r.ok) continue;
    const raw = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(raw).metadata();
    if (Math.min(meta.width, meta.height) < 350) continue;
    const buf = await sharp(raw).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    n++;
    const file = `anat-${String(n).padStart(2, '0')}.jpg`;
    writeFileSync(join(OUT, file), buf);
    manifest.push({ file, galleryId: key(it), url: `${BASE}/gallery/image/${key(it)}`, title: it.bookTitle, author: it.author, year: it.year, description: (it.description || '').slice(0, 140), query: it._q });
    tiles.push({ buf, label: `${file} ${it.year || ''} ${(it.bookTitle || '').slice(0, 22)}` });
    console.log(`  ${file}  ${(it.year || '????')}  ${(it.bookTitle || '').slice(0, 42)}  |  ${(it.description || '').slice(0, 62)}`);
  } catch { /* skip */ }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const TILE = 210, COLS = 6;
const rows = Math.ceil(tiles.length / COLS);
const composed = await Promise.all(tiles.map(async (t) => {
  const lbl = Buffer.from(`<svg width="${TILE}" height="18"><rect width="100%" height="100%" fill="black" fill-opacity="0.65"/><text x="4" y="14" font-family="sans-serif" font-size="11" fill="#fff">${t.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
  return sharp(t.buf).resize(TILE, TILE, { fit: 'cover' }).composite([{ input: lbl, top: TILE - 18, left: 0 }]).png().toBuffer();
}));
const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 26, g: 22, b: 18 } } })
  .composite(comps).png().toFile(join(OUT, 'anat-montage.png'));
console.log(`Wrote ${n} images + montage to ${OUT}`);
