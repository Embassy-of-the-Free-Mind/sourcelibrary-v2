#!/usr/bin/env node
/**
 * #7144 — three books adjudicated BY HAND from their own leaves (image opened) and their source records, found by
 * the harmony census (#7117). Approved by Derek 2026-10-22.
 *
 * PRIOR ART: scripts/maintenance/repair-pharar-author-2026-09-24.mjs — the shape copied here (book-keyed hand repair,
 * backup + --revert, field_provenance, sweep_log, derived lane, books_catalog mirror). It repairs one byline; these
 * three are whole-record re-cataloguings (title, author, work, imprint, derived prose). Imprint fields go through
 * setCatalogueFields() (scripts/lib/catalogue-fields.mjs, #6327) as correct-imprint-from-titlepage.mjs does; that CLI
 * writes `published = String(year)`, which cannot express a manuscript's date range, so it is not called directly.
 *
 *   69bfcd228ab50eb88e8c7d27  Bodleian MS. Barocci 50.2, served as "Arabic Grammar". The page-1 OCR misread the
 *       spine label "GRAMMATICA VARIA … MS. Barocci 50.2" as "GRAMMATICA ARABICA … Barocci 202" and title enrichment
 *       took it from there. fol. 210r (p. 7) opens "† Ἐπιμερισμοὶ κατὰ στοιχεῖον γραφικά †". Bodleian TEI:
 *       origDate 900–950, origPlace Constantinople. Year 1050 (AI estimate) → 925 within `published` 901–950.
 *   69af12750092756351e44aac  catalogued as Ricci's 乾坤體義 (1608). The scan is LoC 2021666380 / wdl_11400,
 *       "Li Zhuowu xian sheng pi ping San guo zhi" (Luo Guanzhong, with Li Zhi's commentary), vol. 1 of 32:
 *       prefaces, contents, chapters 1–4 (p. 70 heads "李卓吾先生批評三國志"). LoC dates the set 1368–1644 (Ming);
 *       a Li Zhuowu commentary edition cannot precede c. 1600 (Li Zhi d. 1602), so 1600–1644.
 *   695592ca7bd6d2cd1d61b2d0  Della Porta, German, catalogued 1607 (a regex year + a 0.6 word-overlap USTC match;
 *       USTC stops at 1650). Title page (p. 11): "NURNBERG / Bey Johann Ziegers seel. Wittwe / 1713."
 *
 * Writes (books keyed on `id`; Della Porta's `_id` differs from its `id`):
 *   books          the fields in PLAN below, each identity field with a field_provenance stamp + history entry;
 *                  imprint via setCatalogueFields; edition_key etc. recomputed by computeIdentityFields.
 *   book_indexes   bookSummary unset where it describes another work (it is merged over books.index on read).
 *   books_catalog  (Supabase) the mirrored columns.
 *   field_provenance + sweep_log rows; backup merged on id (earliest `before` wins).
 * Not touched: page text, first-translation fields (their own lane — reported on #7144), quality_score, Zenodo.
 *
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-7144.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-7144.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-7144.mjs --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'repair-catalogue-7144';
const SCRIPT = 'scripts/maintenance/repair-catalogue-7144.mjs';
const BACKUP = join(HERE, 'backups', `${RUN}.json`);
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const NOW = new Date();
const BY = 'Claude (job fix-catalogue-7144), fix approved by Derek 2026-10-22';
const stampFor = (evidence) => ({
  source: 'hand-adjudicated', method: 'title page read by image', script: SCRIPT, by: BY, issue: '#7144', date: NOW, evidence,
});

const BAROCCI_EV = {
  pages: [1, 7], as_read: 'spine (p. 1): "GRAMMATICA VARIA … FOLIOS …-387 … MS. Barocci 50.2"; fol. 210r (p. 7): "† ΕΠΙΜΕΡΙΣΜΟΙ ΚΑΤΑ ΣΤΟΙΧΕΙΟΝ ΓΡΑΦΙΚΑ †"',
  source_record: 'https://github.com/bodleian/medieval-mss/blob/master/collections/Barocci/MS_Barocci_50.xml (origDate notBefore 0900 notAfter 0950; origPlace Byzantine, Constantinople); IIIF c0103bc3-f752-4563-bd4b-3e5a2be393ae',
};
const SANGUO_EV = {
  pages: [4, 9, 70], as_read: 'p. 4 "序批評三國志通俗演義"; p. 9 "東原羅貫中以平陽陳壽傳…目之曰三國志通俗演義"; p. 70 "李卓吾先生批評三國志" over 第一回',
  source_record: 'https://www.loc.gov/item/2021666380/ — "Li Zhuowu xian sheng pi ping san guo zhi", Li Zhuowu & Luo Guanzhong, 1368–1644, 32 v. (wdl_11400); vol. 1 is https://www.loc.gov/resource/gdcwdl.wdl_11400_001/',
};
const PORTA_EV = {
  pages: [11], as_read: 'Des vortrefflichen Herrn JOHANN BAPTISTA PORTÆ von Neapolis MAGIA NATURALIS, Oder: Hauß- Kunst- und Wunder-Buch … heraus gegeben durch Christian PEGANIUM, sonst Rautner genannt. NURNBERG / Bey Johann Ziegers seel. Wittwe / 1713.',
  source_record: 'https://archive.org/details/b30542170 (date 1713; Wellcome Library copy)',
};

/**
 * Per book: `set` (identity fields get a provenance stamp), `raw` ($set without a stamp: derived or bookkeeping),
 * `unset`, `imprint` (setCatalogueFields), `supabase` extra columns, `indexUnset` (book_indexes).
 */
const PLAN = [
  {
    id: '69bfcd228ab50eb88e8c7d27', evidence: BAROCCI_EV,
    set: {
      display_title: 'Byzantine Grammatical and Poetical Miscellany (Bodleian MS. Barocci 50, part 2)',
      english_title: 'Byzantine Grammatical and Poetical Miscellany (Bodleian MS. Barocci 50, part 2)',
      description: 'A Greek manuscript copied in Constantinople in the first half of the tenth century: the second part of Bodleian MS. Barocci 50 (fols. 210–387). It gathers grammatical and lexical texts (alphabetical epimerismi, words from Gregory of Nazianzus, word lists from scripture and secular authors) with poetry and moral texts, among them Musaeus\' Hero and Leander, the Batrachomyomachia, maxims from Democritus, Epictetus and Isocrates, Phocylides, and the Physiologus.',
    },
    raw: {
      year_estimated: true,
      year_reasoning: 'Bodleian catalogue: 10th century, first half (notBefore 900, notAfter 950); the year is the midpoint of that range. Copy date, not composition.',
      source_work_dates: 'EDITION',
    },
    // The work id was minted from the bad title ("local:n::arabic-grammar", carried by no other book). A miscellany
    // has no single work and an anonymous byline mints no local id (work-id-remint.mjs), so the id is cleared, not
    // re-pointed. No alias: it named no work.
    unset: ['work_id', 'work_title', 'work_slug', 'work_id_source', 'work_id_confidence'],
    imprint: { year: 925, year_source: 'catalogue', place_published: 'Constantinople' },
    edition: { year: 925, from: 900, to: 950, display: '901–950', precision: 'range', basis: 'catalogue', evidence: 'Bodleian TEI origDate "10th century, first half" (900–950)' },
  },
  {
    id: '69af12750092756351e44aac', evidence: SANGUO_EV,
    set: {
      title: '李卓吾先生批評三國志 (Romance of the Three Kingdoms), Vol. 1',
      display_title: "Romance of the Three Kingdoms, with Li Zhuowu's Commentary, Vol. 1",
      english_title: "Romance of the Three Kingdoms, with Li Zhuowu's Commentary, Vol. 1",
      author: 'Luo Guanzhong (羅貫中); Li Zhuowu (李卓吾), ed.',
      author_id: 'luo-guanzhong',
      work_id: 'local:a:luo-guanzhong:illustrated-kingdoms-romance-three',
      slug: 'li-zhuowu-piping-sanguozhi-vol-1-luo-guanzhong',
    },
    raw: {
      work_title: '三國演義 (Sānguó Yǎnyì)', work_slug: 'guanzhong', work_id_source: 'hand-adjudicated-7144', work_id_confidence: 'high',
      year_estimated: true,
      year_reasoning: 'LoC dates the set 1368–1644 (Ming). Li Zhi (1527–1602) is the named commentator, so this edition is no earlier than c. 1600.',
      source_work_dates: 'EDITION+WORK',
      collections: [],
    },
    push: {
      slug_aliases: 'on-the-structure-of-heaven-and-earth-ricci',
      author_link_provenance: { run: RUN, method: 'hand-adjudicated', matched: 'Luo Guanzhong', authors_slug: 'luo-guanzhong', anchored: true, confidence: 'high', at: NOW.toISOString() },
    },
    // Everything below was derived from, or assigned because of, the Ricci title: summaries describing a cosmology
    // treatise, Ricci's birth/death places, astronomy facets, and three cosmology/world-picture collections.
    unset: ['summary', 'summary_candidate', 'reading_summary', 'index.bookSummary', 'locations', 'faceted_tags', 'tradition', 'author_entity_id'],
    indexUnset: ['bookSummary'],
    imprint: { published: '1600–1644', year: 1600, year_source: 'catalogue' },
    edition: { year: 1600, from: 1600, to: 1644, display: '1600–1644', precision: 'range', basis: 'catalogue', evidence: 'LoC 2021666380: 1368–1644; floor from the commentator Li Zhi (d. 1602)' },
    work: { year: 1365, from: 1330, to: 1400, display: 'c. 1330–1400, the author\'s life', precision: 'range', basis: 'catalogue', evidence: 'LoC 2021666380: "Luo Guanzhong (circa 1330--1400)"' },
  },
  {
    id: '695592ca7bd6d2cd1d61b2d0', evidence: PORTA_EV,
    set: {
      // The title proper; "Des vortrefflichen Herrn Johann Baptista Portæ von Neapolis" above it is the byline.
      title: 'Magia Naturalis, oder Hauß- Kunst- und Wunder-Buch',
      display_title: 'Magia Naturalis, oder Hauß- Kunst- und Wunder-Buch (Nürnberg, 1713)',
    },
    raw: { source_work_dates: 'EDITION', 'source_work_dates_meta.catalogue_note': '' },
    // USTC ends at 1650: a word-overlap match (score 0.6) on a 1713 book is another edition, and it is where 1607 came from.
    unset: ['ustc_id', 'ustc_match', 'edition_external_ids.ustc', 'edition_external_ids.ustc_scope', 'edition_external_ids.ustc_reason'],
    imprint: { published: '1713', year: 1713, year_source: 'titlepage', place_published: 'Nürnberg', publisher: 'Johann Ziegers seel. Wittwe' },
    edition: { year: 1713, from: 1713, to: 1713, display: '1713', precision: 'exact', basis: 'titlepage', evidence: 'p. 11: "NURNBERG / Bey Johann Ziegers seel. Wittwe / 1713."' },
  },
];

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
async function supabaseMirror(id, values) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no supabase creds' };
  const cur = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}&select=*`, { headers: sbHeaders });
  const rows = await cur.json().catch(() => null);
  if (!cur.ok || !Array.isArray(rows) || !rows.length) return { ok: false, status: cur.status, rows: rows?.length ?? 0 };
  const body = Object.fromEntries(Object.entries(values).filter(([k]) => k in rows[0]));
  if (!APPLY) return { would: body };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
  const out = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(out) ? out.length : 0, cols: Object.keys(body) };
}
async function revalidate(id) {
  if (!process.env.CRON_SECRET) return 'no CRON_SECRET';
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  }).catch((e) => ({ ok: false, status: e.message }));
  return r.ok ? 'ok' : `failed ${r.status}`;
}
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const readBackup = () => (existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { run: RUN, entries: [] });
function mergeBackup(entry) {
  const bk = readBackup();
  if (!bk.entries.some((e) => e.book_id === entry.book_id)) bk.entries.push(entry); // the earlier `before` is the original
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify(bk, null, 1));
  if (process.env.JOB_SCRATCH) writeFileSync(join(process.env.JOB_SCRATCH, `${RUN}-backup.json`), JSON.stringify(bk, null, 1));
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  for (const e of readBackup().entries) {
    const set = {}, unset = {};
    for (const [f, v] of Object.entries(e.before)) if (v === undefined || v === null && !e.present.includes(f)) unset[f] = ''; else set[f] = v;
    console.log(`${APPLY ? 'REVERT' : 'would revert'} ${e.book_id}: ${Object.keys(set).length} set, ${Object.keys(unset).length} unset`);
    if (!APPLY) continue;
    await books.updateOne({ id: e.book_id }, { ...(Object.keys(set).length ? { $set: { ...set, updated_at: new Date() } } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (e.index_before) await db.collection('book_indexes').updateOne({ book_id: e.book_id }, { $set: e.index_before });
    await recordSweepAction(db, { sweep: RUN, book_id: e.book_id, action: 'catalogue-repair-reverted', detail: { fields: Object.keys(e.before) } });
  }
  await mc.close(); process.exit(0);
}

for (const p of PLAN) {
  const b = await books.findOne({ $or: [{ id: p.id }, { _id: p.id }] }, { projection: { embedding: 0, editions: 0, chapters: 0 } });
  if (!b) { console.error(`!! ${p.id} not found`); process.exitCode = 1; continue; }
  if (p.set.slug && await books.countDocuments({ $or: [{ slug: p.set.slug }, { slug_aliases: p.set.slug }], id: { $ne: b.id } })) {
    console.error(`!! slug ${p.set.slug} already taken`); process.exitCode = 1; continue;
  }
  console.log(`\n=== ${b.id}  ${String(b.title).slice(0, 70)}`);

  // source_work_dates: replace the edition (and, where marked, the work) entry; keep every other entry as is.
  const swd = [...(b.source_work_dates || [])];
  const meta = { ...(b.source_work_dates_meta || {}) };
  const entryOf = (type, d) => ({ type, date: String(d.year), date_display: d.display, date_precision: d.precision, basis: d.basis, evidence: d.evidence });
  const putEntry = (type, d) => { const i = swd.findIndex((x) => x.type === type); if (i >= 0) swd[i] = entryOf(type, d); else swd.push(entryOf(type, d)); };
  const raw = { ...p.raw };
  if (raw.source_work_dates) {
    putEntry('edition', p.edition);
    meta.edition = { ...p.edition, edited_by: BY, edited_at: NOW.toISOString(), issue: '#7144' };
    if (raw.source_work_dates.includes('WORK')) { putEntry('composition', p.work); meta.work = { ...p.work, edited_by: BY, issue: '#7144' }; delete meta.model_work; delete meta.author_window; }
    raw.source_work_dates = swd;
    raw.source_work_dates_meta = { ...meta, catalogue_note: raw['source_work_dates_meta.catalogue_note'] ?? meta.catalogue_note };
    delete raw['source_work_dates_meta.catalogue_note'];
  }

  const touched = [...Object.keys(p.set), ...Object.keys(raw), ...(p.unset || []), ...Object.keys(p.push || {}), ...Object.keys(p.imprint || {}),
    'normalized_title', 'normalized_author', 'edition_key', 'edition_key_quality'];
  const before = Object.fromEntries(touched.map((f) => [f, get(b, f) ?? null]));
  const present = touched.filter((f) => get(b, f) !== undefined);
  for (const [f, v] of Object.entries({ ...p.set, ...raw, ...(p.imprint || {}) })) {
    const was = JSON.stringify(get(b, f) ?? null);
    const now = JSON.stringify(v);
    if (was !== now) console.log(`  ${f.padEnd(26)} ${was.slice(0, 90)}\n  ${''.padEnd(26)} -> ${now.slice(0, 90)}`);
  }
  for (const f of p.unset || []) if (get(b, f) !== undefined) console.log(`  unset ${f.padEnd(20)} (was ${JSON.stringify(get(b, f)).slice(0, 80)})`);
  for (const [f, v] of Object.entries(p.push || {})) console.log(`  push  ${f.padEnd(20)} ${JSON.stringify(v).slice(0, 90)}`);

  const idx = p.indexUnset ? await db.collection('book_indexes').findOne({ book_id: b.id }) : null;
  const indexBefore = idx ? Object.fromEntries(p.indexUnset.filter((f) => idx[f] !== undefined).map((f) => [f, idx[f]])) : null;
  if (indexBefore) console.log(`  book_indexes unset ${Object.keys(indexBefore).join(', ')}`);

  // Identity is recomputed from the record AS IT WILL BE, so edition_key carries the corrected title/author/year.
  const ident = computeIdentityFields({ ...b, ...p.set, ...(p.imprint || {}) });
  for (const [f, v] of Object.entries(ident)) if (b[f] !== v) console.log(`  ${f.padEnd(26)} ${JSON.stringify(b[f])} -> ${JSON.stringify(v)}`);

  const sbCols = { ...p.set, ...(p.imprint || {}), work_id: p.set.work_id ?? (p.unset?.includes('work_id') ? null : undefined), source_work_dates: raw.source_work_dates };
  if (p.raw.collections) sbCols.collections = p.raw.collections;
  if (p.unset?.includes('summary')) sbCols.summary_text = null;
  delete sbCols.year_source; delete sbCols.author_id; delete sbCols.english_title;
  for (const k of Object.keys(sbCols)) if (sbCols[k] === undefined) delete sbCols[k];
  if (!APPLY) { console.log('  supabase', JSON.stringify(await supabaseMirror(b.id, sbCols)).slice(0, 300)); continue; }

  mergeBackup({ book_id: b.id, at: NOW.toISOString(), before, present, index_before: indexBefore, evidence: p.evidence });
  await recordSweepAction(db, { sweep: RUN, book_id: b.id, action: 'recatalogued-from-title-page', detail: { before, evidence: p.evidence } });

  const stamp = stampFor(p.evidence);
  if (p.imprint) {
    const r = await setCatalogueFields(db, b.id, p.imprint, stamp);
    console.log(`  imprint modified ${r.modified}: ${Object.keys(r.changed).join(', ')}`);
  }
  const $set = { ...raw, ...ident, updated_at: new Date() };
  const $push = {};
  for (const [f, v] of Object.entries(p.set)) {
    $set[f] = v;
    const prov = provenanceUpdate(f, { ...stamp, previous_value: get(b, f) ?? null, previous_provenance: b.field_provenance?.[f] ?? null });
    Object.assign($set, prov.$set); Object.assign($push, prov.$push);
  }
  for (const [f, v] of Object.entries(p.push || {})) $push[f] = v;
  const $unset = Object.fromEntries((p.unset || []).map((f) => [f, '']));
  const r = await books.updateOne({ id: b.id }, { $set, $push, ...(Object.keys($unset).length ? { $unset } : {}) });
  console.log(`  books modified ${r.modifiedCount}`);
  if (r.modifiedCount !== 1) { console.error('!! book not modified'); process.exitCode = 1; continue; }
  if (indexBefore && Object.keys(indexBefore).length) {
    const ir = await db.collection('book_indexes').updateOne({ book_id: b.id }, { $unset: Object.fromEntries(Object.keys(indexBefore).map((f) => [f, ''])) });
    console.log(`  book_indexes modified ${ir.modifiedCount}`);
  }
  await db.collection('field_provenance').insertOne({
    book_id: b.id, fields: [...Object.keys(p.set), ...Object.keys(p.imprint || {})], source: 'hand-adjudicated', run: RUN,
    method: 'title page read by image', by: BY, issue: '#7144', evidence: p.evidence,
    previous_values: Object.fromEntries([...Object.keys(p.set), ...Object.keys(p.imprint || {})].map((f) => [f, before[f]])),
    created_at: NOW.toISOString(),
  });
  console.log('  supabase', JSON.stringify(await supabaseMirror(b.id, sbCols)));
  console.log('  revalidate', await revalidate(b.id));
}
if (!APPLY) console.log('\n-- dry run (add --apply) --');
await mc.close();
