#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/em-dash-titles-6215.mjs — the same shape (rewrite title +
// display_title with a pinned $set and an undo), but its rule is a separator, not a shelfmark, and it
// only reads live books. The rule itself lives in scripts/lib/shelfmark-title.mjs, shared with the
// importer (scripts/iiif-discovery/import-from-cache.mjs) so new imports and this sweep agree.
/**
 * Work first, shelfmark after, for the Heidelberg manuscripts (#7270).
 *
 *   "Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 311: Konrad von Megenberg: Buch der Natur ; …"
 *   → "Konrad von Megenberg: Buch der Natur; Johannes Hartlieb: Kräuterbuch (Cod. Pal. germ. 311)"
 *
 * Every book (any visibility) whose title starts with the UB Heidelberg prefix. Writes `title`, and
 * `display_title` / `work_title` where they equal the old title, and `normalized_title` recomputed the
 * way the importer computes it. NEVER touches slug, id, edition_key, work_id or work_slug: links to
 * these books are cited. `updated_at` is bumped, which is what the Supabase catalogue sync keys on.
 *
 * Before any write: the undo file (one JSON line per book with every old value) is written and fsynced.
 * Each write is pinned to the old title, so a book retitled since the plan is left alone (`raced`).
 * One `sweep_log` row per book (sweep: heidelberg-work-first-titles-7270).
 *
 *   node --env-file=.env.production.local scripts/maintenance/heidelberg-work-first-titles-7270.mjs --undo-file=<path>           dry run + sample
 *   … --undo-file=<path> --apply
 *   … --restore=<undo file> [--apply]     put back every title this sweep wrote that is still unchanged
 *   … --other-repositories --undo-file=<path> [--apply]
 *        second pass (2026-10-26): every Heidelberg-portal book (image_source.provider heidelberg) whose
 *        title starts with ANY listed repository — the ones held elsewhere (Universitätsarchiv, Mainz,
 *        Bodleian …) keep their repository inside the parentheses — plus the HAND titles below, read
 *        from the Heidelberg catalogue because they carry no shelfmark to split on.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { workFirstTitle, HOST_REPOSITORY } from '../lib/shelfmark-title.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const APPLY = 'apply' in args;
const OTHER = 'other-repositories' in args;
const SWEEP = OTHER ? 'heidelberg-other-repository-titles-7270' : 'heidelberg-work-first-titles-7270';
// Titles with no shelfmark after the repository, so the rule cannot split them. Read from each book's
// Heidelberg manifest (2026-10-26): the Bodleian one names its shelfmark in the catalogue's Shelfmark
// field; the three UB Heidelberg letters' Shelfmark field is the library alone, so the work stands alone,
// as the host library is dropped everywhere else.
const HAND = OTHER ? {
  '6ac50088eefc6804b9d6c02e': 'Liber de perfectione Spirituali Interioris Hominis; Sequenzen und Auszüge (Oxford, Bodleian Library, MS. Laud Misc. 492)',
  '6ac51af50749a01cb81eef93': 'Briefe von Friedrich Maler an Carl Joseph Anton Mittermaier: Brief',
  '6ac51b220749a01cb81efa0c': 'Nachlass Carl Joseph Anton Mittermaier: Brief von Maurizio Bensa an Carl Joseph Anton Mittermaier',
  '6ac51b5b0749a01cb81f040a': 'Nachlass Max von Waldberg: Das Venusgärtlein [Ein Beitrag zur Geschichte des Volks- und Gesellschaftsliedes im 17. Jahrhundert, Band II]',
} : {};
const PREFIX_RE = new RegExp(`^${HOST_REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `);
// Same as import-from-cache.mjs, so a re-import dedups against what this sweep writes.
const normTitle = (t) => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

try {
  if (args.restore) {
    const rows = readFileSync(args.restore, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    let restored = 0, changed = 0;
    for (const r of rows) {
      if (!APPLY) continue;
      const res = await books.updateOne({ id: r.id, title: r.new_title }, { $set: { ...r.old, updated_at: new Date() } });
      if (res.modifiedCount) restored++; else changed++;
    }
    console.log(JSON.stringify({ rows: rows.length, restored, changed_since: changed, dry_run: !APPLY }));
  } else {
    const undoFile = args['undo-file'];
    if (!undoFile) { console.error('--undo-file=<path> is required (written before any write)'); process.exit(2); }
    const filter = OTHER ? { 'image_source.provider': 'heidelberg' } : { title: PREFIX_RE };
    const proj = { projection: { id: 1, title: 1, display_title: 1, work_title: 1, normalized_title: 1, visible: 1, pages_count: 1 } };
    const rows = (await books.find(filter, proj).toArray()).filter((b) => !OTHER || HAND[b.id] || workFirstTitle(b.title) !== b.title);
    const plan = [];
    for (const b of rows) {
      const next = (HAND[b.id] ?? workFirstTitle(b.title)).slice(0, 500);
      if (!next.trim() || next === b.title || PREFIX_RE.test(next)) { console.log(`REFUSED ${b.id}: ${b.title}`); continue; }
      const old = { title: b.title };
      const set = { title: next };
      if (b.display_title === b.title) { old.display_title = b.display_title; set.display_title = next; }
      if (b.work_title === b.title) { old.work_title = b.work_title; set.work_title = next; }
      if (b.normalized_title === normTitle(b.title)) { old.normalized_title = b.normalized_title; set.normalized_title = normTitle(next); }
      plan.push({ id: b.id, live: b.visible === true && b.pages_count > 0, old, set });
    }
    console.log(`books ${OTHER ? 'starting with a listed repository' : 'with the prefix'}: ${rows.length} (live ${plan.filter((p) => p.live).length}); planned ${plan.length}`);
    console.log(`fields: display_title ${plan.filter((p) => p.set.display_title).length}, work_title ${plan.filter((p) => p.set.work_title).length}, normalized_title ${plan.filter((p) => p.set.normalized_title).length}`);
    // A seeded spread through the plan, live books first: a sample to read, not a statistic.
    const live = plan.filter((p) => p.live);
    const step = Math.max(1, Math.floor(live.length / Number(args.sample || 20)));
    for (let i = 0; i < live.length && i / step < Number(args.sample || 20); i += step) console.log(`  ${live[i].old.title}\n    → ${live[i].set.title}`);
    if (APPLY) {
      if (existsSync(undoFile)) { console.error(`${undoFile} exists; refusing to overwrite an undo file`); process.exit(2); }
      writeFileSync(undoFile, plan.map((p) => JSON.stringify({ id: p.id, old: p.old, new_title: p.set.title })).join('\n') + '\n');
      const fd = openSync(undoFile, 'r'); fsyncSync(fd); closeSync(fd);
      console.log(`undo file: ${undoFile} (${plan.length} rows)`);
      const now = new Date();
      let written = 0, raced = 0;
      for (let i = 0; i < plan.length; i += 200) {
        const chunk = plan.slice(i, i + 200);
        const res = await books.bulkWrite(chunk.map((p) => ({ updateOne: { filter: { id: p.id, title: p.old.title }, update: { $set: { ...p.set, updated_at: now } } } })), { ordered: false });
        written += res.modifiedCount; raced += chunk.length - res.matchedCount;
        await recordSweepActions(db, chunk.map((p) => ({ sweep: SWEEP, book_id: p.id, action: 'retitled-work-first', detail: { old: p.old, new: p.set } })));
      }
      const left = OTHER
        ? (await books.find(filter, proj).toArray()).filter((b) => HAND[b.id] ? b.title !== HAND[b.id] : workFirstTitle(b.title) !== b.title).length
        : await books.countDocuments({ title: PREFIX_RE });
      console.log(JSON.stringify({ planned: plan.length, written, raced, prefix_left: left }));
    } else console.log('DRY RUN: nothing was written.');
  }
} finally { await client.close(); }
