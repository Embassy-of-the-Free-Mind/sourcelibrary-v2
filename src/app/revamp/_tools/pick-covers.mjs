// Picks each collection's square cover by looking at the pictures themselves.
// For every collection: up to 8 candidates (best gallery crops, else pages from inside its books),
// each downloaded small, rejected if blank or a flat cover, then given a "smart" square crop
// (sharp's attention strategy: the most striking region). Writes _data/snap/_covers.json.
// Run: node src/app/revamp/_tools/pick-covers.mjs   (reads only public image URLs)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SNAP = path.join(process.cwd(), 'src/app/revamp/_data/snap');
const OUT = path.join(SNAP, '_covers.json');
const NOT_COVER = /initial|letter|ornament|headpiece|tailpiece|fleuron|border|frame|scrollwork|cartouche|binding|cover|spine|title.?page|endpaper|bookplate|ex.?libris|stamp|seal|blank|printer'?s (mark|device)|colophon|text block|page of text/i;
const BAD_KIND = /decorative|symbol|exlibris|unknown|document/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuf(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-revamp' } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(1500);
  }
  return null;
}

/** null when the picture is blank paper or one flat colour; else a square crop and a detail score. */
async function judge(url) {
  const buf = await fetchBuf(url);
  if (!buf) return null;
  const img = sharp(buf);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) return null;
  const st = await sharp(buf).greyscale().resize(200, 200, { fit: 'inside' }).stats();
  const detail = st.channels[0].stdev; // blank paper ~5-15, flat bound covers ~15-25, plates 40+
  if (detail < 28) return null;
  const side = Math.min(meta.width, meta.height);
  const { info } = await sharp(buf).resize(side, side, { fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
  const aspect = meta.width / meta.height;
  return { src: url, detail, aspect, crop: { x: -(info.cropOffsetLeft ?? 0) / meta.width, y: -(info.cropOffsetTop ?? 0) / meta.height, w: side / meta.width, aspect } };
}

// Hand-written plate filters from authored.ts (e.g. Slime Moulds keeps only slime-mould plates).
const AUTH = fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_data/authored.ts'), 'utf8');
function plateFilter(slug) {
  const block = AUTH.split(/\n  '?([a-z-]+)'?: \{/);
  const i = block.indexOf(slug);
  if (i < 0) return null;
  const body = block[i + 1] || '';
  const pm = body.match(/plateMatch: '([^']+)'/);
  const wm = body.match(/wholeBookMatch: '([^']+)'/);
  if (!pm) return null;
  const rx = new RegExp(pm[1], 'i'); const whole = wm ? new RegExp(wm[1], 'i') : null;
  return (it) => rx.test(String(it.description || '')) || (whole?.test(String(it.bookTitle || '')) ?? false);
}

function candidates(snap, slug) {
  const keep = plateFilter(slug);
  const items = (snap.g?.items || snap.items || []).filter((i) => !keep || keep(i));
  const pics = items
    .filter((i) => {
      const a = Number(i.aspect) || 0;
      return (i.cardUrl || i.extractedUrl) && a > 0.5 && a < 2 && !BAD_KIND.test(String(i.type || '')) && !NOT_COVER.test(`${i.type || ''} ${i.description || ''}`);
    })
    // Near-square pictures lose least to a square crop.
    .map((i) => ({ url: i.cardUrl || i.extractedUrl, score: (Number(i.galleryQuality) || 0) - Math.abs(Math.log(Number(i.aspect) || 1)) * 0.5 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url);
  // Text-only collections: a page from inside each book, past covers and blank leaves.
  const pages = (snap.c?.books || []).slice(0, 6).map((b) => {
    const t = String(b.thumbnail || '');
    const n = Math.max(8, Math.round((b.pages_count || 40) * 0.3));
    const a = t.match(/\/archived\/([^/]+)\/\d+\.jpg/);
    if (a) return `https://images.sourcelibrary.org/archived/${a[1]}/${n}.jpg`;
    const p = t.match(/\/pages\/([^/]+)\/\d+\.jpg/);
    if (p) return `https://images.sourcelibrary.org/pages/${p[1]}/${String(n).padStart(4, '0')}.jpg`;
    return t || null;
  }).filter(Boolean);
  // Artwork collections keep their pictures on the collection record.
  const art = ((snap.c?.collection?.featured_images) || []).map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);
  return [...new Set([...pics.slice(0, 6), ...art.slice(0, 6), ...pages])].slice(0, 10);
}

const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const files = fs.readdirSync(SNAP).filter((f) => f.endsWith('.json') && (!f.startsWith('_') || f.startsWith('_set-')));
for (const f of files) {
  const slug = f.replace(/^_set-/, '').replace(/\.json$/, '');
  if (out[slug]?.length && !process.argv.includes(slug)) continue;
  const snap = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8'));
  const good = [];
  for (const url of candidates(snap, slug)) {
    const j = await judge(url).catch(() => null);
    if (j) good.push(j);
    if (good.length >= 4) break;
    await sleep(150);
  }
  out[slug] = good;
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(slug, good.length, good.map((g) => Math.round(g.detail)).join(','));
}
console.log('done');
