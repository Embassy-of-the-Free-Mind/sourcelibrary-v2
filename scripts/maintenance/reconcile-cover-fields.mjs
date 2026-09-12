/**
 * Reconcile books whose two cover fields point at DIFFERENT pictures.
 *
 * WHY
 * ---
 * `books` stores the cover four times — `image_display` / `image_thumb`
 * (canonical) and `thumbnail` / `thumbnail_blob` (legacy mirrors). They are
 * meant to move together; `buildCoverUpdate()` exists so they do. But the
 * R2 migration (PR #1588) updated most writers and missed a few, so the two
 * halves drifted apart, and different surfaces read different ones: the
 * Supabase-fed catalogue renders `thumbnail`, Mongo-fed surfaces prefer
 * `image_display`. The visible symptom is a book showing one cover in the
 * catalogue and a different one on its own page.
 *
 * Measured 2026-08-28: 4,309 live books have the two fields differing as
 * strings, but 2,048 of those are the SAME image at a different path
 * (`/archived/{id}/2.jpg` and `/pages/{id}/0002.jpg` name one page), leaving
 * 2,261 genuinely showing two different pictures.
 *
 * WHAT THIS DECIDES — and what it deliberately does not
 * ----------------------------------------------------
 * In priority order, most authoritative first:
 *
 *   human-pick  — `thumbnail_source: 'manual'` means a person clicked a page in
 *                 the cover picker and `cover_page` is what they clicked. Their
 *                 choice outranks every rule below; nothing here overrules a
 *                 human.
 *   hotlink (550) — one side still points at the source library rather than R2.
 *                 The R2 copy wins: external URLs rot and get hotlink-blocked,
 *                 and moving off them is what the migration was for.
 *   crop (739)  — one side is a `/cropped/` cover. The crop wins: it is a
 *                 deliberate framing, where the raw page scan is only what the
 *                 pipeline happened to grab.
 *   cover_page (859) — two ordinary page scans, so fall back to recorded intent.
 *                 Whichever URL still points at the page a selection pass wrote
 *                 down is the choice; the other drifted. Measured over the 876
 *                 books in this shape, `thumbnail` matches `cover_page` and
 *                 `image_display` does not in 786 of them (90%) — this recovers
 *                 a decision rather than inventing one, and it agreed with the
 *                 human review of the sample.
 *   same-page (49) — the same page reached two ways (an off-by-one index, an
 *                 `sp`/`spxfgo` derivation). Same picture, so collapsing them
 *                 changes nothing visible.
 *
 * Anything none of these decide is LEFT ALONE (59 books): no page number to
 * read, or `cover_page` matching neither side. Those need a human, and this
 * script must not guess for them.
 *
 * SAFETY
 * ------
 * Cover writes go through the shared `buildCoverUpdate()` contract so all four
 * fields move together — the drift this repairs is exactly what happens when
 * they don't. `image_card` is cleared: it names one page's card variant and
 * the cover is moving, so a surviving pointer would render the OLD cover
 * (see src/lib/utils.ts getBookCardUrl). Re-run backfill-cover-cards.mjs
 * afterwards to give the new covers their variant.
 *
 * Every candidate's winning URL is verified to actually load before anything
 * is written — a "fix" that swaps a live cover for a dead one is worse than
 * the drift.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reconcile-cover-fields.mjs --dry-run
 *   node scripts/maintenance/reconcile-cover-fields.mjs --dry-run --limit=50 --verbose
 *   node scripts/maintenance/reconcile-cover-fields.mjs --apply
 *
 * Flags:
 *   --dry-run       report only (default; --apply is required to write)
 *   --apply         write the reconciliation
 *   --only=hotlink|crop   restrict to one rule
 *   --limit=N       cap candidates
 *   --verbose       print every decision
 *   --concurrency=N default 10
 */
import { MongoClient } from 'mongodb';
import { buildCoverUpdate } from '../lib/cover-write.mjs';

const arg = (n, d = null) => {
  const h = process.argv.find(a => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = Number(arg('limit', 0)) || 0;
const ONLY = arg('only');
const CONCURRENCY = Number(arg('concurrency', 10)) || 10;

const isR2 = u => /images\.sourcelibrary\.org/.test(u || '');
const isCropped = u => /images\.sourcelibrary\.org\/cropped\//.test(u || '');

/** Canonical identity of the image a cover URL names — path convention removed. */
function ident(u) {
  const q = (u || '').split('?')[0].replace(/-(thumb|card|full)\.(jpg|avif)$/, '.jpg');
  const legacy = q.match(/\/(?:archived|thumbnails)\/([^/]+)\/(\d+)\.jpg$/);
  if (legacy) return `pages/${legacy[1]}/${legacy[2].padStart(4, '0')}`;
  const pages = q.match(/\/pages\/([^/]+)\/(\d+)\.jpg$/);
  if (pages) return `pages/${pages[1]}/${pages[2].padStart(4, '0')}`;
  const cropped = q.match(/\/cropped\/([^/]+)\/([^/]+)\.jpg$/);
  if (cropped) return `cropped/${cropped[1]}/${cropped[2]}`;
  return q;
}

/**
 * Which of the two URLs is the real cover, and under which rule.
 * Returns null when neither rule applies — the caller must not guess.
 */
function decide(display, thumbnail, book) {
  // A person's choice outranks every structural rule below. `thumbnail_source:
  // 'manual'` means somebody clicked a page in the cover picker, and
  // `cover_page` is the page they clicked — so the URL still pointing at that
  // page is their pick, and the other one drifted away from it afterwards.
  // Nothing here should quietly overrule a human.
  if (book.thumbnail_source === 'manual' && typeof book.cover_page === 'number') {
    const d = pageNum(display), t = pageNum(thumbnail);
    if (d !== null && t !== null && d !== t) {
      if (t === book.cover_page) return { winner: thumbnail, rule: 'human-pick' };
      if (d === book.cover_page) return { winner: display, rule: 'human-pick' };
    }
  }

  const dExt = !isR2(display), tExt = !isR2(thumbnail);
  if (dExt !== tExt) return { winner: dExt ? thumbnail : display, rule: 'hotlink' };
  const dCrop = isCropped(display), tCrop = isCropped(thumbnail);
  if (dCrop !== tCrop) return { winner: dCrop ? display : thumbnail, rule: 'crop' };

  // Two ordinary page scans. Nothing structural separates them, so fall back to
  // RECORDED INTENT: `cover_page` is the page number a selection pass wrote down
  // when it chose this cover. Whichever URL still points at that page is the
  // choice; the other one drifted.
  //
  // Measured 2026-08-29 over the 876 books in this shape: `thumbnail` matches
  // `cover_page` and `image_display` does not in 786 of them (90%). So this is
  // recovering a decision, not inventing one — and it agrees with the human
  // review of the sample.
  const d = pageNum(display), t = pageNum(thumbnail);
  if (typeof book.cover_page === 'number' && d !== null && t !== null) {
    const dm = d === book.cover_page, tm = t === book.cover_page;
    if (tm && !dm) return { winner: thumbnail, rule: 'cover_page' };
    if (dm && !tm) return { winner: display, rule: 'cover_page' };
  }

  // Same page number reached two ways (an off-by-one index, an `sp`/`spxfgo`
  // prefixed derivation): the same picture, so collapsing them changes nothing
  // visible. Keep `thumbnail`, which is what the catalogue already renders.
  if (d !== null && t !== null && d === t) return { winner: thumbnail, rule: 'same-page' };

  return null;
}
const pageNum = u => {
  const m = (u || '').split('?')[0].match(/(\d+)(?:-(?:thumb|card|full))?\.(?:jpg|avif)$/);
  return m ? parseInt(m[1], 10) : null;
};

const loads = async u => {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(25000) }); return r.ok; }
  catch { return false; }
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { await fn(items[k]); } catch (e) { items[k]._err = e?.message || String(e); } }
  }));
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const rows = await books.find(
  { visible: true, pages_count: { $gt: 0 }, image_display: { $type: 'string' }, thumbnail: { $type: 'string' },
    $expr: { $ne: ['$image_display', '$thumbnail'] } },
  { projection: { _id: 1, id: 1, title: 1, image_display: 1, thumbnail: 1, image_card: 1, cover_page: 1, thumbnail_source: 1 } },
).toArray();

const stats = { samePath: 0, undecidable: 0, candidates: 0, applied: 0, deadWinner: 0, failed: 0 };
const byRule = new Map();
const candidates = [];

for (const b of rows) {
  if (ident(b.image_display) === ident(b.thumbnail)) { stats.samePath++; continue; }
  const d = decide(b.image_display, b.thumbnail, b);
  if (!d) { stats.undecidable++; continue; }
  if (ONLY && d.rule !== ONLY) continue;
  candidates.push({ ...b, ...d });
}
stats.candidates = candidates.length;
const work = LIMIT ? candidates.slice(0, LIMIT) : candidates;

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
console.log(`cover fields differing as strings : ${rows.length}`);
console.log(`  same image, different path      : ${stats.samePath}  (left alone)`);
console.log(`  no structural winner            : ${stats.undecidable}  (left alone — needs a human)`);
console.log(`  reconcilable                    : ${stats.candidates}${LIMIT ? `  (processing ${work.length})` : ''}\n`);

await pool(work, CONCURRENCY, async (b) => {
  if (!await loads(b.winner)) { stats.deadWinner++; b._skip = 'winning URL does not load'; return; }
  byRule.set(b.rule, (byRule.get(b.rule) || 0) + 1);
  if (VERBOSE) {
    console.log(`  [${b.rule}] ${String(b.title).slice(0, 42)}`);
    console.log(`      keep ${b.winner}`);
    console.log(`      drop ${b.winner === b.image_display ? b.thumbnail : b.image_display}`);
  }
  if (!APPLY) return;
  // Through the shared contract so all four cover fields move together.
  const update = buildCoverUpdate({ archived_photo: b.winner, page_number: b.cover_page }, {
    source: 'cover-field-reconcile-2026-08',
    method: `reconcile:${b.rule}`,
    actor: 'script',
    detail: `divergent cover fields reconciled by the ${b.rule} rule`,
  });
  if (!update) { stats.failed++; b._skip = 'buildCoverUpdate returned null'; return; }
  // No $unset here: buildCoverUpdate already carries `image_card: null`, which
  // is what clears it. Setting AND unsetting one path in the same update makes
  // Mongo reject the whole write ("would create a conflict at 'image_card'") —
  // and because the worker pool below swallowed exceptions, that rejection
  // showed up only as a silent zero.
  await books.updateOne({ _id: b._id }, { $set: update });
  stats.applied++;
});

console.log(`\nby rule:`);
for (const [r, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);
// Surface anything the pool caught. A sweep that reports a silent zero is worse
// than one that crashes: the first run of this script wrote nothing and said so
// only as "reconciled: 0", because every updateOne was throwing in here.
const errored = work.filter(b => b._err);
console.log(`\nskipped (winning URL dead) : ${stats.deadWinner}`);
console.log(`errors                     : ${errored.length}`);
for (const b of errored.slice(0, 5)) console.log(`    ${b.id}: ${b._err}`);
console.log(`write failures             : ${stats.failed}`);
console.log(`${APPLY ? 'reconciled' : 'would reconcile'}         : ${APPLY ? stats.applied : work.length - stats.deadWinner}`);
if (APPLY && stats.applied) console.log(`\nNext: node scripts/maintenance/backfill-cover-cards.mjs   (regenerates card variants for the moved covers)`);
await client.close();
