// Hunt the public gallery for engraved eye imagery (all-seeing eye, eye of
// providence) to close the warp reel. Downloads candidates + labeled montage.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://sourcelibrary.org';
const OUT = '/tmp/geo-out/eyes';
const CAP = 20;
mkdirSync(OUT, { recursive: true });

const QUERIES = [
  { q: 'all-seeing eye providence rays' },
  { q: 'eye of god divine emblem engraving' },
  { q: 'oculus eye symbol alchemical emblem' },
  { q: 'eye radiant triangle masonic' },
  { q: 'divine eye clouds heaven emblem' },
];
const EYE_HINT = /\b(eye|oculus|ocular|all-seeing|providence)\b/i;

function key(it) { return `${it.pageId}-${it.detectionIndex}`; }
async function fetchQuery(query) {
  const u = new URL('/api/gallery', BASE);
  u.searchParams.set('limit', '60'); u.searchParams.set('maxPerBook', '3');
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  try { const r = await fetch(u); if (!r.ok) return []; return (await r.json()).items || []; }
  catch { return []; }
}

const byKey = new Map();
for (const q of QUERIES) {
  for (const it of await fetchQuery(q)) {
    if (byKey.has(key(it))) continue;
    if (!it.extractedUrl && !it.imageUrl) continue;
    const text = `${it.bookTitle || ''} ${it.description || ''} ${it.museumDescription || ''}`;
    it._hint = EYE_HINT.test(text);
    byKey.set(key(it), it);
  }
}
const ranked = [...byKey.values()].sort((a, b) => (b._hint - a._hint) || ((b.galleryQuality ?? 0) - (a.galleryQuality ?? 0)));
console.log(`Gathered ${ranked.length} candidates; downloading top ${CAP} (eye-hinted first)…`);

const manifest = [], tiles = [];
let n = 0;
for (const it of ranked) {
  if (n >= CAP) break;
  const src = it.extractedUrl || it.imageUrl;
  try {
    const r = await fetch(src); if (!r.ok) continue;
    const raw = Buffer.from(await r.arrayBuffer());
    const buf = await sharp(raw).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    n++;
    const file = `eye-${String(n).padStart(2, '0')}.jpg`;
    writeFileSync(join(OUT, file), buf);
    manifest.push({ file, title: it.bookTitle, description: (it.description || '').slice(0, 100), hint: it._hint });
    tiles.push({ buf, label: `${file} ${it._hint ? '●' : '○'} ${(it.bookTitle || '').slice(0, 24)}` });
    console.log(`  ${file}  ${it._hint ? '●' : '○'} ${(it.description || it.bookTitle || '').slice(0, 80)}`);
  } catch { /* skip */ }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const TILE = 200, COLS = 5;
const rows = Math.ceil(tiles.length / COLS);
const composed = await Promise.all(tiles.map(async (t) => {
  const lbl = Buffer.from(`<svg width="${TILE}" height="20"><rect width="100%" height="100%" fill="black" fill-opacity="0.65"/><text x="4" y="15" font-family="sans-serif" font-size="11" fill="#fff">${t.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
  return sharp(t.buf).resize(TILE, TILE, { fit: 'cover' }).composite([{ input: lbl, top: TILE - 20, left: 0 }]).png().toBuffer();
}));
const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 30, g: 26, b: 34 } } })
  .composite(comps).png().toFile(join(OUT, 'eyes-montage.png'));
console.log(`Wrote ${n} images + montage to ${OUT}`);
