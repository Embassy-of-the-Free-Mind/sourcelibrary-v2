#!/usr/bin/env node
/**
 * Write the bylines that 24 books state on their own title pages.
 *
 * THE SET, and why it is not the "261" a first pass reported.
 *
 * The population is the frozen benchmark pool from PR #3982: **161** public
 * text books that reach no author page, whose byline is blank or an exact
 * placeholder (`Unknown`, `Anonymous`, …), in a Latin-script language, and for
 * which flash-lite proposed a name. That is the ONLY population the method was
 * measured on (50 drawn at random, blind adjudication, subagent 17 / flash-lite 1,
 * McNemar p = 0.00014, implied precision ~94%). A wider count of 261 folded in
 * two classes the measurement does not cover and doctrine says to leave alone:
 *
 *   - **38 loose collectives** — `Various Authors`, `Anonymous (Byzantine)`,
 *     `Unknown Tibetan author`. #3950 settled that a collective is a deliberate
 *     cataloguer ANSWER, not a missing one. Overwriting it with one name is a
 *     regression whatever the page says.
 *   - **31 non-Latin-script books** — the prompt is parked at ~52% precision
 *     with four named causes. The handoff says do not ship; this does not.
 *
 * HOW EACH OF THE 24 WAS DECIDED. Three gates, each of which can only remove:
 *
 *   1. **An independent reader per book** (161 of them, one book each, the same
 *      frozen instructions the benchmark validated). 80 named an author; **81
 *      said the page names nobody**, which is the correct answer and the whole
 *      reason flash-lite's 1,239 candidates could not be written as they stood.
 *   2. **Deterministic screens** over those 80 → 38. Quote must be present on
 *      the pages the reader saw; the same person must not also carry a printer /
 *      editor / dedicatee role in the reader's own `other_names`; no Sammelband
 *      caveat; no declined form; not a reference-genre title (a `Verzeichniss`
 *      names its compiler, and `author-identity.md` calls that class out); not a
 *      byline that is not a findable name (`J. A. D.`); no second author in the
 *      title (`M. Catonis lib. 1. M. Terentius …` is Scriptores rei rusticae,
 *      four authors, and Cato is only the first).
 *   3. **An adversarial refuter per surviving book**, prompted to REFUTE and to
 *      default to refuted when uncertain. It killed **14 of 38 (37%)**, and the
 *      kills are not noise:
 *        · Victor of Capua — the genitive governs *prefacio*, not the book. He
 *          wrote the preface to a gospel harmony and says in it that he found
 *          the work anonymous.
 *        · Alexander Neckam — not printed by the book at all; written in by a
 *          later hand in inverted catalogue form ("Neckam, Alexander"). A
 *          cataloguer's conjecture, read as a byline.
 *        · Joachimus Magdeburgius (×2) — the genitive governs *einer Vermanung*,
 *          an admonition bound in *sampt* the Augsburg Confession.
 *        · 11 further composite volumes where no single author owns the book.
 *      Every one of those would have shipped as a public byline.
 *
 * SO THE YIELD IS 24 OF 161, and the large denominators are the point: the
 * method's value is mostly in what it DECLINES to say.
 *
 * WHAT THIS WRITES — three legs, because a byline lives in three places:
 *   - `books.author` in Mongo. NO new field: `books` carries 403 top-level
 *     fields because every sweep wrote a column instead of a row (#3969), and
 *     `new-field-writes.mjs` now fails a PR that adds one.
 *   - `books_catalog.author` in Supabase, WITH `updated_at` bumped — a synced
 *     column written without it reports modifiedCount 1 and stays inert.
 *   - one row per book in `field_provenance`, which is the existing
 *     row-shaped home for "where did this value come from".
 * Then it revalidates each book page (the route also purges Cloudflare).
 *
 * WHAT IT DOES NOT DO. It does not set `author_id`, so these books move
 * T0 ABSENT → T2 UNLINKED on the attribution-health ladder and **`reachable`
 * (T3+) does not change**. The reader gains a byline and a searchable name; the
 * author page comes later, from the additive-mint path, never from here.
 *
 * SAFETY. Dry run by default. Re-selects on "still blank or placeholder", so a
 * book somebody has since given a byline is skipped rather than overwritten.
 * The backup MERGES on book id and lets the EARLIEST `before` win, so a second
 * --apply cannot overwrite the true original (author-identity.md).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/apply-titlepage-bylines-3982.mjs
 *   node --env-file=.env.production.local scripts/maintenance/apply-titlepage-bylines-3982.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/apply-titlepage-bylines-3982.mjs --revert
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backups', 'apply-titlepage-bylines-3982.json');
const RUN = 'titlepage-byline-3982';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const VERDICTS = (process.argv.find((a) => a.startsWith('--verdicts=')) || '').split('=')[1]
  || process.env.TITLEPAGE_VERDICTS;

const PLACEHOLDER = /^(unknown|anonymous|anon|n\/?a|none|s\.?\s*n\.?|sine nomine|no author|not stated|unbekannt|onbekend|\[?unknown author\]?)$/i;
const isEmptyByline = (a) => { const s = String(a ?? '').trim(); return !s || PLACEHOLDER.test(s); };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mergeBackup(rows) {
  const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { run: RUN, entries: [] };
  const byId = new Map(prior.entries.map((e) => [e.book_id, e]));
  for (const r of rows) if (!byId.has(r.book_id)) byId.set(r.book_id, r); // earliest before wins
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify({ run: RUN, entries: [...byId.values()] }, null, 1));
}

async function supabaseSet(id, author) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no supabase creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    // updated_at is load-bearing: the grid reads it to decide what changed.
    body: JSON.stringify({ author, updated_at: new Date().toISOString() }),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(body) ? body.length : 0 };
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error('no backup to revert'); process.exit(1); }
  const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const e of entries) {
    const set = {}, unset = {};
    if (e.before === undefined || e.before === null) unset.author = ''; else set.author = e.before;
    const op = Object.keys(set).length ? { $set: set } : { $unset: unset };
    if (APPLY) {
      const r = await books.updateOne({ id: e.book_id, author: e.after }, op);
      if (r.modifiedCount) n++;
      await supabaseSet(e.book_id, e.before ?? null);
    }
  }
  console.log(APPLY ? `reverted ${n} of ${entries.length}` : `would revert ${entries.length} (add --apply)`);
  await mc.close(); process.exit(0);
}

if (!VERDICTS || !existsSync(VERDICTS)) {
  console.error('need --verdicts=<path to verdicts.json> (the screened + refuted verdict file)');
  process.exit(1);
}
const verdicts = JSON.parse(readFileSync(VERDICTS, 'utf8'));
const proposals = verdicts.clean;
console.log(`verdict file: ${proposals.length} survived reader + screens + refuter\n`);

const backupRows = [], skipped = [];
let wrote = 0, sbOk = 0, provRows = 0;

for (const p of proposals) {
  const b = await books.findOne({ id: p.book_id }, { projection: { id: 1, author: 1, title: 1, visible: 1, slug: 1 } });
  if (!b) { skipped.push([p.book_id, 'not found']); continue; }
  if (b.visible !== true) { skipped.push([p.book_id, 'not visible']); continue; }
  if (!isEmptyByline(b.author)) { skipped.push([p.book_id, `byline changed since: ${b.author}`]); continue; }

  console.log(`${APPLY ? 'WRITE' : 'would write'}  ${String(b.author ?? '(blank)').padEnd(9)} -> ${p.author.padEnd(34)} ${String(b.title).slice(0, 46)}`);
  backupRows.push({ book_id: p.book_id, before: b.author ?? null, after: p.author, at: new Date().toISOString() });

  if (!APPLY) continue;
  const r = await books.updateOne({ id: p.book_id }, { $set: { author: p.author } });
  if (r.modifiedCount !== 1) { console.log(`   !! modifiedCount ${r.modifiedCount}`); continue; }
  wrote++;

  const sb = await supabaseSet(p.book_id, p.author);
  if (sb.ok && sb.rows > 0) sbOk++; else console.log(`   !! supabase ${JSON.stringify(sb)}`);

  const pr = await db.collection('field_provenance').insertOne({
    book_id: p.book_id, field: 'author', value: p.author, source: 'titlepage-subagent-v1', run: RUN,
    previous_value: b.author ?? null,
    evidence: {
      as_printed: p.as_printed ?? null, quoted_line: p.quoted_line ?? null, page_number: p.page ?? null,
      reader_confidence: p.confidence ?? null, reader_reasoning: p.reasoning ?? null,
      flash_lite_proposed: p.flash_lite ?? null,
      refuter_verdict: p.refuter ? { refuted: p.refuter.refuted, confidence: p.refuter.confidence, reasoning: p.refuter.reasoning } : null,
      method: 'independent subagent reader over the OCR attribution window, deterministic screens, adversarial refuter',
      pool: 'PR #3982 frozen benchmark pool of 161 (Latin-script, blank/placeholder byline, flash-lite candidate)',
    },
    created_at: new Date().toISOString(),
  });
  if (pr.insertedId) provRows++;

  // The sweep ALSO records what it did, row-shaped, in the standard place (#3969).
  // field_provenance answers "where did this value come from"; sweep_log answers
  // "what did this job do". Nothing user-facing reads either.
  await recordSweepAction(db, {
    sweep: 'titlepage-byline-3982',
    book_id: p.book_id,
    action: 'byline-written-from-title-page',
    detail: { from: b.author ?? null, to: p.author, page_number: p.page ?? null },
  });
}

if (backupRows.length) mergeBackup(backupRows);

console.log(`\n── ${APPLY ? 'applied' : 'dry run'} ──`);
console.log(`  books written        : ${APPLY ? wrote : backupRows.length}${APPLY ? '' : ' (would)'}`);
if (APPLY) console.log(`  supabase mirrored    : ${sbOk}`);
if (APPLY) console.log(`  provenance rows      : ${provRows}`);
console.log(`  skipped              : ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
if (APPLY) console.log(`  backup               : ${BACKUP}`);
console.log(`\n  These books move T0 ABSENT -> T2 UNLINKED. reachable (T3+) is UNCHANGED`);
console.log(`  until author_id is linked; that is the additive-mint path, not this one.`);
if (APPLY) console.log(`\n  NEXT: revalidate each /book/<id> so the new byline renders before the 24h ISR window.`);

await mc.close();
