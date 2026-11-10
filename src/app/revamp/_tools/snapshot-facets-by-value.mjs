// Read-only top-up for _facets.json: the plain list times out past about 10,000 books, so this walks
// each era and each text type on its own (smaller lists). One request every 8 seconds; waits on 429;
// gives up on a page after 3 server errors rather than retrying forever.
import fs from 'node:fs';
const OUT = new URL('../_data/snap/_facets.json', import.meta.url);
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VALUES = {
  era: ['early-modern', 'renaissance', 'modern', 'ancient', 'medieval', 'late-antique', 'enlightenment'],
  form: ['treatise', 'anthology', 'manual', 'commentary', 'poetry', 'encyclopedia', 'polemic', 'letters', 'scripture', 'dialogue', 'biography', 'history', 'catalog'],
};
for (const [facet, values] of Object.entries(VALUES)) for (const v of values) {
  let page = 1, pages = Infinity, fails = 0;
  while (page <= pages) {
    const r = await fetch(`https://sourcelibrary.org/api/books/facets?${facet}=${v}&limit=200&page=${page}`);
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after') || 60)) * 1000 + 2000); continue; }
    if (!r.ok) { console.log('status', r.status, facet, v, page); if (++fails >= 3) { page++; fails = 0; } await sleep(20000); continue; }
    const d = await r.json(); pages = d.pages; fails = 0;
    for (const b of d.books) {
      const t = b.faceted_tags || {};
      const o = out[b._id] ??= { form: [], era: [], material: null };
      o.form = [...new Set([...(o.form || []), ...(t.form || [])])];
      o.era = [...new Set([...(o.era || []), ...(t.era || [])])];
      o.material ??= t.material_type || null;
    }
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`${facet}=${v} page ${page}/${pages}, ${Object.keys(out).length} books`);
    page++;
    await sleep(8000);
  }
}
console.log('done');
