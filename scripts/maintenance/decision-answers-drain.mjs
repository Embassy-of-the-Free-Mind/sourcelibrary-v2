#!/usr/bin/env node
/**
 * Act on PR answers queued by /platform/admin/decisions (#6258).
 *
 * PRIOR ART: scripts/maintenance/safe-merge.sh — this does NOT reimplement its
 * checks; a Default ("merge") answer is handed to safe-merge.sh itself, so the
 * page and the terminal merge through one gate. scripts/maintenance/auto-merge.mjs
 * is the machine merge for tier:auto; its one-merge-per-build gap is copied here.
 *
 * WHY A DRAINER AND NOT THE VERCEL FUNCTION: the site would need a GitHub token
 * that can merge to main (= deploy production) sitting in a web function, and
 * safe-merge.sh waits out UNKNOWN mergeability for up to two minutes. Here the
 * merge runs with the box's own `gh` auth and the entities interlock runs as
 * the script it is. The page only writes a row to Mongo.
 *
 * Per queued answer (oldest first), claimed atomically (status queued → acting):
 *   - the PR must still be OPEN, still `tier:hold`, and its head must be the
 *     sha Derek answered on: a push after the answer is a new decision → refused
 *   - default: at most ONE merge per run, and only when main's tip is ≥ 8 min
 *     old (one Vercel build per merge, as auto-merge.mjs). Then
 *     `safe-merge.sh <pr>`; exit 0 → done, 1 → refused (card returns with
 *     the reason), anything else → failed
 *   - other: `gh pr comment` with Derek's text, then `--add-label blocked`
 *
 * The answer row gets status/result/acted_at; the page shows a refusal on the
 * card. Ops-file and skip answers are records only and are never touched here.
 *
 * USAGE (Hetzner, from the repo root, with gh authenticated):
 *   node --env-file=.env.production.local scripts/maintenance/decision-answers-drain.mjs [--dry-run]
 *   node --env-file=.env.production.local scripts/maintenance/decision-answers-drain.mjs --list-ops
 *     prints recorded ops-file answers as `## Done` lines for a session to move
 *     into DECISIONS-PENDING.md (stage 1 has no write access to the ops repo)
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
const COLLECTION = 'decision_answers';
const BUILD_GAP_MIN = 8;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout;
}

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(process.env.DB_NAME || 'bookstore').collection(COLLECTION);

async function finish(a, status, result) {
  console.log(`  #${a.ref.pr} ${a.choice}: ${status} — ${result}`);
  if (DRY) return;
  await col.updateOne({ _id: a._id }, { $set: { status, result: result.slice(0, 2000), acted_at: new Date() } });
}

async function run() {
  if (argv.includes('--list-ops')) {
    const rows = await col.find({ source: 'ops', choice: { $ne: 'skip' } }).sort({ answered_at: 1 }).toArray();
    for (const a of rows) {
      const what = a.choice === 'default' ? `default: ${a.default_label}` : `"${a.text}"`;
      console.log(`- ${a.answered_at.toISOString().slice(0, 10)} · ${a.answered_by} (decisions page) on "${a.question}" (line ${a.ref.line}, ${a.ref.section}): ${what}`);
    }
    return;
  }

  gh(['auth', 'status']);
  // A run that died mid-action leaves `acting`, which hides the card. Surface it instead:
  // the PR may or may not have been touched, so a human looks before answering again.
  if (!DRY) {
    await col.updateMany(
      { status: 'acting', acting_at: { $lt: new Date(Date.now() - 30 * 60_000) } },
      { $set: { status: 'failed', result: 'the drainer died mid-action; check the PR before answering again', acted_at: new Date() } });
  }
  const queued = await col.find({ source: 'pr', status: 'queued' }).sort({ answered_at: 1 }).toArray();
  if (!queued.length) { console.log('nothing queued'); return; }

  let merged = false;
  for (const q of queued) {
    if (q.choice === 'default' && merged) { console.log(`  #${q.ref.pr}: waiting for the next run (one merge per build)`); continue; }
    if (q.choice === 'default') {
      const tip = gh(['api', `repos/${REPO}/commits/main`, '--jq', '.commit.committer.date']).trim();
      const gap = (Date.now() - Date.parse(tip)) / 60000;
      if (gap < BUILD_GAP_MIN) { console.log(`  #${q.ref.pr}: main tip is ${gap.toFixed(0)} min old; a build is likely in flight, next run`); continue; }
    }
    // Claim: another drainer run (or a second box) cannot act on the same answer.
    const a = DRY ? q : await col.findOneAndUpdate(
      { _id: q._id, status: 'queued' }, { $set: { status: 'acting', acting_at: new Date() } }, { returnDocument: 'after' });
    if (!a) continue;
    try {
      const pr = JSON.parse(gh(['pr', 'view', String(a.ref.pr), '--repo', REPO, '--json', 'state,labels,headRefOid']));
      const labels = pr.labels.map((l) => l.name);
      if (pr.state !== 'OPEN') { await finish(a, 'refused', `PR is ${pr.state}`); continue; }
      if (!labels.includes('tier:hold')) { await finish(a, 'refused', 'PR no longer carries tier:hold'); continue; }
      if (pr.headRefOid !== a.ref.headSha) {
        await finish(a, 'refused', `pushed after your answer (${a.ref.headSha.slice(0, 7)} → ${pr.headRefOid.slice(0, 7)}); answer again`);
        continue;
      }

      if (a.choice === 'other') {
        const body = `**Derek, via the decisions page** (${a.answered_by}, ${a.answered_at.toISOString()}):\n\n${a.text}`;
        if (DRY) { await finish(a, 'done', '[dry-run] would comment and add `blocked`'); continue; }
        gh(['pr', 'comment', String(a.ref.pr), '--repo', REPO, '--body', body]);
        gh(['pr', 'edit', String(a.ref.pr), '--repo', REPO, '--add-label', 'blocked']);
        await finish(a, 'done', 'commented and labelled `blocked`');
        continue;
      }

      if (a.choice === 'default') {
        const r = spawnSync(resolve(ROOT, 'scripts/maintenance/safe-merge.sh'), [...(DRY ? ['--dry-run'] : []), String(a.ref.pr)],
          { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60_000 });
        const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
        process.stdout.write(out ? `${out}\n` : '');
        const last = out.split('\n').filter((l) => /REFUSED|merged #/.test(l)).pop() || out.split('\n').pop() || '';
        if (r.status === 0) { if (!DRY) merged = true; await finish(a, 'done', last); }
        else if (r.status === 1) await finish(a, 'refused', last);
        else await finish(a, 'failed', `safe-merge.sh exited ${r.status ?? r.signal}: ${last}`);
      }
    } catch (e) {
      await finish(a, 'failed', e.message);
    }
  }
}

try {
  await run();
} finally {
  await client.close();
}
