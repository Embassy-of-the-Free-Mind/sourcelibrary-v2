#!/usr/bin/env node
/**
 * Fold bare language codes into language names on `books` (v2#8628):
 * `de` → German, `la` → Latin, `ger` → German, `fr` → French …
 *
 * WHY: every per-language view, review lane, router cell and the /quality
 * tables key on the name, so a book stored as `de` is counted nowhere.
 *
 * SPELLING ONLY. `language` is the EDITION's language
 * (.claude/docs/invariants/language-fields.md); this never changes which
 * language a book has, only how it is written. The map is the closed vocabulary
 * in scripts/lib/language-normalize.mjs (`foldBareLanguageCode`): a code the
 * table does not know (`nds`, `peo`, `roh`), a placeholder (`und`, `mul`,
 * `zxx`) and a code the two vocabularies read differently (`el`) are LEFT and
 * listed.
 *
 * The 2026-11-13 run also folded two title-cased values (`Frm`, `Yid`, one book each); the
 * function has since stopped folding title case, which is how a name is written (`Mon`, `San`).
 *
 * Fields: `language`, `original_language`, and each element of `languages[]`.
 * `languages[]` is not created where it is absent.
 *
 * Each changed book gets a `sweep_log` row with the old and new values BEFORE
 * its data write (invariants/field-sprawl.md: a row, not a column), and
 * `updated_at` is bumped so the next `sync-books-catalog` run mirrors the name
 * into the Supabase catalogue. No page revalidation.
 *
 * PRIOR ART: scripts/maintenance/normalize-language-tags.mjs — folds codes too, but through its
 * own private CODE map (a fifth vocabulary), rewrites languages[] / language_multi on every book,
 * stamps `language_raw` columns and writes no sweep_log row; this one is the pinned table only.
 *
 * Usage (dry run is the default):
 *   node --env-file=.env.production.local scripts/maintenance/fold-language-codes-8628.mjs [--out DIR]
 *   node --env-file=.env.production.local scripts/maintenance/fold-language-codes-8628.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/fold-language-codes-8628.mjs --revert   # from sweep_log
 */
import { MongoClient, ObjectId } from 'mongodb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { foldBareLanguageCode } from '../lib/language-normalize.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'fold-language-codes-8628';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? process.argv[outArg + 1] : process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp';

/** A value that looks like a code, whether or not the table can fold it. */
const CODE_SHAPED = /^\s*[A-Za-z]{2,3}(?:[-_](?:[A-Za-z]{2}|[A-Za-z]{4}))?\s*$/;
const isLive = (d) => d.visible === true && d.pages_count > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The changes one book needs: `{ field: { from, to } }`, empty when none. */
export function planBook(d) {
  const changes = {};
  for (const f of ['language', 'original_language']) {
    const to = foldBareLanguageCode(d[f]);
    if (to !== d[f]) changes[f] = { from: d[f], to };
  }
  if (Array.isArray(d.languages)) {
    const to = [];
    for (const x of d.languages) {
      const y = foldBareLanguageCode(x);
      if (!to.includes(y)) to.push(y);
    }
    if (!same(to, d.languages)) changes.languages = { from: d.languages, to };
  }
  return changes;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  try {
    if (REVERT) return await revert(db, books);

    const plan = [];
    const counts = {}; // "field: from → to" -> { live, other }
    const left = {}; // "field: value" -> { live, other }
    const samples = {};
    const bump = (o, k, d) => { (o[k] ??= { live: 0, other: 0 })[isLive(d) ? 'live' : 'other']++; };
    const cursor = books.find({}, {
      projection: { id: 1, title: 1, language: 1, original_language: 1, languages: 1, visible: 1, pages_count: 1, text_role: 1 },
    }).batchSize(5000);
    for await (const d of cursor) {
      const changes = planBook(d);
      for (const f of ['language', 'original_language']) {
        if (!changes[f] && typeof d[f] === 'string' && CODE_SHAPED.test(d[f]) && foldBareLanguageCode(d[f]) === d[f]) {
          // Code-shaped and not folded. A short NAME the table knows (Lao, Mam) is not a leftover.
          bump(left, `${f}: ${d[f]}`, d);
        }
      }
      if (!Object.keys(changes).length) continue;
      plan.push({ _id: d._id, book_id: String(d.id || d._id), title: d.title, live: isLive(d), changes });
      for (const [f, c] of Object.entries(changes)) {
        const k = f === 'languages' ? `languages[]: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}` : `${f}: ${c.from} → ${c.to}`;
        bump(counts, k, d);
        if (f === 'language') {
          const s = (samples[k] ??= []);
          // Live books first in the sample: they are the ones a reader sees.
          if (s.length < 10 && (isLive(d) || s.length < 5)) s.push(`${isLive(d) ? 'live  ' : 'hidden'} ${String(d.id || d._id)}  ${String(d.title || '').slice(0, 90)}`);
        }
      }
    }

    const byTotal = (o) => Object.entries(o).sort((a, b) => (b[1].live + b[1].other) - (a[1].live + a[1].other));
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${plan.length} books to change (${plan.filter((p) => p.live).length} live)\n`);
    console.log('change                                              live   not live');
    for (const [k, v] of byTotal(counts)) console.log(`  ${k.padEnd(48)} ${String(v.live).padStart(6)} ${String(v.other).padStart(8)}`);
    console.log('\nLEFT (code-shaped, not folded: placeholder, unknown to the table, or ambiguous)');
    for (const [k, v] of byTotal(left)) console.log(`  ${k.padEnd(48)} ${String(v.live).padStart(6)} ${String(v.other).padStart(8)}`);
    console.log('\nSAMPLES');
    for (const [k, s] of Object.entries(samples).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${k}`);
      for (const line of s) console.log(`    ${line}`);
    }

    mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(OUT, `${SWEEP}-${APPLY ? 'backup' : 'plan'}-${stamp}.jsonl.gz`);
    writeFileSync(backupPath, gzipSync(plan.map((p) => JSON.stringify(p)).join('\n') + '\n'));
    console.log(`\n${APPLY ? 'Revert backup' : 'Plan'}: ${backupPath}`);
    if (!APPLY) return;

    // sweep_log BEFORE the data write, chunk by chunk, so a crash leaves a row
    // for every write and at most one chunk of rows without one.
    const modified = {};
    let skipped = 0;
    const now = new Date();
    for (let i = 0; i < plan.length; i += 500) {
      const chunk = plan.slice(i, i + 500);
      await recordSweepActions(db, chunk.map((p) => ({
        sweep: SWEEP, book_id: p.book_id, action: 'language-code-folded', detail: { issue: 'v2#8628', changes: p.changes },
      })));
      const res = await books.bulkWrite(chunk.map((p) => {
        // Guard on the value read: a book another writer changed meanwhile is skipped, not overwritten.
        const filter = { _id: p._id };
        const $set = { updated_at: now };
        for (const [f, c] of Object.entries(p.changes)) { filter[f] = c.from; $set[f] = c.to; }
        return { updateOne: { filter, update: { $set } } };
      }), { ordered: false });
      skipped += chunk.length - res.modifiedCount;
      // Per-change counts are verified by the after-scan; here count what the server took.
      modified.books = (modified.books || 0) + res.modifiedCount;
      console.log(`  wrote ${Math.min(i + 500, plan.length)}/${plan.length}`);
    }
    console.log(`\nmodifiedCount: ${modified.books} books; skipped (changed under us): ${skipped}`);
  } finally {
    await client.close();
  }
}

/** Put back every value this sweep changed, where the book still holds what the sweep wrote. */
async function revert(db, books) {
  const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'language-code-folded' }).toArray();
  let n = 0;
  for (const r of rows) {
    // book_id is `id` where the book has one, else the stringified `_id` (string or ObjectId).
    const idFilter = { $or: [{ id: r.book_id }, { _id: r.book_id }, ...(ObjectId.isValid(r.book_id) ? [{ _id: new ObjectId(r.book_id) }] : [])] };
    for (const [f, c] of Object.entries(r.detail?.changes || {})) {
      if (!APPLY) { n++; continue; }
      const res = await books.updateOne({ ...idFilter, [f]: c.to }, { $set: { [f]: c.from, updated_at: new Date() } });
      n += res.modifiedCount;
    }
  }
  console.log(`${APPLY ? 'REVERTED' : 'DRY RUN revert (add --apply)'}: ${n} field values from ${rows.length} sweep_log rows`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
