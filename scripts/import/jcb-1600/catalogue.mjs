#!/usr/bin/env node
/**
 * JCB pre-1600 (#8049), stages 4+5: catalogue the imported books and write their New World tier.
 *
 * PRIOR ART: scripts/import/ia-campaign-curate.mjs (selection + manifest, no post-import catalogue);
 * scripts/maintenance/backfill-author-canonical-links.mjs and scripts/analysis/mint-local-work-ids.mjs
 * do author_id / work_id and are run with `--campaign jcb-1600-8049` beside this, not re-implemented here;
 * scripts/workers/identity-worker.mjs already stamped edition_key at insert. What is left is campaign-specific:
 * the bibliography numbers the JCB record itself carries, the tier → processing_priority + `new-world`,
 * and the catalogue table for the ops repo.
 *
 *   node --env-file=.env.production.local scripts/import/jcb-1600/catalogue.mjs \
 *     --tiers $JOB_SCRATCH/s5/tiers.jsonl --out $JOB_SCRATCH/s4 [--apply] [--extra-tier1 id,id]
 *
 * Writes (only with --apply, only on acquisition_campaign: jcb-1600-8049 books, plus --extra-tier1 ids):
 *   processing_priority   tier 1a=80, 1b=70, 2=50, 3=20
 *   collections           += 'new-world' for tier 1 and 2 ($addToSet; never removes)
 *   edition_external_ids  .alden / .sabin / .istc / .medina — only numbers the IA record's notes
 *                         state verbatim (JCB cataloguers cite them); with .source = 'ia-record-note'.
 * Never touches visibility, the hold, author, title or language. --extra-tier1 books get priority and
 * the tag only (they belong to another job's hold; the hold is left alone).
 * Emits <out>/catalogue.csv, catalogue.md, bib-ids.jsonl.
 */
import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';

const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const CAMPAIGN = 'jcb-1600-8049';
const OUT = arg('--out'); if (!OUT) { console.error('--out required'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const tiers = new Map(fs.readFileSync(arg('--tiers'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).map(t => [t.id, t]));
const EXTRA = (arg('--extra-tier1') || '').split(',').filter(Boolean);
const PRIORITY = { '1a': 80, '1b': 70, '2': 50, '3': 20 };

const BIB = {
  alden: /(?:European Americana|Alden)[^.;]{0,30}?\b(\d{3}\/\d{1,3})\b/i,
  sabin: /\bSabin\b[^.;\d]{0,10}(\d{3,6})\b/i,
  istc: /\b(i[a-z]\d{8})\b/,
  medina: /\bMedina\b[^.;\d]{0,40}(\d{1,4})\b/i,
};
export function bibIds(text) {
  const out = {};
  for (const [k, re] of Object.entries(BIB)) { const m = String(text || '').match(re); if (m) out[k] = m[1]; }
  return out;
}
/** "A Paris, : Chez Martin le Ieune, à l'enseigne …" → { place: 'Paris', printer: 'Chez Martin le Ieune' } */
export function placePrinter(pub) {
  const s = String(pub || '').replace(/\s+/g, ' ').trim();
  if (!s) return { place: '', printer: '' };
  const [a, ...rest] = s.split(/\s*:\s*/);
  const place = a.replace(/^(In|A|Ad|En|Em|Zu|Zů|Gedruckt zu|Getruckt zu|Impressum|Impressa|Stampata in|In inclyta|At|Tot|De|Gheprint|Gheprent|Impresso en|Impreso en)\s+/i, '').replace(/^T'/, '')
    .replace(/[[\]]/g, '').replace(/[,.;\s]+$/g, '').trim();
  // "Fue impressa … en Medina del Campo", "Impreso en Salamanca" → the town after the last preposition
  const tail = place.match(/\b(?:en|in|zu|zů|à|a|ad|em|te|tot|à)\s+((?:la |el )?[A-ZÇÁÉ][^,]*)$/);
  const printer = rest.join(': ').split(/,/)[0].replace(/[[\]]/g, '').replace(/[.:\s]+$/, '').trim();
  return { place: (tail ? tail[1] : place).trim(), printer };
}
const csvq = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const short = (t, n = 80) => { const s = String(t || '').replace(/\s+/g, ' ').split(/\s*[:;]\s/)[0]; return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const books = mc.db('bookstore').collection('books');
const docs = await books.find({ acquisition_campaign: CAMPAIGN }, { projection: {
  id: 1, title: 1, author: 1, author_id: 1, work_id: 1, edition_key: 1, year: 1, published: 1, language: 1, pages_count: 1, ia_identifier: 1,
  publisher: 1, 'dublin_core.dc_description': 1, 'catalog_metadata.description': 1, collections: 1, processing_priority: 1 } }).toArray();
const extra = EXTRA.length ? await books.find({ $or: [{ id: { $in: EXTRA } }, { _id: { $in: EXTRA.filter(ObjectId.isValid).map(x => new ObjectId(x)) } }] },
  { projection: { id: 1, title: 1, author: 1, author_id: 1, work_id: 1, edition_key: 1, year: 1, language: 1, pages_count: 1, ia_identifier: 1, publisher: 1, collections: 1, processing_priority: 1, pipeline_auto: 1 } }).toArray() : [];

const rows = []; const ops = []; const bibOut = []; const missingTier = [];
for (const b of [...docs, ...extra.map(e => ({ ...e, _extra: true }))]) {
  const t = b._extra ? { tier: 1, rank: 'a', why: 'Vespucci (#8046), tier 1 by brief' } : tiers.get(b.ia_identifier);
  if (!t) { missingTier.push(b.ia_identifier); continue; }
  const tierKey = t.tier === 1 ? `1${t.rank || 'a'}` : String(t.tier);
  const desc = [].concat(b.dublin_core?.dc_description || [], b.catalog_metadata?.description || []).join(' ');
  const ids = b._extra ? {} : bibIds(desc);
  const { place, printer } = placePrinter(b.publisher);
  const set = { processing_priority: PRIORITY[tierKey] };
  if (Object.keys(ids).length) { for (const [k, v] of Object.entries(ids)) set[`edition_external_ids.${k}`] = v; set['edition_external_ids.source'] = 'ia-record-note'; bibOut.push({ id: b.id, ia: b.ia_identifier, ...ids }); }
  const upd = { $set: set };
  if (t.tier <= 2) upd.$addToSet = { collections: 'new-world' };
  ops.push({ updateOne: { filter: { _id: b._id }, update: upd } });
  rows.push({ year: b.year ?? '', author: b.author || '', title: short(b.title), place, printer, language: b.language || '', pages: b.pages_count ?? '',
    link: `https://sourcelibrary.org/book/${b.id}`, ia: b.ia_identifier || '', tier: tierKey, why: t.why || '',
    author_id: b.author_id || '', work_id: b.work_id || '', edition_key: b.edition_key ? 'yes' : '', bib: Object.entries(ids).map(([k, v]) => `${k} ${v}`).join('; ') });
}
rows.sort((a, b) => a.tier.localeCompare(b.tier) || (a.year || 0) - (b.year || 0));
const cols = ['year', 'author', 'title', 'place', 'printer', 'language', 'pages', 'link', 'ia', 'tier', 'why', 'author_id', 'work_id', 'edition_key', 'bib'];
fs.writeFileSync(path.join(OUT, 'catalogue.csv'), [cols.join(','), ...rows.map(r => cols.map(c => csvq(r[c])).join(','))].join('\n') + '\n');
const md = [`# JCB pre-1600 acquisition (#8049): catalogue`, '', `${rows.length} books, generated ${new Date().toISOString().slice(0, 10)} by scripts/import/jcb-1600/catalogue.mjs. All hidden and held; links resolve for admins only until publication.`, '',
  'Tier 1a: about the Americas or the voyages; 1b: largely so; 2: cosmography, geography, history likely to treat the discoveries; 3: the rest.', '',
  '| Tier | Year | Author | Short title | Place | Printer | Lang | pp | Link |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.tier} | ${r.year} | ${r.author.replace(/\|/g, '/')} | ${r.title.replace(/\|/g, '/')} | ${r.place.replace(/\|/g, '/')} | ${r.printer.replace(/\|/g, '/')} | ${r.language} | ${r.pages} | [${r.ia}](${r.link}) |`)];
fs.writeFileSync(path.join(OUT, 'catalogue.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'bib-ids.jsonl'), bibOut.map(x => JSON.stringify(x)).join('\n') + '\n');
const count = (f) => rows.reduce((m, r) => (m[r[f]] = (m[r[f]] || 0) + 1, m), {});
console.log(JSON.stringify({ books: docs.length, extra: extra.length, rows: rows.length, missingTier, tiers: count('tier'), withBibIds: bibOut.length,
  withAuthorId: rows.filter(r => r.author_id).length, withWorkId: rows.filter(r => r.work_id).length, withEditionKey: rows.filter(r => r.edition_key).length }, null, 1));
if (APPLY && ops.length) { const r = await books.bulkWrite(ops, { ordered: false }); console.log(`applied: matched ${r.matchedCount}, modified ${r.modifiedCount}`); }
else console.log(`dry run: ${ops.length} updates staged`);
await mc.close();
