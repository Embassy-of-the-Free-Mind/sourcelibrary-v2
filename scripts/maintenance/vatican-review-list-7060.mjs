#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/clear-derived-bav-retitle-7270.mjs and clear-derived-vatican-retitle-2026-10-20.mjs
// (#7060/#7270) — both have literal id lists for runs that already happened, and neither changes date, language
// or author. bav-shelfmark-titles-7270.mjs retitles only. This is the review-list remainder of #7060: same
// backup/revert/sweep_log/Supabase-mirror shape, with the fields those scripts left alone.
/**
 * #7060 review list, catalogue-backed fixes only (2026-11-12). Every row below is backed by the BAV IIIF
 * manifest's own metadata (stored on the record as catalog_metadata.metadata_pairs), or, for two language
 * fixes, by a high-confidence 2026-10-20 audit verdict read against the page images. Rows that need a
 * reader to name the work are NOT here: they are listed on the issue.
 *
 * Writes, per row, only when every field still holds the value the audit saw (`expect`); else SKIP:
 *   books          $set the listed fields + field_provenance.<field>; author changes also $unset author_id,
 *                  author_entity_id, normalized_author (the canonical-link backfill relinks, as #7060 did).
 *                  `clearDerived` rows $unset the prose derived from the old (unsupported) identity —
 *                  description, ai_metadata.description, summary (text), summary_candidate, index.bookSummary,
 *                  dublin_core.dc_description — so the pipeline re-derives it (derived-metadata-lane.md).
 *   book_indexes   $unset bookSummary on clearDerived rows
 *   books_catalog  (Supabase) title/display_title/author/language/published/year mirrored; clearDerived rows
 *                  null summary_text/description
 *   sweep_log      one row per book
 *
 *   node --env-file=.env.production.local scripts/maintenance/vatican-review-list-7060.mjs --diff=<path.jsonl>     dry run
 *   … --backup=<path.json> --apply [--revalidate]
 *   … --revert=<backup.json> [--apply]
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';

const RUN = 'vatican-review-list-7060';
const BAV = 'BAV IIIF manifest metadata (catalog_metadata.metadata_pairs)';
const AUDIT = 'audit 2026-10-20 (5 pages read against images, high confidence; #7060)';
const ROWS = [
  { id: '69a5e3d8006a4098422166a7', shelf: 'Ott.gr.86', source: BAV, evidence: 'Title "Cyrilli Hierosolymitani Catecheses"; Date "sec. X/XI"',
    expect: { author: 'Synesius of Cyrene', published: '14th century', year: 1350 },
    set: { author: 'Cyril of Jerusalem', published: '10th–11th century', year: 1000 } },
  { id: '69a5e3a7006a409842216188', shelf: 'Barb.gr.147', source: BAV, evidence: 'Author "Galenus … Opere spurie e dubbie"; Date "sec. XVI in (ff. 1-47). sec. XV fere ex (ff. 48-201)"',
    expect: { author: 'Pseudo-Aristotle', published: '15th century', year: 1450 },
    set: { author: 'Pseudo-Galen', published: 'late 15th–early 16th century', year: 1500 } },
  { id: '69a5e476006a4098422172b0', shelf: 'Pal.lat.1066', source: BAV, evidence: 'Date "1424"',
    expect: { published: '14th century', year: 1350 }, set: { published: '1424', year: 1424 } },
  { id: '69906eca7d027b8182c0a9dc', shelf: 'Pal.lat.1370', source: BAV, evidence: 'Date "Sec. XV"; Language "Latino-tedesco"',
    expect: { published: '1300', year: 1300, language: 'German' },
    set: { published: '15th century', year: 1450, language: 'Latin', languages: ['Latin', 'German'], language_multi: true } },
  { id: '699065ffef12272ffdc94bc3', shelf: 'Pal.lat.1885', source: BAV, evidence: 'Date "1570-1580"',
    expect: { published: '1400', year: 1400 }, set: { published: '1570–1580', year: 1575 } },
  { id: '6953aba777f38f6761bd7d2c', shelf: 'Reg.lat.1200', source: BAV, evidence: 'Date "sec. XVII"',
    expect: { published: 'Medieval', year: 1200 }, set: { published: '17th century', year: 1650 } },
  { id: '6953ab5577f38f6761bd6daa', shelf: 'Pal.lat.1329', source: BAV, evidence: 'Date "1430" (the hidden duplicate already says 1430)',
    expect: { published: 'Medieval', year: 1350 }, set: { published: '1430', year: 1430 } },
  { id: '699067f8249ce014347d530c', shelf: 'Pal.lat.1328', source: BAV, evidence: 'Date "1351-1400"',
    expect: { published: '1450', year: 1450 }, set: { published: '1351–1400', year: 1375 } },
  { id: '69e4130ad214eb3aaa9be140', shelf: 'Vat.lat.3773', source: BAV, evidence: 'Date "sec. XV ex."',
    expect: { published: '1400', year: 1400 }, set: { published: 'late 15th century', year: 1475 } },
  { id: '6993881574305116d72cef37', shelf: 'Vat.gr.190.pt.1', source: BAV, evidence: 'Date "sec. IX" (888 is the Bodleian D\'Orville Euclid)',
    expect: { published: '888', year: 888 }, set: { published: '9th century', year: 850 } },
  { id: '69a5f2110a8b44a5d9dc8e20', shelf: 'Vat.sir.117', source: BAV, evidence: 'Date "XIII c."',
    expect: { published: '700', year: 700 }, set: { published: '13th century', year: 1250 } },
  { id: '69a5f20f0a8b44a5d9dc8d25', shelf: 'Vat.sir.254', source: BAV, evidence: 'Date "X c."',
    expect: { published: '900', year: 900 }, set: { published: '10th century', year: 950 } },
  { id: '69a5f366d4c2e3cf8ecb8a85', shelf: 'Vat.sir.253', source: BAV, evidence: 'Date "VIII c."',
    expect: { published: '800', year: 800 }, set: { published: '8th century', year: 750 } },
  { id: '699067ef249ce014347d4e4f', shelf: 'Vat.ebr.226', source: AUDIT, evidence: 'Zohar text is chiefly Aramaic; record said Hebrew',
    expect: { language: 'Hebrew' }, set: { language: 'Aramaic', languages: ['Aramaic', 'Hebrew'], language_multi: true } },
  { id: '69e4130e2d8eeae86149fa4a', shelf: 'Vat.lat.3738', source: AUDIT, evidence: 'pictorial codex with Italian (some Spanish) glosses; no Nahuatl text',
    expect: { language: 'Nahuatl' }, set: { language: 'Italian', languages: ['Italian', 'Spanish'], language_multi: false } },
  { id: '69a5e3c8006a40984221632e', shelf: 'Vat.gr.2306', source: AUDIT, clearDerived: true,
    evidence: 'no biblical text in any sample; display title and description (Septuagint lower text) unsupported. #7270 left the title: work not established',
    expect: { display_title: 'Biblical Palimpsest with Inquisition Abjuration Documents' }, set: { display_title: 'Greek palimpsest (Vat.gr.2306)' } },
  { id: '69a5e3d8006a409842216887', shelf: 'Reg.gr.80', source: AUDIT, clearDerived: true,
    evidence: 'samples are Aristotle, Parva naturalia, and Lenten homilies; Maximus "Ambigua" not seen. #7270 left the title: work not established',
    expect: { display_title: 'Parva Naturalia and Ambigua' }, set: { display_title: 'Greek miscellany: Aristotle, Parva naturalia, and homilies (Reg.gr.80)' } },
];
const DERIVED = ['description', 'ai_metadata.description', 'summary_candidate', 'index.bookSummary', 'dublin_core.dc_description'];
const AUTHOR_LINKS = ['author_id', 'author_entity_id', 'normalized_author'];
const SB_MIRROR = ['title', 'display_title', 'author', 'language', 'published', 'year'];

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SH = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const sb = (q, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/books_catalog?${q}`, { ...init, headers: { ...SH, ...(init.headers || {}) } });

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const now = new Date();

try {
  if (args.revert) {
    const bk = JSON.parse(readFileSync(args.revert, 'utf8'));
    console.log(`revert: ${bk.books.length} books, ${bk.book_indexes.length} book_indexes, ${bk.supabase.length} supabase rows${APPLY ? '' : ' (dry run)'}`);
    if (APPLY) {
      for (const b of bk.books) {
        const set = {}, unset = {};
        for (const [f, v] of Object.entries(b.before)) { if (v === '__ABSENT__') unset[f] = ''; else set[f] = v; }
        await books.updateOne({ id: b.id }, { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }
      for (const x of bk.book_indexes) await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $set: { bookSummary: x.bookSummary } });
      for (const r of bk.supabase) { const { id, ...rest } = r; await sb(`id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(rest) }); }
      console.log('reverted');
    }
  } else {
    if (APPLY && !args.backup) { console.error('--backup=<path> required with --apply'); process.exit(2); }
    const docs = new Map((await books.find({ id: { $in: ROWS.map((r) => r.id) } }).toArray()).map((d) => [d.id, d]));
    const plan = [], diff = [];
    for (const r of ROWS) {
      const d = docs.get(r.id);
      if (!d) { console.log(`SKIP ${r.shelf}: no book ${r.id}`); continue; }
      const drift = Object.entries(r.expect).filter(([f, v]) => !same(get(d, f), v));
      if (drift.length) { console.log(`SKIP ${r.shelf}: changed since the audit (${drift.map(([f]) => `${f}=${JSON.stringify(get(d, f))}`).join(', ')})`); continue; }
      const set = {}, unset = [];
      for (const [f, v] of Object.entries(r.set)) if (!same(get(d, f), v)) set[f] = v;
      for (const f of Object.keys(set)) if (['author', 'published', 'year', 'language', 'display_title'].includes(f))
        set[`field_provenance.${f}`] = { source: 'maintenance', script: RUN, evidence: `${r.source}: ${r.evidence}`, date: now.toISOString(), previous: get(d, f) ?? null };
      if ('author' in set) for (const f of AUTHOR_LINKS) if (get(d, f) !== undefined) unset.push(f);
      if (r.clearDerived) {
        for (const f of DERIVED) if (get(d, f) !== undefined) unset.push(f);
        if (typeof d.summary?.data === 'string' && d.summary.data.trim()) unset.push('summary');
      }
      for (const f of Object.keys(set)) if (!f.startsWith('field_provenance.')) diff.push({ id: r.id, shelf: r.shelf, field: f, before: get(d, f) ?? null, after: set[f], source: r.source, evidence: r.evidence });
      for (const f of unset) diff.push({ id: r.id, shelf: r.shelf, field: f, before: get(d, f), after: '__UNSET__', source: r.source, evidence: r.evidence });
      plan.push({ r, d, set, unset });
    }
    for (const x of diff) console.log(`${x.shelf.padEnd(16)} ${x.field.padEnd(22)} ${JSON.stringify(x.before)?.slice(0, 70)} → ${JSON.stringify(x.after).slice(0, 70)}`);
    const clearIds = plan.filter((p) => p.r.clearDerived).map((p) => p.d.id);
    const bi = await db.collection('book_indexes').find({ book_id: { $in: clearIds }, bookSummary: { $exists: true } }).toArray();
    for (const x of bi) diff.push({ id: x.book_id, shelf: plan.find((p) => p.d.id === x.book_id).r.shelf, field: 'book_indexes.bookSummary', before: x.bookSummary, after: '__UNSET__' });
    const sbRows = await (await sb(`id=in.(${plan.map((p) => p.d.id).join(',')})&select=id,${SB_MIRROR.join(',')},summary_text,description`)).json();
    if (!Array.isArray(sbRows)) { console.error('supabase read failed', sbRows); process.exit(1); }
    console.log(`\nbooks to write: ${plan.length}/${ROWS.length}; field changes: ${diff.length}; book_indexes: ${bi.length}; supabase rows: ${sbRows.length}`);
    if (args.diff) { writeFileSync(args.diff, diff.map((x) => JSON.stringify(x)).join('\n') + '\n'); console.log(`diff: ${args.diff}`); }
    if (!APPLY) console.log('DRY RUN: nothing was written.');
    else {
      if (existsSync(args.backup)) { console.error(`${args.backup} exists`); process.exit(2); }
      const backup = { run: RUN, at: now.toISOString(),
        books: plan.map(({ d, set, unset }) => ({ id: d.id, before: Object.fromEntries([...Object.keys(set), ...unset].map((f) => [f, get(d, f) === undefined ? '__ABSENT__' : get(d, f)])) })),
        book_indexes: bi.map((x) => ({ book_id: x.book_id, bookSummary: x.bookSummary })), supabase: sbRows };
      writeFileSync(args.backup, JSON.stringify(backup));
      const fd = openSync(args.backup, 'r'); fsyncSync(fd); closeSync(fd);
      console.log(`backup: ${args.backup}`);
      for (const { r, d, set, unset } of plan) {
        const guard = { id: d.id, ...Object.fromEntries(Object.entries(r.expect).filter(([, v]) => !Array.isArray(v))) };
        const res = await books.updateOne(guard, { $set: { ...set, updated_at: now }, ...(unset.length ? { $unset: Object.fromEntries(unset.map((f) => [f, ''])) } : {}) });
        await recordSweepAction(db, { sweep: RUN, book_id: d.id, action: 'review-list-catalogue-fix', detail: { set_keys: Object.keys(set), unset, source: r.source, evidence: r.evidence } });
        console.log(`  ${r.shelf} modified ${res.modifiedCount}`);
      }
      for (const x of bi) await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $unset: { bookSummary: '' } });
      const fresh = await books.find({ id: { $in: plan.map((p) => p.d.id) } }).toArray();
      for (const d of fresh) {
        if (!sbRows.find((x) => x.id === d.id)) { console.log(`  supabase: no row for ${d.id}`); continue; }
        const patch = Object.fromEntries(SB_MIRROR.map((c) => [c, d[c] ?? null]));
        if (clearIds.includes(d.id)) { patch.summary_text = null; patch.description = null; }
        const res = await sb(`id=eq.${d.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: now.toISOString() }) });
        console.log(`  supabase ${d.id} ${res.status}`);
      }
      if ('revalidate' in args) console.log(`revalidated: ${JSON.stringify((await revalidateBookPages(fresh.map((d) => ({ id: d.id, slug: d.slug })))).revalidated)}`);
    }
  }
} finally { await mc.close(); }
