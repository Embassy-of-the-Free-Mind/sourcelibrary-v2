/**
 * esoteric-geometries.mjs — build "The Source Library Guide to Esoteric Geometries".
 *
 * Scans the library's already-extracted illustrations (gallery_images) for
 * geometric/diagrammatic plates from the Western esoteric traditions —
 * Platonic/Pythagorean solids, the Monad, macrocosm–microcosm cosmograms,
 * the Kabbalistic Tree of Life, magic squares & planetary seals, ritual magic
 * circles, Lullian/mnemonic wheels, and alchemical–Rosicrucian emblematic
 * geometry — classifies them into thematic chapters, curates for quality and
 * diversity, and renders a single illustrated EPUB plus a review manifest.
 *
 * DATA SOURCE: the public gallery API (https://sourcelibrary.org/api/gallery),
 * so it runs with no database credentials. Every plate is already extracted,
 * quality-scored, and given a museum description by the image pipeline; this
 * script only *selects and renders*.
 *
 * Usage:
 *   node scripts/publication/esoteric-geometries.mjs [--out <dir>] [--base <url>]
 *        [--max <globalCap>] [--per-book <n>] [--per-chapter <n>] [--min-quality <0-1>]
 *        [--manifest-only]
 *
 * Output (in <dir>, default ./scripts/output/esoteric-geometries — git-ignored):
 *   esoteric-geometries.epub   the illustrated guide
 *   cover.jpg                  the cover image
 *   manifest.json              every selected plate + its chapter (for review)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import archiver from 'archiver';
import sharp from 'sharp';

// ─── Config ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (flag, def) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : def;
  };
  return {
    // Default under scripts/output/ (git-ignored) so generated binaries never
    // land in the repo even if --out is omitted. Override with --out anywhere.
    out: resolve(get('--out', join(process.cwd(), 'scripts/output/esoteric-geometries'))),
    base: get('--base', 'https://sourcelibrary.org'),
    globalCap: Number(get('--max', '90')),
    perBook: Number(get('--per-book', '3')),
    perChapter: Number(get('--per-chapter', '14')),
    minQuality: Number(get('--min-quality', '0.7')),
    maxYear: Number(get('--max-year', '1930')),
    manifestOnly: a.includes('--manifest-only'),
  };
}

const CFG = parseArgs(process.argv);

// Image types that never belong in a geometry guide.
const EXCLUDE_TYPES = new Set(['decorative', 'exlibris', 'bookplate', 'portrait', 'printer_device', 'ornament', 'border']);

// A plate must clearly belong to a theme (score >= this) to be included.
const MIN_SCORE = 3;

// Types that carry genuine diagrammatic geometry get a small bonus so they
// clear the threshold ahead of allegorical title pages that merely mention a
// theme word.
const TYPE_BONUS = { diagram: 1.5, symbol: 1.0, emblem: 0.5 };

// Text that disqualifies a plate outright — off-theme subjects that keep
// matching on stray keywords (anatomy, botany, optics, machinery, pure
// decoration). Matched case-insensitively against the combined text.
const BLOCK_TERMS = [
  'phlebotomy', 'bloodletting', 'magic lantern', 'botanical illustration',
  'unidentified plant', 'woodcut initial', "printer's device", 'title page border',
  'title-page border', 'decorative border', 'reading wheel', 'bookwheel',
  'anatomical', 'dissection', 'herbal',
];

const TITLE = 'The Source Library Guide to Esoteric Geometries';
const SUBTITLE = 'Sacred, Hermetic, and Magical Diagrams from the Western Tradition';

// ─── Thematic taxonomy ────────────────────────────────────────────────────
// Each chapter has an id, display title, a short editorial intro, and a set of
// scored keywords matched against a plate's combined text (book title +
// description + museum description + subjects + symbols). A plate is assigned
// to the highest-scoring chapter; unmatched plates fall to "further".

const CHAPTERS = [
  {
    id: 'platonic',
    title: 'The Platonic Solids and the Harmony of the Spheres',
    intro:
      'That the world is built on number and figure is the oldest of geometric convictions. In the five regular solids the Pythagoreans and their heirs read the elements themselves, and Kepler would later nest them inside the planetary orbits. Here are the tetrahedra, cubes, and dodecahedra by which geometry was made a theology of the cosmos.',
    keywords: {
      platonic: 3, tetrahed: 3, octahedron: 3, dodecahedron: 3, icosahedron: 3,
      polyhedron: 2, polyhedra: 2, 'regular solid': 3, 'five solids': 3,
      kepler: 2, euclid: 2, 'elements of geomet': 3, pythagor: 3, tetractys: 3,
      quaternary: 2, 'harmony of the spheres': 3, 'perspectiva corporum': 4,
      'geometric construction': 3, 'geometric solid': 3,
    },
  },
  {
    id: 'monad',
    title: 'The Monad, the Point, and the Circle',
    intro:
      'All figure begins in the point and unfolds into the circle. From the single mark the geometer derives line, plane, and world — a procession the Hermeticists called the Monad. John Dee compressed the whole of this doctrine into one composite glyph; others sought it in the squaring of the circle and the sweep of the compass.',
    keywords: {
      monad: 3, 'hieroglyphic monad': 4, ' dee': 2, 'john dee': 3, unity: 1,
      'squaring the circle': 3, compass: 1, 'point and': 2, 'the one': 1,
    },
  },
  {
    id: 'macro',
    title: 'Macrocosm and Microcosm',
    intro:
      'As above, so below. The great tradition held the human being to be a small world mirroring the great one, the two bound by ratio and correspondence. In these diagrams the spheres of the elements, planets, and fixed stars are drawn about a central figure, and the structure of the cosmos is rendered as a single legible pattern.',
    keywords: {
      macrocosm: 4, microcosm: 4, fludd: 3, utriusque: 3, 'world soul': 3,
      'anima mundi': 3, 'zodiac man': 4, 'homo signorum': 4, cosmolog: 2,
      ptolemaic: 3, geocentric: 3, 'elemental spheres': 3,
      'concentric spheres': 3, 'sphere of the': 2, armillary: 2,
    },
  },
  {
    id: 'tree',
    title: 'The Tree of Life and the Kabbalistic Diagrams',
    intro:
      'The Kabbalah maps the descent of the divine into ten luminous vessels joined by twenty-two paths — the Sephirotic Tree. Around it grew a whole geometry of emanation: gates, ladders, and concentric worlds. These plates trace the figure through its Hebrew sources and its Christian-Hermetic adaptations.',
    keywords: {
      kabbal: 4, cabal: 3, cabbal: 3, sephir: 4, 'tree of life': 4,
      'gates of light': 4, shaarei: 3, ilan: 3, "ain soph": 3, 'ein sof': 3,
      'ten sefirot': 4, emanation: 2, hebrew: 1, sefira: 3,
    },
  },
  {
    id: 'squares',
    title: 'Magic Squares, Planetary Seals, and Numerical Sigils',
    intro:
      'Where number becomes talisman, geometry turns operative. The planetary magic squares — each cell summing to a sacred constant — generate the seals and characters engraved on amulets and drawn in the grimoires. Agrippa and Kircher systematized them; here are the grids, kameas, and sigils in which arithmetic was made magical.',
    keywords: {
      'magic square': 4, kamea: 4, 'planetary seal': 4, sigil: 3, sigillum: 3,
      arithmolog: 3, 'character of the planet': 4, 'numerical square': 3,
      'planetary character': 4, talisman: 2, 'planetary sigil': 4,
    },
  },
  {
    id: 'circles',
    title: 'Magic Circles and Ritual Geometry',
    intro:
      'The circle drawn for conjuration is geometry pressed into service as protection and boundary. Divided by crosses, inscribed with divine names, and ringed with the signs of hour and planet, the ritual figures of the Heptameron and the Goetia are among the most precisely diagrammed objects in the whole magical literature.',
    keywords: {
      'magic circle': 4, heptameron: 4, goetia: 3, conjuration: 3, pentacle: 3,
      'seal of solomon': 4, hexagram: 3, invocation: 2, 'ritual circle': 4,
      'protective circle': 3, ' ritual': 1, grimoire: 2,
    },
  },
  {
    id: 'wheels',
    title: 'Combinatorial Wheels and the Art of Memory',
    intro:
      'Ramon Llull built a logic of rotating circles, and Giordano Bruno turned the same device into an engine of memory and vision. The volvelle — a wheel of paper that turns within the page — let the reader combine terms, letters, and images by hand. These revolving figures are geometry set in motion.',
    keywords: {
      llull: 4, lull: 3, 'ramon': 2, volvelle: 4, mnemonic: 3, combinatorial: 4,
      ' bruno': 3, 'giordano': 3, 'art of memory': 4, revolving: 2, rotating: 2,
      'wheel': 2, ' ars ': 2, 'porta veneris': 3, 'atrium veneris': 3,
    },
  },
  {
    id: 'cosmogram',
    title: 'Alchemical Cosmograms and Emblematic Geometry',
    intro:
      'In the alchemical and Rosicrucian books, geometry becomes emblem: circles, triangles, and squares stacked into figures that encode the stages of the Work and the structure of a hidden cosmos. Boehme\u2019s spheres of the divine, the Rosicrucian secret symbols, and the plates of the Theatrum Chemicum gather here.',
    keywords: {
      alchem: 3, rosicrucian: 3, 'rosy cross': 3, boehme: 3, behmen: 3,
      theosophical: 2, 'secret symbols': 4, hermetic: 2, 'prima materia': 3,
      tincture: 2, 'squaring the circle': 4, 'alchemical diagram': 3,
      'alchemical emblem': 3, coniunctio: 3, athanor: 2,
    },
  },
];

const CHAPTER_INDEX = new Map(CHAPTERS.map((c, i) => [c.id, i]));

// Targeted queries designed to surface esoteric (not merely scientific)
// geometry. Each is paginated and merged; dedupe happens on pageId-detIndex.
const QUERIES = [
  { semantic: true, q: 'esoteric sacred hermetic geometric diagram cosmogram' },
  { subject: 'alchemy', type: 'diagram' },
  { subject: 'kabbalah' },
  { subject: 'astrology', type: 'diagram' },
  { q: 'magic square planetary seal sigil kamea agrippa' },
  { q: 'platonic solid polyhedron kepler euclid tetractys pythagorean' },
  { q: 'magic circle heptameron pentacle seal of solomon hexagram' },
  { q: 'lull llull volvelle mnemonic combinatorial wheel giordano bruno' },
  { q: 'macrocosm microcosm fludd world soul zodiac man elemental spheres' },
  { q: 'hieroglyphic monad john dee squaring the circle' },
  { q: 'tree of life sephirot gates of light kabbalistic emanation' },
  { q: 'rosicrucian secret symbols boehme theosophical cosmological diagram' },
];

// ─── Fetch + select ───────────────────────────────────────────────────────

function buildUrl(query, offset, limit) {
  const u = new URL('/api/gallery', CFG.base);
  u.searchParams.set('minQuality', String(CFG.minQuality));
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('maxPerBook', '6');
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function fetchQuery(query, maxDepth = 200) {
  const limit = 100;
  const out = [];
  for (let offset = 0; offset < maxDepth; offset += limit) {
    let json;
    try {
      const r = await fetch(buildUrl(query, offset, limit));
      if (!r.ok) break;
      json = await r.json();
    } catch (e) {
      console.warn(`  ! query failed (${JSON.stringify(query)}): ${e.message}`);
      break;
    }
    const items = json.items || [];
    out.push(...items);
    if (items.length < limit) break;
  }
  return out;
}

function plateKey(it) {
  return `${it.pageId}-${it.detectionIndex}`;
}

/**
 * Standalone artwork records (as opposed to plates extracted from a book's
 * pages) come back with an `artwork-`-prefixed pageId. Their dating is the
 * artwork's, not a historical edition's, so an undated one carries no evidence
 * that it belongs in a guide to historical geometry.
 */
function isArtworkRecord(it) {
  return String(it.pageId || '').startsWith('artwork-');
}

function combinedText(it) {
  const m = it.metadata || {};
  return [
    it.bookTitle,
    it.description,
    it.museumDescription,
    (m.subjects || []).join(' '),
    (m.symbols || []).join(' '),
    (m.figures || []).join(' '),
  ]
    .filter(Boolean)
    .join(' \u00b7 ')
    .toLowerCase();
}

function classify(it) {
  const text = combinedText(it);
  if (BLOCK_TERMS.some(t => text.includes(t))) return null;

  const typeBonus = TYPE_BONUS[it.type] ?? 0;
  let best = null;
  let bestScore = 0;
  for (const ch of CHAPTERS) {
    let score = 0;
    for (const [kw, weight] of Object.entries(ch.keywords)) {
      if (text.includes(kw)) score += weight;
    }
    if (score === 0) continue; // no thematic signal for this chapter
    const total = score + typeBonus;
    if (total > bestScore) {
      bestScore = total;
      best = ch.id;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

async function gatherCandidates() {
  console.log(`Scanning library for geometric plates (source: ${CFG.base})\u2026`);
  const byKey = new Map();
  let droppedModern = 0;
  let droppedUndated = 0;
  for (const query of QUERIES) {
    const items = await fetchQuery(query);
    let added = 0;
    for (const it of items) {
      const key = plateKey(it);
      if (byKey.has(key)) continue;
      if (EXCLUDE_TYPES.has(it.type)) continue;
      if ((it.galleryQuality ?? 0) < CFG.minQuality) continue;
      // This is a guide to HISTORICAL esoteric geometry, and the gallery now
      // serves a second lane: standalone artwork records, many of them modern
      // (measured 2026-08-21: a third of the hits for this script's own
      // Platonic-solids query were artwork records dated 2008-2024). They are
      // currently kept out only INCIDENTALLY — they carry no gallery_quality,
      // so the threshold above drops them. That is one accidental guard, and it
      // disappears the day the artwork lane gets quality scores. State the rule
      // the guide actually depends on instead of relying on that.
      if (Number.isFinite(it.year) && it.year > CFG.maxYear) { droppedModern++; continue; }
      if (!Number.isFinite(it.year) && isArtworkRecord(it)) { droppedUndated++; continue; }
      if (!it.extractedUrl && !it.imageUrl) continue;
      byKey.set(key, it);
      added++;
    }
    console.log(`  ${JSON.stringify(query)} -> +${added} new (total ${byKey.size})`);
  }
  if (droppedModern > 0 || droppedUndated > 0) {
    console.log(
      `  (excluded ${droppedModern} plate(s) dated after ${CFG.maxYear} and ` +
      `${droppedUndated} undated artwork record(s) — raise with --max-year)`
    );
  }
  return [...byKey.values()];
}

// Curate: assign chapters, then cap per book (diversity), per chapter, and
// globally, always keeping the highest-quality plates first.
function curate(allCandidates) {
  const candidates = [];
  for (const it of allCandidates) {
    const ch = classify(it);
    if (!ch) continue; // no clear thematic home → drop (precision over recall)
    it._chapter = ch;
    candidates.push(it);
  }
  candidates.sort((a, b) => (b.galleryQuality ?? 0) - (a.galleryQuality ?? 0));

  const perBook = new Map();
  const perChapter = new Map();
  const selected = [];

  for (const it of candidates) {
    if (selected.length >= CFG.globalCap) break;
    const bookN = perBook.get(it.bookId) ?? 0;
    const chapN = perChapter.get(it._chapter) ?? 0;
    if (bookN >= CFG.perBook) continue;
    if (chapN >= CFG.perChapter) continue;
    perBook.set(it.bookId, bookN + 1);
    perChapter.set(it._chapter, chapN + 1);
    selected.push(it);
  }

  // Group by chapter in taxonomy order; within a chapter, order by year then quality.
  const grouped = CHAPTERS.map(ch => ({
    ...ch,
    plates: selected
      .filter(it => it._chapter === ch.id)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (b.galleryQuality ?? 0) - (a.galleryQuality ?? 0)),
  })).filter(ch => ch.plates.length > 0);

  return { grouped, selected };
}

// ─── EPUB rendering ─────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xhtml(title, bodyClass, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

const CSS = `
body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; margin: 0; padding: 1.2em; color: #1a1612; }
h1, h2, h3 { font-family: Georgia, serif; font-weight: 700; line-height: 1.2; }
.title-page { text-align: center; padding-top: 22%; }
.title-page h1 { font-size: 2.1em; letter-spacing: 0.02em; margin: 0 0 0.4em; }
.title-page .subtitle { font-style: italic; font-size: 1.15em; color: #5a5348; margin-bottom: 2em; }
.title-page .brand { font-size: 0.85em; letter-spacing: 0.35em; text-transform: uppercase; color: #8a7a54; }
.rule { border: 0; border-top: 1px solid #c9a86c; width: 40%; margin: 1.4em auto; opacity: 0.7; }
.chapter-intro { font-size: 1.02em; color: #3a352c; font-style: italic; margin: 0.6em 0 1.6em; }
.plate { margin: 0 0 2.4em; page-break-inside: avoid; }
.plate img { display: block; max-width: 100%; max-height: 88vh; margin: 0 auto 0.5em; }
.plate .caption { font-size: 0.9em; color: #3a352c; }
.plate .caption .figname { font-weight: 700; }
.plate .source { font-size: 0.8em; color: #6a6357; margin-top: 0.3em; }
.plate .source a { color: #8a7a54; text-decoration: none; }
.frontmatter p { margin: 0 0 0.9em; }
.colophon { font-size: 0.9em; color: #3a352c; }
.colophon ul { padding-left: 1.2em; }
.colophon li { margin-bottom: 0.3em; }
figure { margin: 0; }
`;

async function fetchAndProcessImage(url, maxPx = 1200) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const img = sharp(buf).rotate();
  const out = await img
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return out;
}

// Build a themed cover: best cosmogram plate as background + gradient scrim.
async function buildCover(coverPlate) {
  const W = 1600;
  const H = 2400;
  const GOLD = '#c9a86c';
  const DARK = '#141019';

  let bg;
  try {
    const src = coverPlate?.imageUrl || coverPlate?.extractedUrl;
    const buf = Buffer.from(await (await fetch(src, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    const resized = await sharp(buf).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
    const scrim = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${DARK}" stop-opacity="0.82"/>
        <stop offset="30%" stop-color="${DARK}" stop-opacity="0.55"/>
        <stop offset="46%" stop-color="${DARK}" stop-opacity="0.12"/>
        <stop offset="70%" stop-color="${DARK}" stop-opacity="0.12"/>
        <stop offset="86%" stop-color="${DARK}" stop-opacity="0.60"/>
        <stop offset="100%" stop-color="${DARK}" stop-opacity="0.88"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#s)"/></svg>`;
    bg = await sharp(resized).composite([{ input: Buffer.from(scrim), top: 0, left: 0 }]).toBuffer();
  } catch {
    bg = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 20, g: 16, b: 25 } } }).jpeg().toBuffer();
  }

  const wrap = (t, n) => {
    const words = t.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const titleLines = wrap('Esoteric Geometries', 16);
  const topY = 360;
  const titleEls = titleLines
    .map((l, i) => `<text x="${W / 2}" y="${topY + i * 120}" font-family="serif" font-size="104" font-weight="700" fill="${GOLD}" text-anchor="middle" letter-spacing="2">${escapeXml(l)}</text>`)
    .join('\n');
  const kickerY = topY - 150;
  const subY = topY + titleLines.length * 120 + 90;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${W / 2}" y="${kickerY}" font-family="serif" font-size="40" font-style="italic" fill="${GOLD}" text-anchor="middle" letter-spacing="3">The Source Library Guide to</text>
    ${titleEls}
    <line x1="${W / 2 - 260}" y1="${subY - 46}" x2="${W / 2 + 260}" y2="${subY - 46}" stroke="${GOLD}" stroke-width="2" opacity="0.6"/>
    <text x="${W / 2}" y="${subY}" font-family="serif" font-size="34" font-style="italic" fill="#d8c9a0" text-anchor="middle">Sacred, Hermetic, and Magical Diagrams</text>
    <text x="${W / 2}" y="${subY + 46}" font-family="serif" font-size="34" font-style="italic" fill="#d8c9a0" text-anchor="middle">from the Western Tradition</text>
    <text x="${W / 2}" y="${H - 150}" font-family="sans-serif" font-size="30" fill="${GOLD}" text-anchor="middle" letter-spacing="7" opacity="0.85">SOURCE LIBRARY</text>
  </svg>`;
  return sharp(bg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90, progressive: true }).toBuffer();
}

function plateCaption(plate, figNo) {
  const desc = plate.museumDescription || plate.description || '';
  const cite = [plate.bookTitle, plate.author && `— ${plate.author}`, plate.year && `(${plate.year})`]
    .filter(Boolean)
    .join(' ');
  const galleryId = `${plate.pageId}-${plate.detectionIndex}`;
  const url = `${CFG.base}/gallery/image/${galleryId}`;
  return `<figure class="plate">
  <img src="images/plate-${figNo}.jpg" alt="${escapeXml((plate.description || 'geometric diagram').slice(0, 120))}"/>
  <figcaption class="caption">
    <span class="figname">Fig. ${figNo}.</span> ${escapeXml(desc)}
    <div class="source">${escapeXml(cite)} &#183; <a href="${url}">View at Source Library</a></div>
  </figcaption>
</figure>`;
}

async function buildEpub(grouped, selected) {
  // Fetch + process all plate images first (numbered globally in reading order).
  const readingOrder = [];
  for (const ch of grouped) for (const p of ch.plates) readingOrder.push(p);

  const imageFiles = []; // { name, buffer }
  let figNo = 0;
  const figNoByKey = new Map();
  console.log(`Fetching + processing ${readingOrder.length} plate images\u2026`);
  for (const p of readingOrder) {
    figNo++;
    figNoByKey.set(plateKey(p), figNo);
    try {
      const buf = await fetchAndProcessImage(p.extractedUrl || p.imageUrl);
      imageFiles.push({ name: `images/plate-${figNo}.jpg`, buffer: buf });
    } catch (e) {
      console.warn(`  ! plate ${figNo} image failed: ${e.message}`);
      figNoByKey.delete(plateKey(p));
      figNo--;
    }
  }

  // Cover: prefer a high-quality, roughly square cosmogram from macro/cosmogram/tree.
  const coverPlate =
    selected
      .filter(p => ['macro', 'cosmogram', 'tree'].includes(p._chapter))
      .filter(p => (p.aspect ?? 1) >= 0.6 && (p.aspect ?? 1) <= 1.15)
      .sort((a, b) => (b.galleryQuality ?? 0) - (a.galleryQuality ?? 0))[0] ||
    selected.sort((a, b) => (b.galleryQuality ?? 0) - (a.galleryQuality ?? 0))[0];
  console.log(`Building cover (from: ${coverPlate?.bookTitle})\u2026`);
  const coverBuffer = await buildCover(coverPlate);

  // Source books for the colophon.
  const books = new Map();
  for (const p of selected) {
    if (!books.has(p.bookId)) books.set(p.bookId, { title: p.bookTitle, author: p.author, year: p.year });
  }
  const bookList = [...books.values()].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  // XHTML documents.
  const docs = [];
  docs.push({ id: 'cover', href: 'cover.xhtml', title: 'Cover', linear: true,
    content: xhtml('Cover', 'cover', `<div style="text-align:center"><img src="images/cover.jpg" alt="Cover" style="max-width:100%;max-height:100vh"/></div>`) });

  docs.push({ id: 'title', href: 'title.xhtml', title: 'Title Page', linear: true,
    content: xhtml('Title', 'title-page', `<div class="title-page">
      <p class="brand">The Source Library Guide to</p>
      <h1>Esoteric Geometries</h1>
      <p class="subtitle">${escapeXml(SUBTITLE)}</p>
      <hr class="rule"/>
      <p class="brand">Source Library</p>
    </div>`) });

  const introBody = `<h1>On the Geometry of the Invisible</h1>
    <div class="frontmatter">
    <p>Long before geometry was a school subject it was a way of seeing. To the traditions gathered in this book \u2014 Pythagorean and Platonic, Hermetic and Kabbalistic, alchemical and magical \u2014 line and figure were not abstractions but the very grammar of creation. A circle could hold the cosmos; a square could bind a spirit; a lattice of numbers could carry the virtue of a planet.</p>
    <p>This guide gathers ${selected.length} such figures, drawn from ${bookList.length} works across the Source Library, and arranges them by theme. Each plate is reproduced from a digitized original and accompanied by a short description; a link returns you to the source page, where the whole book may be read. Nothing here is reconstructed or redrawn \u2014 these are the diagrams as their makers left them.</p>
    <p>Read them not as decoration but as arguments. Each was drawn to persuade the eye of an order it could not otherwise see.</p>
    </div>`;
  docs.push({ id: 'intro', href: 'intro.xhtml', title: 'Introduction', linear: true,
    content: xhtml('Introduction', 'frontmatter', introBody) });

  grouped.forEach((ch, i) => {
    const plates = ch.plates
      .map(p => {
        const fn = figNoByKey.get(plateKey(p));
        return fn ? plateCaption(p, fn) : '';
      })
      .filter(Boolean)
      .join('\n');
    const body = `<h1>${escapeXml(ch.title)}</h1>
      <p class="chapter-intro">${escapeXml(ch.intro)}</p>
      ${plates}`;
    docs.push({ id: `chap-${ch.id}`, href: `chap-${ch.id}.xhtml`, title: ch.title, linear: true,
      content: xhtml(ch.title, 'chapter', body) });
  });

  const colophonBody = `<h1>Colophon</h1>
    <div class="colophon">
    <p>This guide was assembled by the Source Library from illustrations already extracted and described by its image-analysis pipeline. Plates were selected by theme and quality, reproduced from digitized originals, and cited to their source works. Descriptions are editorial summaries generated during cataloguing; the diagrams themselves are unaltered facsimiles.</p>
    <p><strong>Source works (${bookList.length}):</strong></p>
    <ul>
    ${bookList.map(b => `<li>${escapeXml([b.title, b.author && `\u2014 ${b.author}`, b.year && `(${b.year})`].filter(Boolean).join(' '))}</li>`).join('\n')}
    </ul>
    <p style="margin-top:1.4em">Read the complete works at <a href="${CFG.base}">sourcelibrary.org</a>.</p>
    </div>`;
  docs.push({ id: 'colophon', href: 'colophon.xhtml', title: 'Colophon', linear: true,
    content: xhtml('Colophon', 'frontmatter', colophonBody) });

  // nav.xhtml (EPUB3)
  const navItems = docs
    .filter(d => !['cover'].includes(d.id))
    .map(d => `<li><a href="${d.href}">${escapeXml(d.title)}</a></li>`)
    .join('\n');
  const navDoc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${navItems}
</ol></nav>
</body></html>`;

  // toc.ncx (EPUB2 compat)
  const navPoints = docs
    .filter(d => !['cover'].includes(d.id))
    .map((d, i) => `<navPoint id="np-${i}" playOrder="${i + 1}"><navLabel><text>${escapeXml(d.title)}</text></navLabel><content src="${d.href}"/></navPoint>`)
    .join('\n');
  const uid = `urn:sourcelibrary:esoteric-geometries:${new Date().toISOString().slice(0, 10)}`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${escapeXml(TITLE)}</text></docTitle>
<navMap>
${navPoints}
</navMap></ncx>`;

  // content.opf
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    `<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`,
    ...docs.map(d => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`),
    ...imageFiles.map((f, i) => `<item id="img-${i}" href="${f.name}" media-type="image/jpeg"/>`),
  ].join('\n');
  const spine = docs.map(d => `<itemref idref="${d.id}"${d.linear ? '' : ' linear="no"'}/>`).join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="pub-id">${uid}</dc:identifier>
  <dc:title>${escapeXml(TITLE)}</dc:title>
  <dc:creator>Source Library</dc:creator>
  <dc:language>en</dc:language>
  <dc:description>${escapeXml(SUBTITLE)}</dc:description>
  <dc:publisher>Source Library</dc:publisher>
  <dc:date>${new Date().toISOString().slice(0, 10)}</dc:date>
  <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
${manifestItems}
</manifest>
<spine toc="ncx">
${spine}
</spine>
</package>`;

  // Assemble the ZIP.
  const zip = await new Promise((resolvePromise, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('data', c => chunks.push(c));
    archive.on('end', () => resolvePromise(Buffer.concat(chunks)));
    archive.on('error', reject);

    // mimetype MUST be first and stored (uncompressed).
    archive.append('application/epub+zip', { name: 'mimetype', store: true });
    archive.append(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
      { name: 'META-INF/container.xml' }
    );
    archive.append(opf, { name: 'OEBPS/content.opf' });
    archive.append(navDoc, { name: 'OEBPS/nav.xhtml' });
    archive.append(ncx, { name: 'OEBPS/toc.ncx' });
    archive.append(CSS, { name: 'OEBPS/styles.css' });
    archive.append(coverBuffer, { name: 'OEBPS/images/cover.jpg' });
    for (const d of docs) archive.append(d.content, { name: `OEBPS/${d.href}` });
    for (const f of imageFiles) archive.append(f.buffer, { name: `OEBPS/${f.name}` });
    archive.finalize();
  });

  return { zip, coverBuffer, figCount: figNo, bookCount: bookList.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const candidates = await gatherCandidates();
  console.log(`\nGathered ${candidates.length} unique candidate plates.`);

  const { grouped, selected } = curate(candidates);
  console.log(`\nCurated ${selected.length} plates across ${grouped.length} chapters:`);
  for (const ch of grouped) console.log(`  ${ch.plates.length.toString().padStart(3)}  ${ch.title}`);

  mkdirSync(CFG.out, { recursive: true });
  const manifest = {
    title: TITLE,
    generated_at: new Date().toISOString(),
    config: CFG,
    chapters: grouped.map(ch => ({
      id: ch.id,
      title: ch.title,
      plates: ch.plates.map(p => ({
        galleryId: plateKey(p),
        book: p.bookTitle,
        author: p.author,
        year: p.year,
        type: p.type,
        quality: p.galleryQuality,
        description: p.description,
        url: `${CFG.base}/gallery/image/${plateKey(p)}`,
      })),
    })),
  };
  writeFileSync(join(CFG.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest -> ${join(CFG.out, 'manifest.json')}`);

  if (CFG.manifestOnly) {
    console.log('--manifest-only: skipping EPUB build.');
    return;
  }

  const { zip, coverBuffer, figCount, bookCount } = await buildEpub(grouped, selected);
  const epubPath = join(CFG.out, 'esoteric-geometries.epub');
  const coverPath = join(CFG.out, 'cover.jpg');
  writeFileSync(epubPath, zip);
  writeFileSync(coverPath, coverBuffer);

  console.log(`\nDone. ${figCount} plates from ${bookCount} works.`);
  console.log(`  ${epubPath} (${(zip.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  ${coverPath} (${(coverBuffer.length / 1024).toFixed(0)} KB)`);
  console.log(`\nOpen the EPUB in a reader (or Kindle Previewer) to review.`);
}

main().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});
