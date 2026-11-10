// Read-only: saves form and era tags for every tagged book from the public /api/books/facets list.
// One request every 8 seconds; waits on 429. Output: _data/snap/_facets.json { id: { form: [], era: [] } }.
import fs from 'node:fs';
const OUT = new URL('../_data/snap/_facets.json', import.meta.url);
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = Number(process.argv[2] || 1), pages = Infinity;
while (page <= pages) {
  const r = await fetch(`https://sourcelibrary.org/api/books/facets?limit=200&page=${page}`);
  if (r.status === 429) { const s = Number(r.headers.get('retry-after') || 60); console.log('429, waiting', s); await sleep(s * 1000 + 2000); continue; }
  if (!r.ok) { console.log('status', r.status, 'page', page); await sleep(30000); continue; }
  const d = await r.json();
  pages = d.pages;
  for (const b of d.books) { const t = b.faceted_tags || {}; out[b._id] = { form: t.form || [], era: t.era || [], material: t.material_type || null }; }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`page ${page}/${pages}, ${Object.keys(out).length} books`);
  page++;
  await sleep(8000);
}
console.log('done');
