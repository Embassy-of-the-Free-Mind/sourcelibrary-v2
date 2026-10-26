#!/usr/bin/env node
/**
 * #6056 (spot-check round 6, 2026-10-25) — one book adjudicated BY HAND from its own title page (image opened).
 *
 *   69b302e53613a84e6806812d  catalogued as Beverwijck's Dutch "Schat der Gesontheyt". The scan (IA
 *       hin-wel-all-00002138-001, Wellcome copy) is his LATIN "Idea medicinae veterum": title page p. 12 reads
 *       "IDEA MEDICINÆ VETERVM. IOH. BEVEROVICIVS concinnavit. LVGD. BATAV. Ex officina Elseviriorum. CIƆ IƆC XXXVII."
 *       and every text page is Latin (running heads "MEDICINÆ VETERVM PARS I–III"). Found by the reviewers and,
 *       before them, by scripts/audit/edition-language-vs-ocr.mjs (strong, Latin share 1.0). Year (1637) and
 *       publisher (Elzevir) were right; title, language, work and everything derived from the Dutch title were not.
 *       Derek 2026-10-26: "fix now".
 *
 * PRIOR ART: scripts/maintenance/repair-catalogue-7144.mjs — this is that script with its PLAN replaced (same writes,
 * same backup/--revert, same provenance). It hard-codes its three books, so it cannot take this one.
 *
 * Writes:
 *   books          the fields in PLAN, each identity field with a field_provenance stamp + history entry; imprint
 *                  place via setCatalogueFields; edition_key etc. recomputed by computeIdentityFields; the old slug
 *                  kept in slug_aliases (links keep working); derived prose and tags from the Dutch title unset.
 *   book_indexes   bookSummary unset (it summarises the Dutch work).
 *   books_catalog  (Supabase) the mirrored columns.
 *   field_provenance + sweep_log rows; backup merged on id.
 * Not touched: page text, first-translation fields (resolved against the Dutch title — their own lane, reported on
 *   #6056), the hidden second copy 6adecebbbf12d2ef205385a9 of the same edition (dedupe queue), quality_score.
 *
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-beverwijck-6056.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-beverwijck-6056.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-catalogue-beverwijck-6056.mjs --revert --apply
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
const RUN = 'repair-catalogue-beverwijck-6056';
const SCRIPT = 'scripts/maintenance/repair-catalogue-beverwijck-6056.mjs';
const ISSUE = '#6056';
const BACKUP = join(HERE, 'backups', `${RUN}.json`);
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const NOW = new Date();
const BY = 'Claude (session sprint-r6), fix approved by Derek 2026-10-26';
const stampFor = (evidence) => ({
  source: 'hand-adjudicated', method: 'title page read by image', script: SCRIPT, by: BY, issue: ISSUE, date: NOW, evidence,
});

const BEVERWIJCK_EV = {
  pages: [12, 42, 173], as_read: 'p. 12 (title page, image opened): "IDEA MEDICINÆ VETERVM. IOH. BEVEROVICIVS concinnavit. [Elzevir device, NON SOLUS] LVGD. BATAV. Ex officina Elseviriorum. CIƆ IƆC XXXVII."; p. 42 "IOH. BEVEROVICII MEDICINÆ VETERVM PARS I."; p. 173 "MEDICINÆ VETERVM PARS III."',
  source_record: 'https://archive.org/details/hin-wel-all-00002138-001 (Wellcome Library 835/A/4); spot-check round 6, scripts/eval/results/spot-check/sprint-2026-10-25-r6',
};

/**
 * Per book: `set` (identity fields get a provenance stamp), `raw` ($set without a stamp: derived or bookkeeping),
 * `unset`, `imprint` (setCatalogueFields), `push`, `indexUnset` (book_indexes).
 */
const PLAN = [
  {
    id: '69b302e53613a84e6806812d', evidence: BEVERWIJCK_EV,
    set: {
      title: 'Idea medicinae veterum',
      display_title: 'Idea medicinae veterum',
      english_title: 'The Idea of Ancient Medicine',
      language: 'Latin',
      languages: ['Latin'],
      slug: 'idea-medicinae-veterum-beverwijck-1637',
      work_id: 'local:a:johan-van-beverwijck:idea-medicinae-veterum',
      description: 'Johan van Beverwijck\'s Latin digest of ancient medicine (Leiden: Elzevir, 1637), gathered from Hippocrates, Galen, Celsus, Pliny and other classical authors in three parts: the nature of the body, the six non-naturals that keep health, and the knowing and curing of diseases.',
    },
    raw: {
      work_title: 'Idea medicinae veterum', work_slug: 'beverwijck-idea-medicinae-veterum',
      work_id_source: 'hand-adjudicated-6056', work_id_confidence: 'high',
      'ai_metadata.language': 'Latin',
    },
    push: { slug_aliases: 'schat-der-gesontheyt-beverwijck' },
    // Derived from, or matched against, the Dutch title: summaries of a vernacular health manual, the vernacular
    // facet, the language-review flag this repair settles, and a USTC match picked "closest year" among four
    // candidates for the Dutch title (scope "unverified").
    unset: ['summary', 'summary_candidate', 'reading_summary', 'index.bookSummary', 'faceted_tags', 'ai_metadata.description',
      'language_review', 'language_review_detail', 'ustc_id', 'ustc_match', 'edition_external_ids.ustc',
      'edition_external_ids.ustc_scope', 'edition_external_ids.ustc_reason'],
    indexUnset: ['bookSummary'],
    imprint: { place_published: 'Leiden' },
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
    meta.edition = { ...p.edition, edited_by: BY, edited_at: NOW.toISOString(), issue: ISSUE };
    if (raw.source_work_dates.includes('WORK')) { putEntry('composition', p.work); meta.work = { ...p.work, edited_by: BY, issue: ISSUE }; delete meta.model_work; delete meta.author_window; }
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
    method: 'title page read by image', by: BY, issue: ISSUE, evidence: p.evidence,
    previous_values: Object.fromEntries([...Object.keys(p.set), ...Object.keys(p.imprint || {})].map((f) => [f, before[f]])),
    created_at: NOW.toISOString(),
  });
  console.log('  supabase', JSON.stringify(await supabaseMirror(b.id, sbCols)));
  console.log('  revalidate', await revalidate(b.id));
}
if (!APPLY) console.log('\n-- dry run (add --apply) --');
await mc.close();
