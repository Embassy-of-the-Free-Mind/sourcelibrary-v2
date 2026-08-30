#!/usr/bin/env node
/**
 * #3951 C+D — repair four attributions that point at the wrong person.
 *
 * Every case here is the defect `.claude/docs/attribution-health.md` calls the
 * worst one: a book that is LINKED and ANCHORED, to a stranger. Reachability
 * looks perfect and the identity is wrong, so no tier count can see it.
 *
 *   1. wang-zhi-2  wrong QID.   Q11573215 (a 王質 who died 570) → Q16904086
 *                  (王質 1135–1189, zi 景文, hao 雪山), the author of 詩總聞.
 *                  16 books.
 *
 *   2. lu-ji-2     wrong QID *and* wrong VIAF, both for the same stranger.
 *                  The doc is 陸璣, the Wu-era naturalist of 毛詩草木鳥獸蟲魚疏;
 *                  it carries Q2326363 = 陸機, the Jin poet-general (261–303),
 *                  and VIAF 111313427, which is the VIAF *on that same Wikidata
 *                  item* (P214). So this is ONE inherited error, not two.
 *                  The error is upstream: Q2326363 lists 陸璣 among its zh
 *                  aliases, so any name-driven resolver lands on the general.
 *                  LoC n81054056 is clean — only 陸機's own courtesy names.
 *                  There is no Wikidata item for the naturalist, so we STRIP
 *                  both anchors rather than swapping them. 12 books drop T4→T3;
 *                  that is the metric correctly recording that they were never
 *                  anchored, only anchored-looking.
 *
 *   3. zhu-xi      variant trapdoor that already fired. The 朱熹 doc (Q9397)
 *                  carries "Zhu Su" in `variants` and `zhu-su` in
 *                  `variant_slugs` — 朱橚, a different man, a Ming prince, who
 *                  has his own correctly-anchored doc (Q838433) holding 306
 *                  books. One book (救荒本草) was linked to Zhu Xi through it.
 *                  De-match the variant and re-point the book.
 *
 *   4. persius     the slug points at the wrong Persius. `_id: persius` is the
 *                  Amsterdam printer-poet Dirck Pietersz Pers (1 book); the
 *                  Roman satirist sits at `persius-2` (14 books). `_id` is the
 *                  FK books point at, so the printer is MIGRATED to a new _id
 *                  and the satirist takes `slug: persius`.
 *
 * WHY NOT FIX THIS IN THE RESOLVER. `resolveAuthorSlug` matches
 * `$or: [{_id}, {variant_slugs}, {slug}]`, so preferring `slug` over `_id`
 * would fix Persius generically. It is NOT safe: 56 routing keys are contested
 * and `zhu-su` is one of them — Zhu Xi claims it as a variant while the real
 * Zhu Su doc holds 306 books under it as `_id`. Reordering would re-route all
 * 306 to Zhu Xi. Case 3 removes that particular claim; the general contest
 * stays, and belongs in its own issue.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-author-anchors-3951.mjs
 *   node --env-file=.env.production.local scripts/maintenance/fix-author-anchors-3951.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/fix-author-anchors-3951.mjs --revert
 *
 * The backup MERGES on id and lets the EARLIEST `before` win, so a second
 * --apply cannot overwrite the true original (author-identity.md).
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backups', 'fix-author-anchors-3951.json');
const RUN = 'anchor-repair-3951';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const PRINTER_OLD = 'persius';
const PRINTER_NEW = 'dirck-pietersz-pers';
const SATIRIST = 'persius-2';
const ZHU_SU_BOOK = '6992ca83d4d545ae73fee34e';

function loadBackup() {
  if (!existsSync(BACKUP)) return { authors: {}, books: {}, deleted: {}, runs: [] };
  return JSON.parse(readFileSync(BACKUP, 'utf8'));
}

/** Merge on id, earliest `before` wins — never clobber the true original. */
function remember(bk, kind, id, before) {
  if (!bk[kind][id]) bk[kind][id] = before;
}

function saveBackup(bk) {
  bk.runs.push(new Date().toISOString());
  writeFileSync(BACKUP, JSON.stringify(bk, null, 2));
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const A = db.collection('authors');
const B = db.collection('books');

const say = (...a) => console.log(...a);
const plan = [];
const record = (what, detail) => plan.push({ what, detail });

if (REVERT) {
  const bk = loadBackup();
  if (!bk.runs.length) { say('No backup to revert.'); await client.close(); process.exit(0); }
  let n = 0;
  for (const [id, doc] of Object.entries(bk.authors)) {
    if (APPLY) { await A.replaceOne({ _id: id }, doc, { upsert: true }); n++; }
    else say('would restore author', id);
  }
  for (const [id, before] of Object.entries(bk.books)) {
    if (APPLY) { await B.updateOne({ _id: new ObjectId(id) }, { $set: before }); n++; }
    else say('would restore book', id, JSON.stringify(before));
  }
  for (const id of Object.keys(bk.deleted)) {
    if (APPLY) { await A.deleteOne({ _id: id }); n++; }
    else say('would delete author created by this run:', id);
  }
  say(APPLY ? `Reverted ${n} documents.` : 'Dry run — pass --apply to revert.');
  await client.close();
  process.exit(0);
}

const bk = loadBackup();
const now = new Date().toISOString();

// ── 1. wang-zhi-2 — swap a wrong QID for the right one ────────────────────────
{
  const d = await A.findOne({ _id: 'wang-zhi-2' });
  const books = await B.countDocuments({ author_id: 'wang-zhi-2' });
  if (!d) throw new Error('wang-zhi-2 missing');
  record('wang-zhi-2 wikidata_id', `${d.wikidata_id} → Q16904086  (${books} books)`);
  if (APPLY) {
    remember(bk, 'authors', d._id, d);
    await A.updateOne({ _id: 'wang-zhi-2' }, {
      $set: {
        wikidata_id: 'Q16904086',
        anchor_correction: { run: RUN, prev_wikidata_id: d.wikidata_id ?? null, at: now },
        identity_note:
          'This is 王質 (1135–1189, zi 景文, hao 雪山), author of 詩總聞. Previously anchored to '
          + 'Q11573215, a bare homonym item dated 511–570 — the dates and the works cannot both be '
          + 'right. Q16904086 (CBDB 22799) carries both courtesy names and the correct dates.',
        updated_at: now,
      },
    });
  }
}

// ── 2. lu-ji-2 — strip an inherited anchor rather than swap it ────────────────
{
  const d = await A.findOne({ _id: 'lu-ji-2' });
  const books = await B.countDocuments({ author_id: 'lu-ji-2' });
  if (!d) throw new Error('lu-ji-2 missing');
  record('lu-ji-2 anchors', `UNSET wikidata_id=${d.wikidata_id} viaf_id=${d.viaf_id}  (${books} books → T4 becomes T3)`);
  if (APPLY) {
    remember(bk, 'authors', d._id, d);
    await A.updateOne({ _id: 'lu-ji-2' }, {
      $unset: { wikidata_id: '', viaf_id: '' },
      $set: {
        anchor_correction: {
          run: RUN, prev_wikidata_id: d.wikidata_id ?? null, prev_viaf_id: d.viaf_id ?? null, at: now,
        },
        identity_note:
          'This is 陸璣, the Wu-era author of 毛詩草木鳥獸蟲魚疏 — NOT 陸機 (261–303), the Jin '
          + 'poet-general. It previously carried Q2326363 and VIAF 111313427, which are both that '
          + 'other man (the VIAF is the P214 on that same Wikidata item). DO NOT RE-ANCHOR from the '
          + 'name alone: Wikidata Q2326363 lists 陸璣 among its zh aliases, so every name-driven '
          + 'resolver will land there again. No Wikidata item for the naturalist is known as of '
          + '2026-08-13; LoC n81054056 is 陸機 only. Unanchored on purpose.',
        updated_at: now,
      },
    });
  }
}

// ── 3. zhu-xi — de-match a variant that is a different person ─────────────────
{
  const d = await A.findOne({ _id: 'zhu-xi' });
  if (!d) throw new Error('zhu-xi missing');
  const stray = await B.findOne({ _id: new ObjectId(ZHU_SU_BOOK) }, { projection: { title: 1, author: 1, author_id: 1 } });
  record('zhu-xi variants', `drop "Zhu Su" from variants and "zhu-su" from variant_slugs (Q838433 holds that person)`);
  record('book re-point', `${stray?.title?.slice(0, 40)} — author_id ${stray?.author_id} → zhu-su`);
  if (APPLY) {
    remember(bk, 'authors', d._id, d);
    remember(bk, 'books', ZHU_SU_BOOK, { author_id: stray?.author_id ?? null });
    await A.updateOne({ _id: 'zhu-xi' }, {
      $pull: { variants: 'Zhu Su', variant_slugs: 'zhu-su' },
      $set: {
        identity_note:
          '朱熹 (1130–1200), Q9397. "Zhu Su" / zhu-su were removed as match keys on 2026-08-13: '
          + 'that is 朱橚, a Ming prince with his own anchored doc (zhu-su, Q838433, 306 books). '
          + 'The variant had already pulled 救荒本草 onto this doc.',
        updated_at: now,
      },
    });
    await B.updateOne({ _id: new ObjectId(ZHU_SU_BOOK) }, { $set: { author_id: 'zhu-su', updated_at: now } });
  }
}

// ── 4. persius — migrate the printer off the _id the satirist should own ──────
{
  const printer = await A.findOne({ _id: PRINTER_OLD });
  const satirist = await A.findOne({ _id: SATIRIST });
  if (!printer || !satirist) throw new Error('persius docs missing');
  const printerBooks = await B.find({ author_id: PRINTER_OLD }, { projection: { title: 1 } }).toArray();
  const satiristBooks = await B.countDocuments({ author_id: SATIRIST });
  record('persius migration',
    `printer "${printer.canonical_name}" (${printerBooks.length} books) ${PRINTER_OLD} → ${PRINTER_NEW}; `
    + `satirist (${satiristBooks} books) takes slug "${PRINTER_OLD}"`);

  if (APPLY) {
    remember(bk, 'authors', printer._id, printer);
    remember(bk, 'authors', satirist._id, satirist);
    for (const b of printerBooks) remember(bk, 'books', String(b._id), { author_id: PRINTER_OLD });

    // a. mint the printer at its own _id, carrying every match key it had
    const migrated = {
      ...printer,
      _id: PRINTER_NEW,
      slug: PRINTER_NEW,
      variant_slugs: [...new Set([...(printer.variant_slugs || []).filter((s) => s !== PRINTER_OLD), PRINTER_NEW, 'pers-dirck-pietersz'])],
      identity_note:
        (printer.identity_note ? printer.identity_note + ' ' : '')
        + `Migrated off _id "${PRINTER_OLD}" on 2026-08-13 (#3951 D) so /author/persius reaches `
        + 'the Roman satirist, who has 14 books to this doc\'s 1. Books were re-pointed to this _id.',
      migrated_from: PRINTER_OLD,
      updated_at: now,
    };
    await A.insertOne(migrated);
    bk.deleted[PRINTER_NEW] = true; // created by this run; --revert removes it

    // b. move its books to the new FK
    const moved = await B.updateMany({ author_id: PRINTER_OLD }, { $set: { author_id: PRINTER_NEW, updated_at: now } });
    record('printer books moved', `${moved.modifiedCount} of ${printerBooks.length}`);

    // c. vacate the old _id, then hand the slug to the satirist
    await A.deleteOne({ _id: PRINTER_OLD });
    await A.updateOne({ _id: SATIRIST }, {
      $set: {
        slug: PRINTER_OLD,
        variant_slugs: [...new Set([...(satirist.variant_slugs || []), SATIRIST, PRINTER_OLD])],
        identity_note:
          'Aulus Persius Flaccus (34–62), Q332785. Took slug "persius" on 2026-08-13 (#3951 D); '
          + '_id stays "persius-2" because books point at it. The Amsterdam printer-poet who held '
          + 'the slug moved to "dirck-pietersz-pers".',
        updated_at: now,
      },
    });
  }
}

say('');
say(APPLY ? '── APPLIED ──' : '── DRY RUN (pass --apply) ──');
for (const p of plan) say(' ', p.what.padEnd(22), p.detail);
if (APPLY) { saveBackup(bk); say('\nBackup merged into', BACKUP); }

await client.close();
