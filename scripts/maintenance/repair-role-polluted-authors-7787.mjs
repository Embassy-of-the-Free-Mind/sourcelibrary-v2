#!/usr/bin/env node
/**
 * Repair thesaurus docs whose NAME carries a role ("trans. Richard Francis
 * Burton", "Mao Yuanyi (Compiler)", "Johann Heinrich Alsted (trans. John
 * Birchensha)") (#7787).
 *
 * PRIOR ART: scripts/maintenance/dedup-canonical-authors.mjs — folds duplicate
 * docs into one with a `merged_into` tombstone; its merge shape is reused here.
 * It clusters by shared name strings and never looks at role annotations, so
 * these docs survived it.
 *
 * Each such doc renders as an author page for a person called "trans. Richard
 * Francis Burton". Two repairs, neither creates a doc:
 *
 *   rename  the doc is the person (anchored to Wikidata/VIAF/GND, or no clean
 *           doc for the name exists): set `canonical_name` to the name without
 *           the role. The slug stays, so every URL keeps working.
 *   merge   a clean doc for the same person exists: the polluted doc becomes a
 *           tombstone `{ merged_into, merge_run, is_person: false }` (the read
 *           path follows it and redirects), its slug joins the target's
 *           `variant_slugs`, and books linked to it move their `author_id` to
 *           the target. The polluted string is NOT added to the target's
 *           variants: a role-annotated variant is a match trapdoor.
 *
 * A doc is touched only when its name actually parses with a role, so a slug
 * like "ed-..." for a man called Ed is left alone. An anchored doc is never
 * merged away; a name matching several clean docs is skipped and listed.
 * Every write logs a sweep_log row (books) or a `merged_from` / `rename_7787`
 * record (authors) with the before values. `--undo --apply` reverses it.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-role-polluted-authors-7787.mjs           # plan
 *   node --env-file=.env.production.local scripts/maintenance/repair-role-polluted-authors-7787.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-role-polluted-authors-7787.mjs --undo --apply
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { bookYear, loadAuthorIndex, POLLUTED_SLUG } from '../lib/contributors.mjs';
import { classifyVariant, splitContributors } from '../lib/variant-shape.mjs';
import { stripRelator } from '../lib/name-equivalence.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const RUN = 'role-polluted-authors-7787';
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const OUT = 'scripts/output/role-polluted-authors-7787.json';

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');
const books = db.collection('books');

if (UNDO) {
  const tombs = await authors.find({ merge_run: RUN }).toArray();
  const renamed = await authors.find({ 'rename_7787.run': RUN }).toArray();
  const moved = await db.collection('sweep_log').find({ sweep: RUN, action: 'author-id-moved' }).toArray();
  console.log(`[undo] ${tombs.length} tombstones, ${renamed.length} renames, ${moved.length} book moves`);
  if (APPLY) {
    for (const r of moved) await books.updateOne({ _id: r.detail.book_oid ?? r.book_id, author_id: r.detail.after }, { $set: { author_id: r.detail.before } });
    for (const t of tombs) {
      await authors.updateOne({ _id: t._id }, { $unset: { merged_into: '', merge_run: '' }, $set: { is_person: t.merged_from_7787?.is_person ?? true } });
      await authors.updateOne({ _id: t.merged_into }, { $pull: { variant_slugs: t._id, merged_from: { run: RUN, slug: t._id } } });
    }
    for (const r of renamed) await authors.updateOne({ _id: r._id }, { $set: { canonical_name: r.rename_7787.before }, $unset: { rename_7787: '' } });
    console.log('[undo] done');
  }
  await mc.close();
  process.exit(0);
}

const index = await loadAuthorIndex(db);
const anchored = (d) => !!(d.wikidata_id || d.viaf_id || (d.gnd_ids || []).length);

const plan = { rename: [], merge: [], skip: [] };
for await (const d of authors.find({ _id: POLLUTED_SLUG, merged_into: { $exists: false } }).batchSize(500)) {
  const name = d.canonical_name || '';
  const shape = classifyVariant(name).shape;
  const parts = ['script_pair', 'institutional'].includes(shape) ? [] : splitContributors(name);
  const hasRole = parts.some((p) => p.role) || parts.length > 1;
  if (!hasRole) { plan.skip.push({ slug: d._id, name, why: 'name carries no role' }); continue; }
  // The doc is about the first-named person: the author in "A (trans. B)",
  // the editor in "ed. W. R. Paton".
  const clean = stripRelator(parts[0].name);
  // Without its role the name may still list several people ("Aeschylus,
  // Sophocles, Euripides", "Woodroffe/Mishra"). Renaming would hide that; the
  // doc needs splitting into people, which is a different repair.
  const bare = name.replace(/\s*[([][^)\]]*[)\]]/g, '');
  const cleanBare = clean.replace(/\s*[([][^)\]]*[)\]]/g, '');
  if (/[/|;&]|\s(?:and|und|et)\s/i.test(bare) || (cleanBare.match(/,/g) || []).length >= 2
      || /,\s*\S+\s+\S+/.test(cleanBare)) {
    plan.skip.push({ slug: d._id, name, clean, why: 'still names several people' });
    continue;
  }
  const linkedBooks = await books.find({ author_id: d._id }, { projection: { published: 1, year: 1, date: 1 } }).toArray();
  const years = linkedBooks.map((b) => bookYear(b.published ?? b.year ?? b.date)).filter(Boolean);
  const r = index.resolve(clean, null, years.length ? Math.min(...years) : null, parts[0].role ?? 'aut');
  const row = { slug: d._id, name, clean, linked_books: linkedBooks.length, anchored: anchored(d) };
  // A surname alone ("ed. Mitscherlich") is not enough to fold a doc into a
  // person: the one doc carrying that surname is often a namesake.
  const fullName = (clean.replace(/\s*\([^)]*\)/g, '').match(/\p{L}{2,}/gu) || []).length >= 2;
  if (anchored(d) || r.candidates === 0 || !fullName) plan.rename.push(row);
  else if (r.author_id) plan.merge.push({ ...row, into: r.author_id });
  else plan.skip.push({ ...row, why: `matches ${r.candidates} clean docs` });
}

mkdirSync('scripts/output', { recursive: true });
writeFileSync(OUT, JSON.stringify(plan, null, 2));
const sum = (rows) => rows.reduce((a, r) => a + (r.linked_books || 0), 0);
console.log(`rename ${plan.rename.length} (${sum(plan.rename)} books keep their link)`);
for (const r of plan.rename) console.log(`  ${r.slug}: "${r.name}" -> "${r.clean}"${r.anchored ? ' [anchored]' : ''}`);
console.log(`merge ${plan.merge.length} (${sum(plan.merge)} books move author_id)`);
for (const r of plan.merge) console.log(`  ${r.slug} -> ${r.into}  ("${r.name}", ${r.linked_books} books)`);
console.log(`skip ${plan.skip.length}`);
for (const r of plan.skip) console.log(`  ${r.slug}: "${r.name}" (${r.why})`);
console.log(`plan: ${OUT}`);

if (!APPLY) { console.log('\nPlan only. Re-run with --apply.'); await mc.close(); process.exit(0); }

const at = new Date().toISOString();
let renamed = 0; let merged = 0; let moved = 0;
for (const r of plan.rename) {
  const res = await authors.updateOne({ _id: r.slug, canonical_name: r.name, merged_into: { $exists: false } },
    { $set: { canonical_name: r.clean, rename_7787: { run: RUN, before: r.name, at } } });
  renamed += res.modifiedCount;
}
for (const r of plan.merge) {
  const d = await authors.findOne({ _id: r.slug });
  const res = await authors.updateOne({ _id: r.slug, merged_into: { $exists: false } },
    { $set: { merged_into: r.into, merge_run: RUN, is_person: false, merged_from_7787: { is_person: d.is_person ?? null } } });
  if (!res.modifiedCount) continue;
  merged++;
  await authors.updateOne({ _id: r.into }, {
    $addToSet: { variant_slugs: r.slug },
    $push: { merged_from: { run: RUN, slug: r.slug, canonical_name: d.canonical_name, variants: d.variants ?? [], at } },
  });
  for await (const b of books.find({ author_id: r.slug }, { projection: { _id: 1 } }).batchSize(500)) {
    const u = await books.updateOne({ _id: b._id, author_id: r.slug }, { $set: { author_id: r.into } });
    if (!u.modifiedCount) continue;
    moved++;
    await recordSweepAction(db, { sweep: RUN, book_id: String(b._id), action: 'author-id-moved',
      detail: { fields: ['author_id'], before: r.slug, after: r.into, book_oid: b._id } });
  }
}
console.log(`\nAPPLIED: renamed ${renamed}, merged ${merged}, moved author_id on ${moved} books`);
await mc.close();
