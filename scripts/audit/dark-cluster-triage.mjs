#!/usr/bin/env node
/**
 * dark-cluster-triage — #3730 §3: pre-classify the dark duplicate pointers so
 * approving them costs minutes.
 *
 * A "dark pointer" is a book/artwork with `duplicate_of` whose keeper is
 * itself invisible — the content is dark for readers from BOTH ends. Measured
 * 2026-08-09: 1,993 pointers, 1,992 of them ARTWORKS, concentrated on 484
 * hidden keepers (130 keepers cover 80% of pointers). So this triages by
 * KEEPER, and the whole thing is script-classifiable — no AI needed.
 *
 * READ-ONLY. This script writes nothing to any collection. Its output is a
 * recommendation report; visibility flips and re-points happen only after
 * human sign-off, by other tools. (Ingest-is-actuation lesson: a store no
 * automated job reads. This prints to stdout + a JSON file in scripts/output.)
 *
 * Buckets, in precedence order per keeper cluster:
 *
 *   TAKEDOWN         keeper OR any pointer hidden_reason matches takedown /
 *                    copyright / dmca. Hard-excluded from every
 *                    recommendation (Kloss lesson: bulk flips must respect
 *                    hidden_reason). None observed on 2026-08-09; the guard
 *                    exists so a future one can never be recommended.
 *   DELIBERATELY_DARK keeper carries an explicit curatorial hidden_reason
 *                    ("tourist photo / broken metadata", "date X outside
 *                    collection period", "photographer/uploader, not artist").
 *                    Working as intended; no action.
 *   ALBUM_PARKING    the "pending conversion" shape: keeper hidden_reason
 *                    says per-page album, OR fan-in >= ALBUM_FANIN pointers
 *                    with no file-hash evidence — a plate-series parked on one
 *                    representative, not duplicates. Route to the
 *                    album->book conversion workstream, not to restore.
 *   REPOINT          a pointer's commons_sha1 exactly matches a VISIBLE
 *                    artwork elsewhere — the true copy is public and the
 *                    pointer should aim at it.
 *   SUSPECT_NOT_DUP  pointers carry file hashes, all distinct from the
 *                    keeper's — sha1 says these are NOT copies of the keeper
 *                    (artwork identity is sha1-exact; title-similarity dedup
 *                    is the known fabricator). Candidates for UNMARKING as
 *                    duplicates, pending eyeball. Requires every hash in the
 *                    cluster to be TRUSTWORTHY (not from the image-upgrade
 *                    set, #3838) — inside that set the same image can carry
 *                    two different sha1s and the bucket's argument collapses.
 *   RESTORE_CANDIDATE keeper hidden with NO reason, small cluster — dup
 *                    resolution normally keeps the keeper visible, so a
 *                    reasonless dark keeper looks like an accident. Restoring
 *                    the keeper un-darkens the whole cluster in one flip.
 *   KEEPER_CHOICE    everything else — genuinely ambiguous.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/dark-cluster-triage.mjs [--json]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const ALBUM_FANIN = 8;
const TAKEDOWN_RX = /takedown|copyright|dmca|rights\s*holder|cease/i;
const ALBUM_RX = /per-page|multi-page album|pending conversion/i;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const rows = await books.aggregate([
  { $match: { duplicate_of: { $nin: [null, ''] } } },
  { $lookup: { from: 'books', localField: 'duplicate_of', foreignField: 'id', as: 'keeper' } },
  { $unwind: { path: '$keeper', preserveNullAndEmptyArrays: true } },
  { $match: { $or: [{ keeper: null }, { 'keeper.visible': { $ne: true } }] } },
  { $project: {
    _id: 0, id: 1, title: 1, content_type: 1, commons_sha1: 1, hidden_reason: 1,
    commons_title: 1, commons_url: 1, image_upgrade_source: 1,
    keeper_id: '$keeper.id', keeper_title: '$keeper.title', keeper_sha1: '$keeper.commons_sha1',
    keeper_reason: '$keeper.hidden_reason', keeper_type: '$keeper.content_type',
    keeper_commons_title: '$keeper.commons_title', keeper_commons_url: '$keeper.commons_url',
    keeper_upgrade_source: '$keeper.image_upgrade_source',
  } },
]).toArray();

/**
 * `commons_sha1` DESCRIBES THE ORIGINAL IMPORT FILE, NOT NECESSARILY THE ONE WE SERVE.
 *
 * The image-upgrade path (`image_upgrade_source: "Commons alternate"`, runs of
 * May–June 2026) re-points a doc at a higher-quality Commons duplicate and
 * records that in `commons_title`, leaving `commons_url` and `commons_sha1` on
 * the original. 440 of ~11.2K true-Commons artwork docs are in that state
 * (measured 2026-08-09; `.claude/docs/invariants/paired-artifacts.md`, #3838).
 *
 * That matters HERE specifically, because SUSPECT_NOT_DUP is the one bucket
 * whose whole argument is "the hashes differ, so these are not copies" — and
 * inside the upgrade set two records of the SAME image can carry different
 * `commons_sha1`. The unmark lane acts on that verdict and restores visibility,
 * so an ungated call re-publishes a genuine duplicate.
 *
 * This audit was written 2026-08-09 and the finding landed 08-10, so the gate
 * was simply missing; it was re-derived by hand before the 2026-08-18 run
 * (0 of 9 keepers and 0 of 521 pointers were affected — the trap was empty that
 * time, which is luck, not a reason to keep re-deriving it).
 *
 * A doc is UNJUDGEABLE on hash evidence when it was upgraded, when its title and
 * url name different files, or when it has no hash at all — and unjudgeable is
 * not the same as "not a duplicate" (the repo has this lesson in three other
 * places). Such clusters fall through to KEEPER_CHOICE, which is a human lane.
 */
const commonsFile = (s) => decodeURIComponent(String(s ?? '').split('/').pop() ?? '')
  .replace(/^File:/, '').replace(/\s+/g, '_');
function hashIsTrustworthy(doc, prefix = '') {
  const p = (k) => doc[prefix ? `${prefix}${k}` : k];
  if (p('image_upgrade_source')) return false;
  const title = p('commons_title'), url = p('commons_url');
  if (title && url && commonsFile(title) !== commonsFile(url)) return false;
  return true;
}

// Cluster by keeper.
const byKeeper = new Map();
for (const r of rows) {
  const k = r.keeper_id || '(missing)';
  if (!byKeeper.has(k)) {
    byKeeper.set(k, {
      keeper_id: r.keeper_id ?? null, keeper_title: (r.keeper_title || '').slice(0, 70),
      keeper_reason: r.keeper_reason || null, keeper_sha1: r.keeper_sha1 || null,
      keeper_type: r.keeper_type || null, pointers: [],
      keeper_hash_trustworthy: hashIsTrustworthy(r, 'keeper_'),
    });
  }
  byKeeper.get(k).pointers.push(r);
}

// REPOINT probe: for pointers with a sha1, is a visible artwork carrying the
// same file hash? (Batch the lookup — one $in query, not one per pointer.)
const allShas = [...new Set(rows.map((r) => r.commons_sha1).filter(Boolean))];
const visibleBySha = new Map();
for (let i = 0; i < allShas.length; i += 500) {
  const hits = await books.find(
    { commons_sha1: { $in: allShas.slice(i, i + 500) }, visible: true },
    { projection: { _id: 0, id: 1, commons_sha1: 1 } },
  ).toArray();
  for (const h of hits) if (!visibleBySha.has(h.commons_sha1)) visibleBySha.set(h.commons_sha1, h.id);
}

function classify(c) {
  const reasons = [c.keeper_reason, ...c.pointers.map((p) => p.hidden_reason)].filter(Boolean);
  if (reasons.some((x) => TAKEDOWN_RX.test(x))) return 'TAKEDOWN';
  if (c.keeper_reason && ALBUM_RX.test(c.keeper_reason)) return 'ALBUM_PARKING';
  if (c.keeper_reason) return 'DELIBERATELY_DARK';
  const withSha = c.pointers.filter((p) => p.commons_sha1);
  const repointable = withSha.filter((p) => visibleBySha.has(p.commons_sha1));
  if (repointable.length && repointable.length === c.pointers.length) return 'REPOINT';
  if (c.pointers.length >= ALBUM_FANIN && withSha.length === 0) return 'ALBUM_PARKING';
  // SUSPECT_NOT_DUP is a claim about hashes, so every hash it rests on must
  // describe the file we actually serve — see hashIsTrustworthy above. One
  // untrustworthy hash anywhere in the cluster disqualifies the whole verdict,
  // because the bucket's argument is "ALL of these differ from the keeper".
  const hashesTrustworthy = c.keeper_hash_trustworthy && c.pointers.every((p) => hashIsTrustworthy(p));
  if (hashesTrustworthy && withSha.length && c.keeper_sha1 && withSha.every((p) => p.commons_sha1 !== c.keeper_sha1)) return 'SUSPECT_NOT_DUP';
  if (hashesTrustworthy && withSha.length && !c.keeper_sha1 && withSha.length === new Set(withSha.map((p) => p.commons_sha1)).size && withSha.length === c.pointers.length && c.pointers.length > 1) return 'SUSPECT_NOT_DUP';
  if (!c.keeper_reason && c.pointers.length < ALBUM_FANIN) return 'RESTORE_CANDIDATE';
  return 'KEEPER_CHOICE';
}

const buckets = new Map();
for (const c of byKeeper.values()) {
  const b = classify(c);
  c.bucket = b;
  c.repoint_targets = c.pointers
    .filter((p) => p.commons_sha1 && visibleBySha.has(p.commons_sha1))
    .map((p) => ({ pointer: p.id, visible_copy: visibleBySha.get(p.commons_sha1) }));
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(c);
}

const order = ['TAKEDOWN', 'DELIBERATELY_DARK', 'ALBUM_PARKING', 'REPOINT', 'SUSPECT_NOT_DUP', 'RESTORE_CANDIDATE', 'KEEPER_CHOICE'];
const stamp = new Date().toISOString().slice(0, 10);
const summary = order.map((b) => ({
  bucket: b,
  keepers: (buckets.get(b) || []).length,
  pointers: (buckets.get(b) || []).reduce((s, c) => s + c.pointers.length, 0),
}));

const outDir = path.join(process.cwd(), 'scripts', 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `dark-cluster-triage-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify({
  generated: new Date().toISOString(),
  totals: { pointers: rows.length, keepers: byKeeper.size },
  summary,
  clusters: order.flatMap((b) => (buckets.get(b) || []).map((c) => ({
    bucket: c.bucket, keeper_id: c.keeper_id, keeper_title: c.keeper_title,
    keeper_reason: c.keeper_reason, keeper_type: c.keeper_type,
    pointer_count: c.pointers.length,
    pointer_ids: c.pointers.map((p) => p.id),
    repoint_targets: c.repoint_targets,
  }))),
}, null, 1));

if (JSON_OUT) {
  console.log(JSON.stringify({ totals: { pointers: rows.length, keepers: byKeeper.size }, summary }, null, 2));
} else {
  console.log(`dark-cluster triage — ${stamp}: ${rows.length} pointers on ${byKeeper.size} hidden keepers`);
  for (const s of summary) {
    if (!s.keepers) continue;
    console.log(`  ${s.bucket.padEnd(18)} ${String(s.keepers).padStart(4)} keepers  ${String(s.pointers).padStart(5)} pointers`);
  }
  console.log(`\n  action shape (nothing here writes anything):`);
  console.log(`   - TAKEDOWN + DELIBERATELY_DARK: none. Working as intended.`);
  console.log(`   - ALBUM_PARKING: route keepers to the album->book conversion queue.`);
  console.log(`   - REPOINT: mechanical re-point once approved (visible copy listed per pointer).`);
  console.log(`   - SUSPECT_NOT_DUP: likely fake dup marks from title-based artwork dedup; eyeball, then unmark.`);
  console.log(`   - RESTORE_CANDIDATE: one visibility flip per keeper un-darkens the cluster. Needs Derek.`);
  console.log(`\n  sample per actionable bucket:`);
  for (const b of ['REPOINT', 'SUSPECT_NOT_DUP', 'RESTORE_CANDIDATE', 'KEEPER_CHOICE']) {
    for (const c of (buckets.get(b) || []).slice(0, 4)) {
      console.log(`   [${b}] keeper ${c.keeper_id} "${c.keeper_title}" <- ${c.pointers.length} pointer(s)`);
    }
  }
  console.log(`\n  full detail: ${outPath}`);
}
await client.close();
