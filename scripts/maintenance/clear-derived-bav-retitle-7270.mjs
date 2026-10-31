#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/clear-derived-vatican-retitle-2026-10-20.mjs (#7060) — the same clear
// for ten other retitled Vatican records; its id list, backup paths and slug pass are literal to that
// run, so it cannot be pointed at two new books without editing history. Same field list, same rules.
/**
 * Ott.gr.86 and Barb.gr.147 were retitled from their BAV catalogue records on 2026-10-25 by
 * bav-shelfmark-titles-7270.mjs (#7270). Their derived fields still describe the old identities
 * (Synesius "On Dreams"; Pseudo-Aristotle "Problemata"). Per derived-metadata-lane.md these are CLEARED,
 * never rewritten, so the pipeline re-derives them from the corrected record. Page text is not touched.
 *
 * Writes (two literal ids; every prior value goes to the backup file first):
 *   books          $unset description, subject_keywords, summary (only when it holds text), summary_candidate,
 *                  index.bookSummary, collection_scores(+_meta), quality_assessment.ai_scores.historical_significance.reasoning,
 *                  translation_verification, first_translation(_status), work_id/work_slug/work_title/
 *                  work_id_source/work_id_confidence, dublin_core.dc_description, ai_metadata.description;
 *                  $set english_title from the corrected title; categories/collections: only the REMOVE entries.
 *   book_indexes   $unset bookSummary
 *   collections    highlighted_books / mentioned_books entries for a book whose membership is removed
 *   books_catalog  (Supabase) title/display_title mirrored from Mongo; derived columns nulled
 *   sweep_log rows
 * NOT done: author (still the old identity's author on both) and slug — identity changes, raised on #7270.
 *
 *   node --env-file=.env.production.local scripts/maintenance/clear-derived-bav-retitle-7270.mjs --backup=<path>            dry run
 *   … --backup=<path> --apply [--revalidate]
 *   … --revert=<backup> --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';

const RUN = 'clear-derived-bav-retitle-7270';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const IDS = {
  '69a5e3d8006a4098422166a7': 'Ott.gr.86',   // was Synesius, De insomniis; BAV: Cyrilli Hierosolymitani Catecheses
  '69a5e3a7006a409842216188': 'Barb.gr.147', // was Pseudo-Aristotle, Problemata; BAV: Galenus (spuria), De remediis parabilibus
};
// Ott.gr.86: the dream/Neoplatonist memberships came from "Synesius, On Dreams"; the chapters are Cyril's
// Catecheses throughout. Barb.gr.147 keeps its memberships: its text has medical Problemata (ch. at p.92).
const REMOVE = { '69a5e3d8006a4098422166a7': { collections: ['sleep-and-dreams', 'neoplatonism'], categories: ['neoplatonism', 'divination'] } };
const BOOK_UNSET = ['summary_candidate', 'description', 'subject_keywords', 'index.bookSummary', 'collection_scores', 'collection_scores_meta',
  'quality_assessment.ai_scores.historical_significance.reasoning', 'translation_verification', 'first_translation', 'first_translation_status',
  'work_id', 'work_slug', 'work_title', 'work_id_source', 'work_id_confidence', 'dublin_core.dc_description', 'ai_metadata.description'];
const SB_NULL = ['summary_text', 'description', 'subject_keywords', 'work_id', 'ft_disposition', 'ft_reasoning', 'ft_verdict', 'ft_evidence_strength', 'ft_our_completeness'];
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const SH = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const sb = (q, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/books_catalog?${q}`, { ...init, headers: { ...SH, ...(init.headers || {}) } });

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const now = new Date();
const ids = Object.keys(IDS);

try {
  if (args.revert) {
    const bk = JSON.parse(readFileSync(args.revert, 'utf8'));
    console.log(`revert: ${bk.books.length} books, ${bk.book_indexes.length} book_indexes, ${bk.collections.length} collections, ${bk.supabase.length} supabase rows${APPLY ? '' : ' (dry run)'}`);
    if (APPLY) {
      for (const b of bk.books) {
        const set = {}, unset = {};
        for (const [f, v] of Object.entries(b.before)) { if (v === '__ABSENT__') unset[f] = ''; else set[f] = v; }
        await books.updateOne({ id: b.id }, { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }
      for (const x of bk.book_indexes) await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $set: { bookSummary: x.bookSummary } });
      for (const c of bk.collections) await db.collection('collections').updateOne({ slug: c.slug }, { $set: c.before });
      for (const r of bk.supabase) { const { id, ...rest } = r; await sb(`id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(rest) }); }
      console.log('reverted');
    }
  } else {
    if (!args.backup) { console.error('--backup=<path> required'); process.exit(2); }
    const docs = await books.find({ id: { $in: ids } }).toArray();
    if (docs.length !== ids.length) { console.error(`expected ${ids.length} books, found ${docs.length}`); process.exit(1); }
    for (const d of docs) if (!d.title.endsWith(`(${IDS[d.id]})`)) { console.error(`${d.id}: title "${d.title}" is not the retitled record`); process.exit(1); }
    const bi = await db.collection('book_indexes').find({ book_id: { $in: ids }, bookSummary: { $exists: true } }).toArray();
    const sbRows = await (await sb(`id=in.(${ids.join(',')})&select=*`)).json();
    const pull = Object.keys(REMOVE);
    const colls = await db.collection('collections').find({ $or: [{ 'highlighted_books.book_id': { $in: pull } }, { 'mentioned_books.book_id': { $in: pull } }] }).toArray();
    const plan = docs.map((d) => {
      const rm = REMOVE[d.id] || {};
      const set = { english_title: d.title };
      const unset = BOOK_UNSET.filter((f) => get(d, f) !== undefined);
      if (typeof d.summary?.data === 'string' && d.summary.data.trim()) unset.push('summary');
      if (rm.collections) set.collections = (d.collections || []).filter((c) => !rm.collections.includes(c));
      if (rm.categories) set.categories = (d.categories || []).filter((c) => !rm.categories.includes(c));
      if (rm.categories && d.faceted_tags?.knowledge_domain) set['faceted_tags.knowledge_domain'] = d.faceted_tags.knowledge_domain.filter((c) => !rm.categories.includes(c));
      console.log(`${IDS[d.id]}: set ${Object.keys(set).join(',')}; unset ${unset.join(',')}`);
      return { d, set, unset };
    });
    const colPlans = colls.map((c) => {
      const after = {};
      for (const f of ['highlighted_books', 'mentioned_books']) {
        const keep = (c[f] || []).filter((x) => !(pull.includes(x.book_id) && (REMOVE[x.book_id].collections || []).includes(c.slug)));
        if (keep.length !== (c[f] || []).length) after[f] = keep;
      }
      return { slug: c.slug, before: Object.fromEntries(Object.keys(after).map((f) => [f, c[f]])), after };
    }).filter((p) => Object.keys(p.after).length);
    console.log(`collections to edit: ${colPlans.map((p) => `${p.slug}[${Object.keys(p.after)}]`).join(', ') || 'none'}; book_indexes ${bi.length}; supabase rows ${sbRows.length}`);
    if (!APPLY) { console.log('DRY RUN: nothing was written.'); }
    else {
      if (existsSync(args.backup)) { console.error(`${args.backup} exists`); process.exit(2); }
      const backup = { run: RUN, at: now.toISOString(),
        books: plan.map(({ d, set, unset }) => ({ id: d.id, before: Object.fromEntries([...Object.keys(set), ...unset].map((f) => [f, get(d, f) === undefined ? '__ABSENT__' : get(d, f)])) })),
        book_indexes: bi.map((x) => ({ book_id: x.book_id, bookSummary: x.bookSummary })), collections: colPlans.map(({ slug, before }) => ({ slug, before })), supabase: sbRows };
      writeFileSync(args.backup, JSON.stringify(backup));
      const fd = openSync(args.backup, 'r'); fsyncSync(fd); closeSync(fd);
      console.log(`backup: ${args.backup}`);
      for (const { d, set, unset } of plan) {
        const r = await books.updateOne({ id: d.id, title: d.title }, { $set: { ...set, updated_at: now }, ...(unset.length ? { $unset: Object.fromEntries(unset.map((f) => [f, ''])) } : {}) });
        await recordSweepAction(db, { sweep: RUN, book_id: d.id, action: 'derived-fields-cleared-after-retitle', detail: { unset, set_keys: Object.keys(set), previous_work_id: d.work_id ?? null } });
        console.log(`  ${IDS[d.id]} modified ${r.modifiedCount}`);
      }
      for (const x of bi) await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $unset: { bookSummary: '' } });
      for (const { slug, after } of colPlans) { const r = await db.collection('collections').updateOne({ slug }, { $set: { ...after, updated_at: now } }); console.log(`  collections/${slug} modified ${r.modifiedCount}`); }
      const fresh = await books.find({ id: { $in: ids } }).toArray();
      for (const d of fresh) {
        const row = sbRows.find((r) => r.id === d.id);
        if (!row) { console.log(`  supabase: no row for ${d.id}`); continue; }
        const patch = { title: d.title, display_title: d.display_title, updated_at: now.toISOString() };
        for (const c of SB_NULL) if (c in row) patch[c] = null;
        if ('collections' in row) patch.collections = d.collections || [];
        if ('categories' in row) patch.categories = d.categories || [];
        const res = await sb(`id=eq.${d.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
        console.log(`  supabase ${IDS[d.id]} ${res.status}`);
      }
      if ('revalidate' in args) console.log(`revalidated: ${JSON.stringify((await revalidateBookPages(fresh.map((d) => ({ id: d.id, slug: d.slug })))).revalidated)}`);
    }
  }
} finally { await mc.close(); }
