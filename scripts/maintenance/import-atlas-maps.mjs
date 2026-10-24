#!/usr/bin/env node
// PRIOR ART: sourcelibrary-atlas scripts/build-ritual.mjs + scripts/map-pipeline/refresh-theme-data.mjs — they BUILD
//   the artifacts from the survey reports on Derek's laptop scratchpad, which this box does not have; this script only
//   copies their output into this repo (#4922: "artifacts first, schedule later"). Looked in scripts/maintenance,
//   scripts/audit, scripts/lib for an existing atlas/map importer: none (build-map-cache.mjs is the entity map).
//
// Copy the atlas's map artifacts into sourcelibrary (#4922):
//   - Map of Ritual: src/content/ritual.json → src/app/explore/maps/ritual/ritual.json. Every book link is re-checked
//     against `books` (read-only, by `id`, then `_id` for re-minted ids): its status dot is recomputed, links go
//     same-host (/book/<id>), and a book that is hidden or gone loses its link (a hidden book 404s for readers).
//     The summary table, per-tradition counts and the "how to read it" figures are recomputed from the same check.
//   - Timeline maps: public/data/<theme>.json, <theme>-l2.json, graph/lens-<theme>.json → public/data/maps/.
//     The level-2, lens and layers files are copied verbatim; in <theme>.json an edition that is no longer public is
//     marked so (the map names hidden editions without a link). src/app/explore/maps/summary.json gets the counts.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/import-atlas-maps.mjs \
//     --atlas /path/to/sourcelibrary-atlas [--theme consciousness,ritual] [--dry-run]
// --theme names the maps to import; `ritual` is the survey document. The default is ritual,consciousness. summary.json
// keeps the figures of every map not imported this run (#7129: importing one map must not drop the others' cards).
import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const argv = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ATLAS = argv('--atlas');
const THEMES = (argv('--theme', 'ritual,consciousness')).split(',').filter((t) => t !== 'ritual');
const RITUAL = (argv('--theme', 'ritual,consciousness')).split(',').includes('ritual');
const DRY = process.argv.includes('--dry-run');
if (!ATLAS) { console.error('usage: import-atlas-maps.mjs --atlas <sourcelibrary-atlas checkout> [--theme a,b] [--dry-run]'); process.exit(1); }
const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const today = new Date().toISOString().slice(0, 10);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Replace exactly one match, or fail: a silent no-op here would ship stale numbers. */
function once(s, re, to, what) {
  const n = (s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;
  if (n !== 1) throw new Error(`${what}: expected 1 match, found ${n}`);
  return s.replace(re, to);
}

async function lookup(db, ids) {
  const proj = { _id: 1, id: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 };
  const rows = await db.collection('books').find({ id: { $in: ids } }, { projection: proj }).toArray();
  const by = new Map(rows.map((b) => [b.id, b]));
  // books.id first; a re-minted book is reachable by its _id only (book-deletion-and-identity.md)
  const rest = ids.filter((id) => !by.has(id));
  if (rest.length) {
    const oids = rest.filter((id) => /^[0-9a-f]{24}$/.test(id)).map((id) => new ObjectId(id)); // UUID ids have no _id twin
    const more = oids.length ? await db.collection('books').find({ _id: { $in: oids } }, { projection: proj }).toArray() : [];
    for (const b of more) by.set(String(b._id), b);
  }
  return by;
}

// ---- Map of Ritual -------------------------------------------------------------------------------------------
async function ritual(db) {
  const src = JSON.parse(fs.readFileSync(path.join(ATLAS, 'src/content/ritual.json'), 'utf8'));
  let body = src.body;
  const idRe = /<a class="bk st-[a-z]+" href="https:\/\/sourcelibrary\.org\/book\/([0-9a-f]{24})" title="([^"]*)"><span class="dot"><\/span>([0-9a-f]{6})<\/a>/g;
  const ids = [...new Set([...body.matchAll(idRe)].map((m) => m[1]))];
  const by = await lookup(db, ids);
  // same classes as build-ritual.mjs; 'gone' is new: the id no longer resolves
  const cls = (id) => { const b = by.get(id); if (!b) return 'gone'; const c = b.pages_count || 0, t = b.pages_translated || 0, o = b.pages_ocr || 0;
    if (b.visible !== true) return 'hidden'; if (c > 0 && t / c >= 0.9) return 'readable'; if (t > 0 || o > 0) return 'partial'; return 'images'; };
  const before = {}; for (const m of src.body.matchAll(idRe)) { const k = m[0].match(/st-([a-z]+)/)[1]; before[k] = (before[k] || 0) + 1; }
  body = body.replace(idRe, (_, id, title, short) => {
    const k = cls(id);
    if (k === 'hidden' || k === 'gone') return `<span class="bk st-hidden" title="${title} (not yet public)"><span class="dot"></span>${short}</span>`;
    const href = `/book/${by.get(id).id || id}`;
    return `<a class="bk st-${k}" href="${href}" title="${title}"><span class="dot"></span>${short}</a>`;
  });
  // the reports' "URL: https://sourcelibrary.org/book/<id>" line linked a bare /book/
  body = body.replace(/<a href="https:\/\/sourcelibrary\.org\/book\/">https:\/\/sourcelibrary\.org\/book\/<\/a>/g, 'sourcelibrary.org/book/');
  if (/href="https:\/\/sourcelibrary\.org/.test(body)) throw new Error('ritual: an absolute sourcelibrary.org link survived');

  // per-tradition and total stats, recomputed from the check
  const blank = () => ({ n: 0, readable: 0, partial: 0, hidden: 0, images: 0, pages: 0, translated: 0 });
  const add = (s, id) => { const k = cls(id); const b = by.get(id); s.n++; s[k === 'gone' ? 'hidden' : k]++; s.pages += b?.pages_count || 0; s.translated += b?.pages_translated || 0; };
  const secRe = /<section class="trad" id="([a-z]+)">([\s\S]*?)<\/section>/g;
  const stats = {}; const tot = blank(); const all = new Set();
  for (const m of src.body.matchAll(secRe)) { const s = blank(); for (const id of new Set([...m[2].matchAll(idRe)].map((x) => x[1]))) { add(s, id); all.add(id); } stats[m[1]] = s; }
  for (const id of all) add(tot, id);
  const bar = (s) => { const w = (k) => (100 * s[k] / s.n).toFixed(1); return `<div class="bar" role="img" aria-label="${s.readable} readable, ${s.partial} partly readable, ${s.hidden} held not public, ${s.images} images only">
  <span class="seg seg-readable" style="width:${w('readable')}%"></span><span class="seg seg-partial" style="width:${w('partial')}%"></span><span class="seg seg-hidden" style="width:${w('hidden')}%"></span><span class="seg seg-images" style="width:${w('images')}%"></span></div>`; };
  // table rows: keep each row's label cell, rewrite the numbers
  body = body.replace(/<tr><th scope="row"><a href="#([a-z]+)">([\s\S]*?)<\/th><td class="num">[\s\S]*?<\/tr>/g, (row, key, label) => {
    const s = stats[key]; if (!s) throw new Error(`ritual: no stats for table row ${key}`);
    return `<tr><th scope="row"><a href="#${key}">${label}</th><td class="num">${fmt(s.n)}</td><td class="barcell">${bar(s)}</td><td class="num">${fmt(s.readable)}</td><td class="num">${fmt(s.partial)}</td><td class="num">${fmt(s.hidden)}</td><td class="num">${fmt(s.pages)}</td></tr>`;
  });
  body = once(body, /<tfoot>[\s\S]*?<\/tfoot>/, `<tfoot><tr><th scope="row">All traditions (distinct books)</th><td class="num">${fmt(tot.n)}</td><td class="barcell">${bar(tot)}</td><td class="num">${fmt(tot.readable)}</td><td class="num">${fmt(tot.partial)}</td><td class="num">${fmt(tot.hidden)}</td><td class="num">${fmt(tot.pages)}</td></tr></tfoot>`, 'tfoot');
  body = body.replace(/(<section class="trad" id="([a-z]+)">[\s\S]*?)<p class="counts">[\s\S]*?<\/p>\n<div class="bar"[\s\S]*?<\/div><\/header>/g, (_, head, key) => {
    const s = stats[key];
    return `${head}<p class="counts"><span><b>${fmt(s.n)}</b> books cited</span><span><b>${fmt(s.readable)}</b> readable</span><span><b>${fmt(s.partial)}</b> partly</span><span><b>${fmt(s.hidden)}</b> held, not public</span><span><b>${fmt(s.pages)}</b> pages held</span></p>
${bar(s)}</header>`;
  });

  // reader copy: the date the dots were checked, and the working-paper sentences addressed to the team
  const checked = new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  body = once(body, /<p class="sub">Surveyed 9 Sep 2026<\/p>/, `<p class="sub">Surveyed 9 Sep 2026<br>Status checked ${checked}</p>`, 'rail date');
  body = once(body, /<p><b>How to read it\.<\/b>[\s\S]*?<\/p>/,
    `<p><b>How to read it.</b> "Readable" means the book is public and at least nine pages in ten are translated. "Partly" means public with some of its text transcribed or translated. "Held, not yet public" means the library has the book but it cannot be opened yet, most often a library scan that has not been transcribed: ${fmt(tot.hidden)} of the ${fmt(tot.n)} cited books. Those entries are not links. The dots were checked against the catalogue on ${checked}.</p>`, 'how to read it');
  body = once(body, / Nothing was written to the database\./, '', 'method: database sentence');
  body = once(body, /<li><a href="#proposal">Proposed tagging<\/a><\/li>/, '', 'rail: proposal link');
  body = once(body, /\n<section class="proposal" id="proposal">[\s\S]*?<\/section>/, '', 'proposal section');

  const after = {}; for (const m of body.matchAll(/class="bk st-([a-z]+)"/g)) after[m[1]] = (after[m[1]] || 0) + 1;
  const gone = ids.filter((id) => !by.has(id));
  console.log('ritual: ids', ids.length, 'resolved', by.size, 'gone', gone.length, gone.slice(0, 5), '\n  chips before', before, '\n  chips after ', after, '\n  total', tot);
  const out = { generated: src.generated, checked: today, style: src.style, body, stats: tot };
  const dest = path.join(REPO, 'src/app/explore/maps/ritual/ritual.json');
  if (!DRY) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(out)); console.log('  wrote', dest, (fs.statSync(dest).size / 1e6).toFixed(2), 'MB'); }
  return { checked: today, books: tot.n, readable: tot.readable, partial: tot.partial, hidden: tot.hidden };
}

// ---- timeline maps -------------------------------------------------------------------------------------------
const isReadable = (e) => e.v && e.pc > 0 && ((e.tt / e.pc) >= 0.8 || (/english/i.test(e.l) && (e.o / e.pc) >= 0.8)); // refresh-theme-data.mjs
const statusOf = (w) => w.eds.length ? (w.eds.some(isReadable) ? 'readable' : w.eds.some((e) => e.v && e.pc > 0) ? 'visible' : 'hidden') : w.st;
const SUMMARY = path.join(REPO, 'src/app/explore/maps/summary.json');
const summary = fs.existsSync(SUMMARY) ? JSON.parse(fs.readFileSync(SUMMARY, 'utf8')) : {};
async function theme(db, slug) {
  const destDir = path.join(REPO, 'public/data/maps');
  const d = JSON.parse(fs.readFileSync(path.join(ATLAS, `public/data/${slug}.json`), 'utf8'));
  const ids = [...new Set(d.works.flatMap((w) => w.eds.map((e) => e.id)))];
  const by = await lookup(db, ids);
  // Only one direction is applied: an edition the artifact calls public that is no longer public loses its
  // link (its page 404s). Upgrades wait for the atlas's own refresh, which also rebuilds the level-2 panels.
  let hidden = 0; const moved = [];
  for (const w of d.works) {
    for (const e of w.eds) if (e.v && by.get(e.id)?.visible !== true) { e.v = false; e.rd = false; hidden++; }
    const st = statusOf(w); if (st !== w.st) { moved.push(`${w.n}: ${w.st} -> ${st}`); w.st = st; }
  }
  console.log(`${slug}: works`, d.works.length, 'editions', ids.length, 'resolved', by.size, 'no longer public', hidden, 'works moved', moved);
  const core = d.works.filter((w) => !w.adj);
  summary[slug] = { generated: d.generated, works: core.length, readable: core.filter((w) => w.st === 'readable').length,
    absent: core.filter((w) => w.st === 'absent').length, editions: ids.length };
  if (DRY) return;
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, `${slug}.json`), JSON.stringify(d));
  for (const [from, to] of [[`public/data/${slug}-l2.json`, `${slug}-l2.json`], [`public/data/graph/lens-${slug}.json`, `lens-${slug}.json`], [`public/data/${slug}-layers.json`, `${slug}-layers.json`]]) {
    const p = path.join(ATLAS, from);
    if (!fs.existsSync(p)) { console.log('  (no', from + ')'); continue; }
    fs.copyFileSync(p, path.join(destDir, to)); console.log('  copied', to, (fs.statSync(p).size / 1e3).toFixed(0), 'KB');
  }
}

await withMongo(async (db) => {
  if (RITUAL) summary.ritual = await ritual(db);
  for (const t of THEMES) await theme(db, t);
});
// the /explore/maps index reads its card figures from here, not from the megabyte artifacts
if (!DRY) fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1) + '\n');
