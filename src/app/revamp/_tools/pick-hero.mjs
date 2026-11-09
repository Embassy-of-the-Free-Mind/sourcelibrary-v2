// Measures the best pictures in a collection at full size, so a maker can only pick a hero
// picture that is sharp enough for it. Writes _data/snap/_hero.json: per collection, up to 24
// candidates with their real pixel size. GET only, public image URLs, one at a time.
// Run: node src/app/revamp/_tools/pick-hero.mjs alchemy alchemical-emblem beguine-mystics
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SNAP = path.join(process.cwd(), 'src/app/revamp/_data/snap');
const OUT = path.join(SNAP, '_hero.json');
const NOT_COVER = /initial|letter|ornament|headpiece|tailpiece|fleuron|border|frame|scrollwork|cartouche|binding|cover|spine|title.?page|endpaper|bookplate|ex.?libris|stamp|seal|blank|printer'?s (mark|device)|colophon|text block|page of text/i;
const BAD_KIND = /decorative|symbol|exlibris|unknown|document/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

for (const slug of process.argv.slice(2)) {
  const snap = JSON.parse(fs.readFileSync(path.join(SNAP, `${slug}.json`), 'utf8'));
  const items = (snap.g?.items ?? [])
    .filter((i) => i.extractedUrl && !BAD_KIND.test(String(i.type || '')) && !NOT_COVER.test(`${i.type || ''} ${i.description || ''}`))
    .sort((a, b) => (Number(b.galleryQuality) || 0) - (Number(a.galleryQuality) || 0))
    .slice(0, 24);
  const list = [];
  for (const i of items) {
    try {
      const r = await fetch(i.extractedUrl, { headers: { 'User-Agent': 'sourcelibrary-revamp' } });
      if (!r.ok) continue;
      const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      const id = i.id || (i.pageId ? `${i.pageId}-${i.detectionIndex ?? 0}` : '');
      list.push({ src: i.extractedUrl, thumb: i.cardUrl || i.thumbnailUrl || i.extractedUrl, w: m.width, h: m.height, label: String(i.bookTitle || '').slice(0, 70), href: id ? `/gallery/image/${id}` : undefined });
    } catch { /* skip */ }
    await sleep(300);
  }
  out[slug] = list;
  console.log(slug, list.length, 'measured;', list.filter((c) => c.w >= 1300 || c.h >= 1300).map((c) => `${c.w}x${c.h}`).join(' '));
}
fs.writeFileSync(OUT, JSON.stringify(out));
