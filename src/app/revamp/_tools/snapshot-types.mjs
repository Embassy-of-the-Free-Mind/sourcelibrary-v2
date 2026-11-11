// Read-only: picture types (/api/gallery?type=) and text types (/api/books/facets?form=) saved in the
// collection snapshot shape, for the prototype's type pages. One request every 5 s.
import fs from 'node:fs';
const SNAP = new URL('../_data/snap/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after') || 60)) * 1000 + 2000); continue; }
    await sleep(5000);
    if (r.ok) return r.json();
    console.log('status', r.status, url);
  }
  return null;
}
const out = { pictures: [], texts: [] };
for (const t of ['engraving', 'woodcut', 'diagram', 'emblem', 'portrait', 'frontispiece', 'map', 'decorative', 'symbol']) {
  const g = await get(`https://sourcelibrary.org/api/gallery?type=${t}&limit=60&maxPerBook=3`);
  if (!g) continue;
  const slug = `type-picture-${t}`;
  fs.writeFileSync(new URL(`${slug}.json`, SNAP), JSON.stringify({ c: { collection: { slug, name: t, plates_only: true }, books: [], total: 0 }, g: { items: g.items, total: g.total } }));
  out.pictures.push({ id: t, slug, total: g.total });
  console.log(slug, g.total);
}
for (const f of ['treatise', 'encyclopedia', 'commentary', 'manual', 'letters', 'poetry', 'dialogue', 'anthology', 'polemic', 'scripture', 'biography', 'history', 'catalog']) {
  const d = await get(`https://sourcelibrary.org/api/books/facets?form=${f}&limit=60`);
  if (!d) continue;
  const slug = `type-text-${f}`;
  const books = d.books.map((b) => ({ ...b, id: b._id, year: parseInt(b.published, 10) || undefined }));
  fs.writeFileSync(new URL(`${slug}.json`, SNAP), JSON.stringify({ c: { collection: { slug, name: f }, books, total: d.total }, g: { items: [], total: 0 } }));
  out.texts.push({ id: f, slug, total: d.total });
  console.log(slug, d.total);
}
fs.writeFileSync(new URL('_types.json', SNAP), JSON.stringify(out));
console.log('done');
