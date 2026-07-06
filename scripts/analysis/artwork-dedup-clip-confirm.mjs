/**
 * READ-ONLY: confirm the LOW-tier (title+author+year) artwork duplicate
 * candidates from artwork-exact-duplicates.mjs using CLIP visual similarity.
 *
 * The LOW tier is title-only, so it conflates same-subject with same-object
 * (distinct emblems, common religious subjects). CLIP embeddings settle it: a
 * pair that is ALSO visually near-identical is a real duplicate; a pair that
 * shares a title but looks different is a distinct work. This does NOT do a
 * 26K² self-join — it only fetches CLIP vectors for the candidate members
 * already grouped by title, and scores intra-group pairs. Deletes nothing.
 *
 * Thresholds (CLIP cosine): >=0.97 confirmed near-identical; 0.90–0.97 likely
 * (visual sibling — reused block / same object different scan, review); <0.90
 * distinct (title collision, NOT a dup).
 *
 * Usage:
 *   export SUPABASE_DB_URL=$(secret-lover get SUPABASE_DB_URL | tail -1)
 *   node scripts/analysis/artwork-dedup-clip-confirm.mjs \
 *     [--in=scripts/output/artwork-exact-duplicates.json] \
 *     [--tiers=low,review] [--out=scripts/output/artwork-dedup-clip-confirmed.json]
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'fs';

const IN = (process.argv.find(a => a.startsWith('--in=')) || '').split('=')[1]
  || 'scripts/output/artwork-exact-duplicates.json';
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1]
  || 'scripts/output/artwork-dedup-clip-confirmed.json';
const TIERS = ((process.argv.find(a => a.startsWith('--tiers=')) || '--tiers=low,review')
  .split('=')[1]).split(',');

const CONFIRM = 0.97, LIKELY = 0.90;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function main() {
  const report = JSON.parse(readFileSync(IN, 'utf8'));
  const groups = report.groups.filter(g => TIERS.includes(g.tier));
  console.log(`Confirming ${groups.length} groups in tiers [${TIERS.join(',')}] via CLIP...`);

  // Collect every member id across the candidate groups.
  const ids = new Set();
  for (const g of groups) { ids.add(g.keeper.id); for (const r of g.remove) ids.add(r.id); }
  const idList = [...ids];

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Fetch CLIP vectors for just those ids (batched).
  const vecById = new Map();
  for (let i = 0; i < idList.length; i += 1000) {
    const chunk = idList.slice(i, i + 1000);
    const { rows } = await c.query(
      `SELECT book_id, embedding::text AS e FROM clip_embeddings WHERE source_type='artwork' AND book_id = ANY($1)`,
      [chunk],
    );
    for (const r of rows) vecById.set(r.book_id, JSON.parse(r.e));
  }
  await c.end();
  console.log(`Fetched CLIP vectors for ${vecById.size}/${idList.length} candidate records.`);

  let confirmed = 0, likely = 0, distinct = 0, noVec = 0;
  const out = [];
  for (const g of groups) {
    const members = [g.keeper.id, ...g.remove.map(r => r.id)];
    const keeperVec = vecById.get(g.keeper.id);
    const pairs = [];
    for (const rid of g.remove.map(r => r.id)) {
      const a = keeperVec, b = vecById.get(rid);
      if (!a || !b) { pairs.push({ id: rid, verdict: 'no_vector' }); noVec++; continue; }
      const sim = cosine(a, b);
      const verdict = sim >= CONFIRM ? 'confirmed' : sim >= LIKELY ? 'likely' : 'distinct';
      if (verdict === 'confirmed') confirmed++; else if (verdict === 'likely') likely++; else distinct++;
      pairs.push({ id: rid, similarity: Math.round(sim * 1000) / 1000, verdict });
    }
    out.push({ tier: g.tier, key: g.key, keeper: g.keeper.id, title: g.keeper.title, pairs });
  }

  const result = {
    generated_for: 'issue #2209 — CLIP confirmation of LOW-tier artwork dup candidates (READ-ONLY)',
    thresholds: { confirmed: CONFIRM, likely: LIKELY },
    tiers_checked: TIERS,
    pair_counts: { confirmed, likely, distinct, no_vector: noVec },
    groups: out,
  };
  writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\n── CLIP confirmation ──────────────────────────────`);
  console.log(`Pairs checked:  ${confirmed + likely + distinct + noVec}`);
  console.log(`  confirmed (>=${CONFIRM}):  ${confirmed}   real duplicates`);
  console.log(`  likely (>=${LIKELY}):    ${likely}   visual sibling — review`);
  console.log(`  distinct (<${LIKELY}):   ${distinct}   title collision, NOT a dup`);
  console.log(`  no CLIP vector:      ${noVec}`);
  console.log(`\nReport → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
