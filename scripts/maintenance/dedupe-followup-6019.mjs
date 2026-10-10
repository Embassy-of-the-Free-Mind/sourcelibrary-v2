#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/dedupe-cleanup-6019.mjs — the first round (pointer repairs,
// hide-and-link, the gated e-rara text move). It has no "publish a hidden record" and no keeper
// swap, and its plan is built from the review files of that round; this is the second round of
// the same issue with its own reviewed list below. Publication writes go through the same one
// writer (scripts/lib/publication.mjs).
/**
 * Dedupe follow-up — the #6019 decisions Derek answered on 2026-10-10:
 *   - publish the three records that turned out not to be duplicates (or are the intact copy);
 *   - swap the keeper on the same-edition pairs where the hidden copy is the fuller record AND
 *     its page order holds (checked from the printed page numbers, see PLAN notes);
 *   - hide the second visible record of Kitab al-Bulhan and keep the one with the DOI.
 *
 * A SWAP writes, in this order: the new keeper becomes public and loses its `duplicate_of`;
 * shelf membership the old keeper carried (`collections`, and `categories` when the new keeper
 * has none) is added to the new keeper so the book does not drop off curated pages; every other
 * record that pointed at the old keeper is re-pointed; the old keeper is hidden as a duplicate of
 * the new one. First-translation fields are NOT copied: each record keeps its own evidence
 * (first-translation-claims.md), so a badge the old keeper showed does not follow.
 *
 * `gallery_images.book_visible` follows both directions here (visibility-and-stats.md).
 * ACTUATION: sync-books-catalog (odd hours :45) moves the Supabase catalogue; homepage counts
 * move at 05:15; the reader gate redirects a hidden duplicate to its keeper on the next request.
 *
 * DRY RUN BY DEFAULT.
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-followup-6019.mjs
 *   … --apply --undo-out undo.json     the before-state of every touched field is saved first
 *   … --undo undo.json [--apply]
 */
import fs from 'node:fs';
import { EJSON } from 'bson';
import { withMongo } from '../lib/mongo.mjs';
import { setPublication, legacyPublication } from '../lib/publication.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const ISSUE = 6019;
const BY = 'script:dedupe-followup-6019';
const SWEEP = 'dedupe-followup-6019';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const UNDO_FIELDS = ['duplicate_of', 'visible', 'hidden', 'hidden_reason', 'hidden_at', 'publication', 'collections', 'categories', 'updated_at'];

/** Reviewed 2026-10-10. `order` is what the printed page numbers of the record showed. */
export const PLAN = [
  { action: 'publish', book: '69b51e6947b06ecd5818faf1', why: 'Magia Adamica Sammelband (BSB, 474 pp, four tracts): not the same book as the single tract it was marked a duplicate of' },
  { action: 'publish', book: '68fb0dc412055a03a58d3281', why: 'Pymander, Asclepius, Iamblichus, Proclus (Basel 1532): a different book from the Kraków 1586 commentary' },
  { action: 'publish', book: '697a5562c915282d8f071f74', why: 'Doni, Dichiaratione (Venice 1562), the intact 40-page record; the 50-page record stays hidden for its page order (#5900)' },
  { action: 'swap', keeper: '6984e8498a2f054f912420d1', old: '69c4ec33a3a4a7c546ee610b', why: 'Philaletha illustratus: the same BPH photographs cut into single pages; printed 1–122 ascend' },
  { action: 'swap', keeper: '69b6a4f5080b19f98fd2144e', old: '69a5f6cd1cf742c3604142ea', why: 'Schott, Mechanica hydraulico-pneumatica (1657): 623 against 626 pages, the same order profile as the current keeper' },
  { action: 'swap', keeper: '6952949cb184004c526a1ea2', old: '69b2ff985545150b61b4870e', why: 'Bacon, Sylva sylvarum (Elzevir 1648): running heads 10–612 ascend without a repeat' },
  { action: 'hide_and_link', book: '69907bd95f855ec553e7160b', keeper: '6953b56577f38f6761bd979d', why: 'Kitab al-Bulhan, Bodleian MS. Bodl. Or. 133: the same manuscript and photographs; the keeper carries the DOI' },
];
/** Same-edition pairs NOT swapped: the hidden copy is longer because leaves are captured twice. */
export const NOT_SWAPPED = [
  { copy: '69804b901fb2ba7cf1d43a1c', keeper: '690c2476e0787282ad5930dd', why: 'Lebensbeschreibungen: 510 against 416 pages; printed numbers repeat out of place throughout (20 21 20 22 21 23 …), 62 descents against 2' },
  { copy: '69af0fb51107dce13648c5be', keeper: '69af0fc06f6d83348c7fa40c', why: 'De morbis artificum: three 20-page runs repeat (38→19, 188→169, 292→273); 53 printed numbers occur twice, none in the keeper' },
  { copy: '69527326ab34727b1f048b7a', keeper: '69b6660cb3f4fc044155888e', why: 'De triplici minimo: 41 printed numbers occur twice against 14; the 38 extra pages are mostly repeats' },
  { copy: '6984e8498a2f054f912420c9', keeper: '6991ec02e93551dd846a7c58', why: 'De orbis terrae concordia: spreads captured twice in place (154 155 154 155, 202 203 202 203 202 203), 19 gaps in page_number' },
  { copy: '69942e50d607f8e57e4b82da', keeper: '69b20f7baed0c6181c6c67b5', why: 'Hypomnematismoi: three 10-page blocks repeat (276–285, 510–519, 692–701); the 19 extra pages are those' },
  { copy: '6a084e6a15c643eb1af41957', keeper: '6a08514149638a50931b85a3', why: 'De fascino: 20-page runs repeat (56→37, 192→173); 32 printed numbers occur twice against 6' },
];

const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];

async function main(db) {
  const books = db.collection('books');
  const get = (id) => books.findOne({ id });
  const undoFile = arg('--undo');
  if (undoFile) {
    const saved = EJSON.parse(fs.readFileSync(undoFile, 'utf8'));
    for (const b of saved.books) {
      const set = {}, unset = {};
      for (const f of UNDO_FIELDS) { if (f in b.before) set[f] = b.before[f]; else unset[f] = ''; }
      console.log(`${b.id}: restore ${Object.keys(set).join(', ')}; unset ${Object.keys(unset).join(', ') || '-'}`);
      if (!APPLY) continue;
      const cur = await get(b.id);
      await books.updateOne({ id: b.id }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      const after = await get(b.id);
      await db.collection('publication_events').insertOne({ book_id: b.id, from: legacyPublication(cur).state, from_reason: cur.hidden_reason ?? null, to: legacyPublication(after).state, reason: after.hidden_reason ?? null, note: `undo of ${SWEEP}`, by: BY, issue: ISSUE, override: null, at: new Date(), fanout: null });
      await db.collection('gallery_images').updateMany({ book_id: b.id }, { $set: { book_visible: after.visible === true } });
    }
    if (!APPLY) console.log('DRY RUN: nothing was written.');
    return;
  }

  // Plan against the live state; anything that no longer matches the review is refused, not forced.
  const steps = [];
  for (const p of PLAN) {
    if (p.action === 'publish') {
      const b = await get(p.book);
      const s = { ...p, title: b?.title };
      if (!b) s.status = 'refused: not found';
      else if (b.visible === true) s.status = 'done';
      else if (b.duplicate_of) s.status = `refused: still points at ${b.duplicate_of}`;
      else if (legacyPublication(b).state === 'takedown') s.status = 'refused: takedown';
      else s.status = 'todo';
      steps.push(s);
    } else if (p.action === 'swap') {
      const k = await get(p.keeper), o = await get(p.old);
      const s = { ...p, title: k?.title };
      if (!k || !o) s.status = 'refused: not found';
      else if (k.visible === true && o.visible === false && o.duplicate_of === p.keeper) s.status = 'done';
      else if (!(o.visible === true && k.visible === false && k.duplicate_of === p.old && k.hidden_reason === 'duplicate')) s.status = 'refused: the pair is not (hidden duplicate → visible keeper) any more';
      else {
        s.status = 'todo';
        s.carry = { collections: union(k.collections, o.collections), ...((k.categories || []).length ? {} : { categories: o.categories || [] }) };
        s.repoint = (await books.find({ duplicate_of: p.old, id: { $ne: p.keeper } }, { projection: { id: 1 } }).toArray()).map((x) => x.id);
        s.note = `pages ${k.pages_count}/${k.pages_ocr}/${k.pages_translated} replace ${o.pages_count}/${o.pages_ocr}/${o.pages_translated}; first-translation badge old=${o.is_first_translation === true} new=${k.is_first_translation === true}`;
      }
      steps.push(s);
    } else {
      const b = await get(p.book), k = await get(p.keeper);
      const s = { ...p, title: b?.title };
      if (!b || !k) s.status = 'refused: not found';
      else if (b.visible === false && b.duplicate_of === p.keeper) s.status = 'done';
      else if (k.visible !== true || k.duplicate_of) s.status = 'refused: the keeper is not a visible record without a pointer';
      else if (b.visible !== true) s.status = 'refused: the copy is not visible';
      else { s.status = 'todo'; s.carry = { collections: union(k.collections, b.collections) }; s.repoint = (await books.find({ duplicate_of: p.book, id: { $ne: p.keeper } }, { projection: { id: 1 } }).toArray()).map((x) => x.id); }
      steps.push(s);
    }
  }
  for (const s of steps) console.log(`${s.status.padEnd(8)} ${s.action.padEnd(13)} ${s.book || s.keeper}${s.old ? ` ⇄ ${s.old}` : s.action === 'hide_and_link' ? ` → ${s.keeper}` : ''}  ${String(s.title).slice(0, 50)}${s.note ? `\n         ${s.note}` : ''}${s.carry ? `\n         carries ${JSON.stringify(s.carry)}` : ''}${s.repoint?.length ? `\n         re-points ${s.repoint.join(', ')}` : ''}`);
  const todo = steps.filter((s) => s.status === 'todo');
  if (!APPLY) { console.log(`DRY RUN: ${todo.length} to write, nothing was written.`); return; }
  const undoOut = arg('--undo-out');
  if (!undoOut) throw new Error('--apply needs --undo-out <file>');

  const touched = new Set();
  for (const s of todo) for (const id of [s.book, s.keeper, s.old, ...(s.repoint || [])]) if (id) touched.add(id);
  const before = [];
  for (const id of touched) { const b = await get(id); before.push({ id, before: Object.fromEntries(UNDO_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) }); }
  fs.writeFileSync(undoOut, EJSON.stringify({ sweep: SWEEP, applied_at: new Date(), books: before }, null, 1) + '\n');
  console.log(`undo file: ${undoOut} (${before.length} books)`);

  const now = new Date();
  const gallery = (id, visible) => db.collection('gallery_images').updateMany({ book_id: id, book_visible: !visible }, { $set: { book_visible: visible } });
  const log = [];
  for (const s of todo) {
    if (s.action === 'publish') {
      const r = await setPublication(db, s.book, { state: 'public', by: BY, issue: ISSUE, note: `#${ISSUE}: not a duplicate`, from: ['hidden'], now });
      await gallery(s.book, true);
      log.push({ sweep: SWEEP, book_id: s.book, action: 'published', detail: { why: s.why, result: r.status } });
    } else if (s.action === 'swap') {
      await db.collection('books').updateOne({ id: s.keeper, duplicate_of: s.old }, { $unset: { duplicate_of: '' }, $set: { ...s.carry, updated_at: now } });
      const r1 = await setPublication(db, s.keeper, { state: 'public', by: BY, issue: ISSUE, note: `#${ISSUE}: keeper swap, was the hidden copy of ${s.old}`, from: ['hidden'], now });
      for (const id of s.repoint) await books.updateOne({ id, duplicate_of: s.old }, { $set: { duplicate_of: s.keeper, 'publication.duplicate_of': s.keeper, updated_at: now } });
      const r2 = await setPublication(db, s.old, { state: 'hidden', reason: 'duplicate', duplicateOf: s.keeper, by: BY, issue: ISSUE, note: `#${ISSUE}: keeper swap`, from: ['public'], now });
      await gallery(s.keeper, true); await gallery(s.old, false);
      log.push({ sweep: SWEEP, book_id: s.keeper, action: 'keeper-swapped', detail: { old_keeper: s.old, why: s.why, carried: s.carry, repointed: s.repoint, results: [r1.status, r2.status] } });
    } else {
      await books.updateOne({ id: s.keeper }, { $set: { ...s.carry, updated_at: now } });
      for (const id of s.repoint) await books.updateOne({ id, duplicate_of: s.book }, { $set: { duplicate_of: s.keeper, 'publication.duplicate_of': s.keeper, updated_at: now } });
      const r = await setPublication(db, s.book, { state: 'hidden', reason: 'duplicate', duplicateOf: s.keeper, by: BY, issue: ISSUE, note: `#${ISSUE}: second visible record of one manuscript`, from: ['public'], now });
      await gallery(s.book, false);
      log.push({ sweep: SWEEP, book_id: s.book, action: 'hidden-as-duplicate', detail: { keeper: s.keeper, why: s.why, carried: s.carry, result: r.status } });
    }
  }
  await recordSweepActions(db, log);

  // Read back.
  const fails = [];
  for (const s of todo) {
    if (s.action === 'publish') { const b = await get(s.book); if (!(b.visible === true && !b.hidden_reason && !b.duplicate_of)) fails.push(`${s.book}: not public`); }
    else {
      const [kid, oid] = s.action === 'swap' ? [s.keeper, s.old] : [s.keeper, s.book];
      const k = await get(kid), o = await get(oid);
      if (!(k.visible === true && !k.duplicate_of)) fails.push(`${kid}: keeper not public or still pointing`);
      if (!(o.visible === false && o.hidden_reason === 'duplicate' && o.duplicate_of === kid)) fails.push(`${oid}: not hidden as a duplicate of ${kid}`);
      if (await db.collection('gallery_images').countDocuments({ book_id: oid, book_visible: true })) fails.push(`${oid}: gallery rows still marked visible`);
      if (await books.countDocuments({ duplicate_of: oid, id: { $ne: kid } })) fails.push(`${oid}: other records still point at it`);
    }
  }
  console.log(fails.length ? `READ-BACK FAILED:\n${fails.join('\n')}` : `applied and read back: ${todo.length} steps, ${log.length} sweep_log rows`);
  if (fails.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await withMongo(main, { socketTimeoutMs: 600_000, timeoutMs: 1_800_000 });
