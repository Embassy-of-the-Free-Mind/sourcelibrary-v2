// Read-only: saves centuries (by the year each work was written) and languages in the same shape as
// a collection snapshot, so the prototype's subject page can show them. Public APIs only:
// /api/books/library (work_from/work_to, language) and /api/gallery?book=. One request every 4 s; a saved period or language is not fetched again.
import fs from 'node:fs';
const SNAP = new URL('../_data/snap/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let tries = 0; tries < 4; tries++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after') || 60)) * 1000 + 2000); continue; }
    await sleep(4000);
    if (r.ok) return r.json();
    console.log('status', r.status, url);
  }
  return null;
}
const PER = 60, PICS = 16;
async function save(slug, name, q) {
  const file = new URL(`${slug}.json`, SNAP);
  if (fs.existsSync(file)) { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return { slug, name, total: d.c.total }; }
  const lib = await get(`https://sourcelibrary.org/api/books/library?${q}&limit=${PER}`);
  if (!lib || !lib.total) { console.log('empty', slug); return null; }
  const items = [];
  for (const b of lib.books.slice(0, 5)) {
    if (items.length >= PICS) break;
    const g = await get(`https://sourcelibrary.org/api/gallery?book=${b.id}&limit=6`);
    if (g?.items) items.push(...g.items.slice(0, 6));
  }
  const snap = { c: { collection: { slug, name }, books: lib.books, total: lib.total }, g: { items, total: items.length } };
  fs.writeFileSync(new URL(`${slug}.json`, SNAP), JSON.stringify(snap));
  console.log(slug, lib.total, 'books,', items.length, 'pictures');
  return { slug, name, total: lib.total };
}
const out = { centuries: [], languages: [] };
const which = process.argv[2] || 'both';
if (which !== 'centuries') for (const l of ['Latin', 'Chinese', 'German', 'English', 'French', 'Tibetan', 'Greek', 'Italian', 'Hebrew', 'Dutch', 'Sanskrit', 'Arabic']) {
  const r = await save(`language-${l.toLowerCase()}`, l, `language=${encodeURIComponent(l)}`);
  if (r) out.languages.push(r);
  fs.writeFileSync(new URL('_axes.json', SNAP), JSON.stringify(out));
}
if (which !== 'languages') for (let c = -2600; c <= 1900; c += 100) {
  // BCE spans run 500–401 BCE (from -500 to -401); CE spans 1500–1599.
  const from = c < 0 ? c : Math.max(c, 1), to = c < 0 ? c + 99 : c + 99;
  const slug = c < 0 ? `period-bce-${-c}` : `period-${c}`;
  const name = c < 0 ? `${-c}–${-(c + 99)} BCE` : `${Math.max(c, 1)}–${c + 99}`;
  const r = await save(slug, name, `work_from=${from}&work_to=${to}`);
  if (r) out.centuries.push({ ...r, from, to });
  fs.writeFileSync(new URL('_axes.json', SNAP), JSON.stringify(out));
}
console.log('done');
