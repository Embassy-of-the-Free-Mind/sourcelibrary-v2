import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://sourcelibrary.org';
const OUT = process.argv[2] || '/tmp/geo-out/buddhist';
const CAP = Number(process.argv[3] || 24);
mkdirSync(OUT, { recursive: true });

const QUERIES = [
  { q: 'buddhist mandala cosmology tibetan' },
  { q: 'mandala vajrayana deity circle diagram' },
  { q: 'thangka tibetan wheel of life bhavacakra' },
  { q: 'tantric yantra meditation circle' },
  { q: 'chakra lotus wheel dharma' },
];

// Prefer plates whose title/description signal a DOMINANT circle (better mask hit-rate).
const CIRCLE_HINT = /\b(mandala|bhavacakra|wheel|yantra|chakra|circular|cosmogram|disc|disk|roundel|lotus|rota|concentric)\b/i;

function key(it) { return `${it.pageId}-${it.detectionIndex}`; }

async function fetchQuery(query) {
  const u = new URL('/api/gallery', BASE);
  u.searchParams.set('limit', '60'); u.searchParams.set('maxPerBook', '4');
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
    it._hint = CIRCLE_HINT.test(text);
    byKey.set(key(it), it);
  }
}
// Circle-hinted first, then by any quality signal.
const ranked = [...byKey.values()].sort((a, b) => (b._hint - a._hint) || ((b.galleryQuality ?? 0) - (a.galleryQuality ?? 0)));
console.log(`Gathered ${ranked.length} unique Buddhist plates; downloading top ${CAP}…`);

const manifest = [];
let n = 0;
for (const it of ranked) {
  if (n >= CAP) break;
  const src = it.extractedUrl || it.imageUrl;
  try {
    const r = await fetch(src); if (!r.ok) { console.log(`  ! ${r.status} ${(it.bookTitle || '').slice(0, 40)}`); continue; }
    const raw = Buffer.from(await r.arrayBuffer());
    const buf = await sharp(raw).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    n++;
    const file = `bud-${String(n).padStart(2, '0')}.jpg`;
    writeFileSync(join(OUT, file), buf);
    manifest.push({ file, title: it.bookTitle, description: it.description, type: it.type, hint: it._hint });
    console.log(`  ${file}  ${it._hint ? '●' : '○'} ${(it.bookTitle || '').slice(0, 50)}`);
  } catch (e) { console.log(`  ! ${e.message} ${(it.bookTitle || '').slice(0, 40)}`); }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${n} images + manifest to ${OUT}`);
