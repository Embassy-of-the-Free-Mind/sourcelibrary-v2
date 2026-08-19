/**
 * triage-apply — shared plumbing for the two triage apply-scripts (#3730 §3):
 *   scripts/maintenance/apply-dark-cluster-triage.mjs
 *   scripts/maintenance/apply-keeper-choice-triage.mjs
 *
 * The triage scripts (scripts/audit/dark-cluster-triage.mjs,
 * scripts/audit/keeper-choice-triage.mjs) are READ-ONLY classifiers; these
 * helpers exist so that, once Derek approves a lane, executing it is one
 * command with the safety shape every approved-write here shares:
 *   - dry-run by default, writes only under --apply
 *   - every guard re-verified against LIVE data at apply time (a report is a
 *     snapshot; state drifts between triage and approval)
 *   - backup of every touched doc's prior fields in scripts/output/
 *   - a provenance row in `dedup_apply_runs`
 *   - visibility flips bump updated_at (synced-column lesson) and are followed
 *     by catalog sync + ISR revalidate (+ CF purge, done by the revalidate
 *     endpoint itself)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Kloss lesson: bulk visibility flips must respect deliberate holds. Mirrors
// TAKEDOWN_RX in scripts/audit/dark-cluster-triage.mjs — change both together.
export const TAKEDOWN_RX = /takedown|copyright|dmca|rights\s*holder|cease/i;
// A hidden_reason that merely records the duplicate mark itself (safe to clear
// when the mark is proven false), as opposed to an independent curatorial hold.
export const DUP_REASON_RX = /duplicate/i;

export const STAMP = new Date().toISOString().slice(0, 10);

export function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** --only a,b,c or --only @file (one id per line, # comments ok). Null = no filter. */
export function idFilter(name = '--only') {
  const raw = flagValue(name);
  if (!raw) return null;
  const items = raw.startsWith('@')
    ? fs.readFileSync(raw.slice(1), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : raw.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(items);
}

/** Resolve the report path: --report <path>, else newest scripts/output/<prefix>-*.json */
export function resolveReport(prefix) {
  const explicit = flagValue('--report');
  if (explicit) return explicit;
  const dir = path.join(process.cwd(), 'scripts', 'output');
  const candidates = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json')).sort()
    : [];
  if (!candidates.length) {
    console.error(`No ${prefix}-*.json in scripts/output/ — run the triage script first, or pass --report <path>.`);
    process.exit(1);
  }
  return path.join(dir, candidates[candidates.length - 1]);
}

export function writeBackup(name, payload) {
  const dir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(p, JSON.stringify(payload, null, 1));
  return p;
}

/** Provenance row so `dedup_apply_runs` answers "who flipped this and from which report". */
export async function recordRun(db, doc) {
  await db.collection('dedup_apply_runs').insertOne({ ...doc, at: new Date() });
}

/**
 * ANY resource_type value routes to /artwork — and that route is
 * /artwork/[slug], while books are /book/[id]. Verified 2026-08-09:
 * /artwork/<id> 404s even for a visible artwork.
 */
export function pagePath(doc) {
  return doc.resource_type || doc.content_type === 'artwork'
    ? `/artwork/${doc.slug || doc.id}`
    : `/book/${doc.id}`;
}

/**
 * The post-write steps of the 3-step unhide (Mongo flip is the caller's):
 *   2. Supabase catalog sync (incremental picks up the updated_at bumps;
 *      hides propagate as visible:false rows, restores as new/updated rows)
 *   3. ISR revalidate — the endpoint purges Cloudflare for the same paths.
 * With execute=false, prints the exact commands instead (golive pattern).
 */
export async function finalizeCaches({ paths, execute }) {
  const uniq = [...new Set(paths)];
  const body = JSON.stringify({ paths: uniq });
  if (!execute) {
    console.log('\nNOW RUN (finalize was not requested):');
    console.log('  node scripts/workers/sync-books-catalog.mjs');
    console.log(`  curl -s -X POST https://sourcelibrary.org/api/admin/revalidate -H "x-revalidate-secret: $REVALIDATE_SECRET" -H "Content-Type: application/json" --data '${body}'`);
    return;
  }
  console.log('\nfinalize: syncing Supabase catalog…');
  const sync = spawnSync('node', ['scripts/workers/sync-books-catalog.mjs'], { stdio: 'inherit' });
  if (sync.status !== 0) {
    console.error('catalog sync FAILED — run it by hand before trusting public listings.');
  }
  console.log(`finalize: revalidating ${uniq.length} paths (endpoint also purges Cloudflare)…`);
  const res = await fetch('https://sourcelibrary.org/api/admin/revalidate', {
    method: 'POST',
    headers: {
      'x-revalidate-secret': process.env.REVALIDATE_SECRET || '',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (sourcelibrary maintenance; triage-apply)',
    },
    body,
  });
  const j = await res.json().catch(() => ({}));
  console.log(`revalidate: HTTP ${res.status} — revalidated ${j.revalidated ?? '?'} paths`);
  if (!res.ok) console.error('revalidate FAILED — run the printed curl by hand.');
}

export function skipLine(id, why) {
  console.log(`  skip ${id}: ${why}`);
}
