// Build a citation list for every plate used in the circles reels + the eye
// finale. Geometry plates carry full provenance in /tmp/geo-out/manifest.json;
// Buddhist/eye plates only stored titles at download time, so re-query the
// gallery API and match on title+description to recover author/year/links.
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://sourcelibrary.org';
const OUT_MD = 'esoteric-geometries-out/citations.md';
const OUT_JSON = 'esoteric-geometries-out/citations.json';

// Final reel order (circle-01..19 in the combined masked reel) + the eye.
const REEL = [
  'plate-55', 'plate-10', 'plate-19', 'plate-39', 'plate-46', 'plate-50',
  'plate-59', 'plate-63', 'plate-66', 'plate-87', 'plate-89',
  'bud-01', 'bud-06', 'bud-09', 'bud-12', 'bud-18', 'bud-21', 'bud-24',
  'plate-24',
];
const EYE = 'eye-11';

// --- geometry plates: direct from the guide manifest -----------------------
const geo = JSON.parse(readFileSync('/tmp/geo-out/manifest.json', 'utf8'));
const flat = geo.chapters.flatMap(c => c.plates);
const geoByFile = new Map();
flat.forEach((p, i) => geoByFile.set(`plate-${i + 1}`, p));

// --- buddhist + eye plates: re-query gallery, match by title+description ---
const budManifest = JSON.parse(readFileSync('/tmp/geo-out/buddhist/manifest.json', 'utf8'));
const eyeManifest = JSON.parse(readFileSync('/tmp/geo-out/eyes/manifest.json', 'utf8'));

const QUERIES = [
  'buddhist mandala cosmology tibetan',
  'mandala vajrayana deity circle diagram',
  'thangka tibetan wheel of life bhavacakra',
  'tantric yantra meditation circle',
  'chakra lotus wheel dharma',
  'all-seeing eye providence rays',
  'eye of god divine emblem engraving',
  'oculus eye symbol alchemical emblem',
  'eye radiant triangle masonic',
  'divine eye clouds heaven emblem',
];
const pool = new Map();
for (const q of QUERIES) {
  const u = new URL('/api/gallery', BASE);
  u.searchParams.set('limit', '60'); u.searchParams.set('maxPerBook', '4');
  u.searchParams.set('q', q);
  try {
    const r = await fetch(u); if (!r.ok) continue;
    for (const it of (await r.json()).items || []) {
      pool.set(`${it.pageId}-${it.detectionIndex}`, it);
    }
  } catch { /* skip */ }
}
console.log(`Gallery pool for matching: ${pool.size} items`);

function findMatch(entry) {
  const descPrefix = (entry.description || '').slice(0, 80);
  for (const it of pool.values()) {
    if ((it.bookTitle || '') === (entry.title || '') &&
        (it.description || '').startsWith(descPrefix)) return it;
  }
  // fallback: title-only match
  for (const it of pool.values()) {
    if ((it.bookTitle || '') === (entry.title || '')) return it;
  }
  return null;
}

function citeFromGeo(p) {
  return {
    book: p.book, author: p.author, year: p.year,
    description: p.description, url: p.url, type: p.type,
  };
}
function citeFromGallery(it, fallbackTitle) {
  if (!it) return { book: fallbackTitle || 'Unknown', author: null, year: null, description: null, url: null };
  return {
    book: it.bookTitle, author: it.author || null, year: it.year || null,
    description: it.description || null,
    url: `${BASE}/gallery/image/${it.pageId}-${it.detectionIndex}`,
    bookUrl: it.link ? `${BASE}${it.link}` : null,
    type: it.type || null,
  };
}

const budByFile = new Map(budManifest.map(e => [e.file.replace(/\.jpg$/, ''), e]));
const eyeByFile = new Map(eyeManifest.map(e => [e.file.replace(/\.jpg$/, ''), e]));

const rows = [];
for (const stem of REEL) {
  if (stem.startsWith('plate-')) {
    const p = geoByFile.get(stem);
    rows.push({ frame: rows.length + 1, file: stem, ...citeFromGeo(p) });
  } else {
    const entry = budByFile.get(stem);
    const it = entry ? findMatch(entry) : null;
    if (!it) console.log(`  ! no gallery match for ${stem} (${entry?.title})`);
    rows.push({ frame: rows.length + 1, file: stem, ...citeFromGallery(it, entry?.title) });
  }
}
{
  const entry = eyeByFile.get(EYE);
  const it = entry ? findMatch(entry) : null;
  if (!it) console.log(`  ! no gallery match for ${EYE} (${entry?.title})`);
  rows.push({ frame: 'finale', file: EYE, ...citeFromGallery(it, entry?.title) });
}

writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2));

const md = [];
md.push('# Esoteric Geometries reel — image citations');
md.push('');
md.push('All images are plates from books and artworks in the [Source Library](https://sourcelibrary.org) collection.');
md.push('');
for (const r of rows) {
  const label = r.frame === 'finale' ? 'Finale (the eye)' : `Frame ${String(r.frame).padStart(2, '0')}`;
  const author = r.author && r.author !== 'Unknown artist' ? r.author : null;
  const bits = [];
  bits.push(`**${r.book}**`);
  if (author) bits.push(author);
  if (r.year) bits.push(String(r.year));
  md.push(`- ${label} (\`${r.file}\`): ${bits.join(', ')}.`);
  if (r.description) md.push(`  ${r.description.length > 160 ? r.description.slice(0, 157) + '…' : r.description}`);
  if (r.url) md.push(`  ${r.url}`);
}
md.push('');
writeFileSync(OUT_MD, md.join('\n'));
console.log(`Wrote ${rows.length} citations to ${OUT_MD} and ${OUT_JSON}`);
