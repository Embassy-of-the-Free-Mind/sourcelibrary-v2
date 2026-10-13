#!/usr/bin/env node
/**
 * Link hand-verified witnesses of one work onto the work_id we already hold (#4392).
 *
 * PRIOR ART: scripts/maintenance/merge-work-clusters.mjs — its HIGH lanes need a
 * canon seed, an identical normalised title, or a shared edition_key, and its
 * containment lane is author-anchored; a witness whose title is spelled
 * differently ("apud"/"Apvd") AND whose byline differs ("Trigault" / "Ricci,
 * Matteo" / the mis-attributed "Ricius Portae Lucis") reaches none of them and is
 * never even queued. scripts/maintenance/link-graeco-arabic-works.mjs — fills
 * EMPTY work_ids only; these books already carry a (wrong) local mint.
 *
 * WHY IT MATTERS. Phase 2 of the orchestrator skips a book when a full-text copy
 * of the same work is already complete (scripts/workers/lib/work-copy-dedup.mjs),
 * and that test is keyed on work_id. A copy stranded on its own local id reads
 * as unstarted work and is OCR'd and translated a second time.
 *
 * DESIGN — a pinned manifest, not a matcher:
 *   - Every row names ONE book by id, the work_id it must carry right now, and
 *     a title test. If either no longer holds, the row is skipped, not forced:
 *     someone else has moved it since this was verified.
 *   - Every target is a cluster that already holds books; nothing is minted.
 *   - Retired ids are aliased only when their whole cluster moves
 *     (remintAliasPlan, work-identity.md), so /work/<old> keeps resolving.
 *   - Backup + `work_id_merges` provenance + a sweep_log row per book.
 *
 * To link another verified pair, add a row to MANIFEST with the evidence you
 * read (title page, incipit) — not a pattern.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/link-verified-work-witnesses.mjs
 *   node --env-file=.env.production.local scripts/maintenance/link-verified-work-witnesses.mjs --apply
 * After --apply: node scripts/workers/sync-books-catalog.mjs  (books_catalog carries work_id)
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { remintAliasPlan } from '../lib/work-id-remint.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'link-verified-work-witnesses';
const BACKUP = 'scripts/output/link-verified-work-witnesses-backup.json';
const SOURCE = 'work-merge:hand-adjudicated';

// Ricci/Trigault, De Christiana expeditione apud Sinas (Augsburg 1615).
// Q5244314 checked on Wikidata 2026-10-12: P31 literary work, P50 Nicolas Trigault.
const EXPEDITIONE = 'Q5244314';
// Bartolomeo Ricci, De imitatione libri tres — the cluster the two 1545 Aldine copies share.
const IMITATIONE = 'local:a:ricci-bartolomeo:2-ad-alfonsum-alumnum-atestium-bartholomaei-ferrariensium-filium-herculis-imitat';

export const MANIFEST = [
  {
    id: '69b51e48ff09e4fe943ab2a9', issue: 4392, to: EXPEDITIONE,
    from: 'local:n:matteo-nicolas-ricci-tri:ab-apvd-christiana-expeditione-jesv-sinas-societate-svscepta',
    title: /christiana expeditione ap[uv]d sinas/i,
    evidence: 'BSB bsb11397115. OCR p7 dedication "Nicolaus Trigautius Societatis IESV" to Paul V; p11 "Liber hic ... posthumus P. Matthaei Ricij partus".',
  },
  {
    id: '69b51e4b768235dc6598f5aa', issue: 4392, to: EXPEDITIONE,
    from: 'local:n:lucis-portae-ricius:apud-christiana-expeditione-iesu-sinas-societate-suscepta',
    title: /christiana expeditione ap[uv]d sinas/i,
    evidence: 'BSB bsb10691297. OCR p1 head-title "DE CHRISTIANA EXPEDITIONE APVD SINAS AB SOCIETATE IESV SVSCEPTA. Liber primus", running heads "APVD SINAS LIBER I". The byline "Ricius Portae Lucis" is a catalogue error, not a different work.',
  },
  {
    id: '69b6841a70c69d645a7332a1', issue: 4392, to: EXPEDITIONE,
    from: 'local:n:nicolas-trigault:ab-ad-apud-christiana-commentariis-eiusdem-ex-expeditione-jesu-libri-matthaei-pa',
    title: /christiana expeditione ap[uv]d sinas/i,
    evidence: 'e-rara 11863052, no OCR yet (held, #5470). Catalogue title in full: "... ex P. Matthaei Ricii eiusdem Societatis commentariis, libri V, ad S.D.N. Paulum V", author Trigault, 1615, 684 pp like the BSB copy.',
  },
  {
    id: '6a0857d049638a50931c5a32', issue: 4392, to: IMITATIONE,
    from: 'local:a:torresano-bernardo:ad-alfonsum-atestium-bartholomaei-imitatione-libri-principem-riccii-tres',
    title: /riccii de imitatione libri tres/i,
    evidence: '1557 edition. OCR p10 title page "BARTHOLOMAEI RICCII DE IMITATIONE LIBRI TRES, AD Alfonsum Atestium Principem". Torresano is the printer (#3894); the author field is left for that issue.',
  },
  {
    id: '6a08524015c643eb1af4c8c2', issue: 4392, to: IMITATIONE,
    from: 'local:n:bartolomeo-ricci:books-imitation-three',
    title: /riccii de imitatione libri tres/i,
    evidence: 'Google Books scan of the 1545 Aldine, already marked duplicate_of 6a08577f49638a50931c4d65, which sits on the target id. Same catalogue title, letter for letter.',
  },
];

/**
 * Pure planner: which manifest rows still hold against the books as they are now.
 * `current` = Map(book id -> { work_id, title }); `clusterSize` = Map(work_id -> n).
 */
export function planLinks(manifest, current, clusterSize) {
  const writes = [];
  const skipped = [];
  for (const row of manifest) {
    const b = current.get(row.id);
    if (!b) { skipped.push({ row, reason: 'book not found' }); continue; }
    if (b.work_id === row.to) { skipped.push({ row, reason: 'already linked' }); continue; }
    if (b.work_id !== row.from) { skipped.push({ row, reason: `work_id moved since verification (now ${b.work_id || 'empty'})` }); continue; }
    if (!row.title.test(b.title || '')) { skipped.push({ row, reason: 'title no longer matches the verified one' }); continue; }
    // Linking into a cluster that holds nothing would be minting an id by another name.
    if (!(clusterSize.get(row.to) > 0)) { skipped.push({ row, reason: `target ${row.to} holds 0 books` }); continue; }
    writes.push(row);
  }
  return { writes, skipped };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const cur = await books.find({ id: { $in: MANIFEST.map(r => r.id) } }, { projection: { _id: 0, id: 1, work_id: 1, title: 1 } }).toArray();
  const current = new Map(cur.map(b => [b.id, b]));
  const clusterSize = new Map();
  for (const to of new Set(MANIFEST.map(r => r.to))) clusterSize.set(to, await books.countDocuments({ work_id: to }));

  const { writes, skipped } = planLinks(MANIFEST, current, clusterSize);
  const { aliasFor, tally } = await remintAliasPlan(books, writes.map(w => ({ id: w.id, work_id: w.to })));

  for (const w of writes) {
    console.log(`LINK  ${w.id}  "${String(current.get(w.id).title).slice(0, 60)}"\n      ${w.from}\n   -> ${w.to}${aliasFor.has(w.id) ? '  (old id aliased)' : ''}`);
  }
  for (const s of skipped) console.log(`SKIP  ${s.row.id}: ${s.reason}`);
  console.log(`\n${writes.length} to link, ${skipped.length} skipped; old ids — renamed ${tally.renamed}, partial ${tally.partial}, split ${tally.split}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await client.close(); return; }
  if (writes.length === 0) { await client.close(); return; }

  mkdirSync('scripts/output', { recursive: true });
  // Merge, never overwrite: a re-run must not shrink the restore set.
  const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { sweep: SWEEP, records: {} };
  for (const w of writes) if (!backup.records[w.id]) backup.records[w.id] = { work_id: w.from };
  writeFileSync(BACKUP, JSON.stringify(backup, null, 1));

  const now = new Date();
  const done = [];
  for (const w of writes) {
    const alias = aliasFor.get(w.id);
    const res = await books.updateOne(
      // Re-assert the old id at write time: we never overwrite someone else's answer.
      { id: w.id, work_id: w.from },
      {
        $set: { work_id: w.to, work_id_source: SOURCE, updated_at: now },
        ...(alias ? { $addToSet: { work_id_aliases: alias } } : {}),
      }
    );
    if (res.modifiedCount !== 1) { console.log(`  skipped ${w.id} (moved since planning)`); continue; }
    done.push({ ...w, alias });
    await recordSweepAction(db, {
      sweep: SWEEP, book_id: w.id, action: 'linked-to-existing-work',
      detail: { from: w.from, to: w.to, issue: w.issue, evidence: w.evidence },
    });
  }

  // Aliases describe the WORK, so every edition on the survivor carries them
  // (same rule as merge-work-clusters.mjs), then one provenance row per target.
  for (const to of new Set(done.map(d => d.to))) {
    const mine = done.filter(d => d.to === to);
    const losers = mine.map(d => d.alias).filter(Boolean);
    if (losers.length) {
      await books.updateMany(
        { work_id: to, work_id_aliases: { $not: { $all: losers } } },
        { $set: { updated_at: now }, $addToSet: { work_id_aliases: { $each: losers } } }
      );
    }
    await db.collection('work_id_merges').insertOne({
      winner: to, losers, sources: [SOURCE], books_rewritten: mine.length,
      book_ids: mine.map(d => d.id), issue: mine[0].issue, backup: BACKUP, applied_at: now,
    });
  }

  const left = await books.countDocuments({ work_id: { $in: done.map(d => d.from) } });
  console.log(`\nAPPLIED — linked ${done.length}/${writes.length}; ${left} books still on a retired id (must be 0).`);
  console.log('NEXT: node scripts/workers/sync-books-catalog.mjs  (books_catalog carries work_id)');
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
