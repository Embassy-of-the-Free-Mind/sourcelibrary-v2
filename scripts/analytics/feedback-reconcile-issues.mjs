#!/usr/bin/env node
// Feedback ↔ issue reconciler — close the loop so fixed feedback stops
// re-surfacing in triage.
//
// The problem this solves: feedback items get fixed (often via a GitHub issue +
// PR, frequently in a different session), but the originating `feedback` row is
// never marked `addressed`. So `feedback-triage.mjs` keeps re-listing them and
// we waste time re-verifying work that's already done. A naive keyword→PR-title
// matcher is far too noisy to trust (measured: 99/104 open items "matched" on
// common words like "translation"/"pages"). The reliable signal is EXPLICIT
// linkage, not guessing.
//
// The convention (one line, anywhere in the issue body):
//   Feedback-ID: <mongo _id>            e.g.  Feedback-ID: 6a473930a5f38bf2d79673bf
// or the HTML-comment form if you'd rather not show it:
//   <!-- feedback-id: 6a473930a5f38bf2d79673bf -->
// Multiple ids (one issue covering several reports) are fine — comma/space
// separated, or repeat the line.
//
// This script reads CLOSED issues carrying that marker and marks their linked
// feedback rows `addressed`, with a link back to the issue. It writes Mongo
// state ONLY — like feedback-triage.mjs, it never sends the submitter email
// (that fires solely from PATCH /api/feedback/[id]); it warns when a resolved
// row has an email so a human can send the reply via /admin/feedback.
//
// Run (dry-run):  set -a; source .env.production.local; set +a; node scripts/analytics/feedback-reconcile-issues.mjs
// Apply:          ... feedback-reconcile-issues.mjs --apply
// Options:        --repo <owner/name>  (default: gh's current repo)
//                 --state closed|all   (default: closed — only resolved issues mark feedback done)
//
// Requires: `gh` authenticated. Safe to run repeatedly (idempotent — skips rows
// already addressed).

import { withMongo } from '../lib/mongo.mjs';
import { ObjectId } from 'mongodb';
import { execSync } from 'child_process';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply');
const STATE = arg('--state') || 'closed';
const REPO = arg('--repo');

// Pull the feedback ids out of an issue body. Accepts:
//   Feedback-ID: <id>[, <id> ...]
//   <!-- feedback-id: <id> -->
const ID_LINE_RE = /(?:feedback[-\s]?id)\s*[:=]\s*([0-9a-f, \n]+?)(?:-->|$)/gim;
function extractFeedbackIds(body) {
  const ids = new Set();
  let m;
  while ((m = ID_LINE_RE.exec(body || '')) !== null) {
    for (const tok of m[1].split(/[,\s]+/)) {
      const t = tok.trim();
      if (ObjectId.isValid(t)) ids.add(t);
    }
  }
  return [...ids];
}

function ghIssues() {
  const repoFlag = REPO ? `--repo ${REPO}` : '';
  // gh caps --limit; 1000 is plenty for a feedback-linked issue set.
  const raw = execSync(
    `gh issue list ${repoFlag} --label user-feedback --state ${STATE} --limit 1000 --json number,title,body,state,url,closedAt`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(raw);
}

await withMongo(async (db) => {
  const fb = db.collection('feedback');

  let issues;
  try {
    issues = ghIssues();
  } catch (e) {
    console.error('Failed to list issues via gh — is gh authenticated?\n', e.message);
    process.exitCode = 1;
    return;
  }

  const linked = [];
  for (const iss of issues) {
    for (const fid of extractFeedbackIds(iss.body)) {
      linked.push({ fid, issue: iss });
    }
  }

  console.log('# Feedback ↔ issue reconciler');
  console.log(`Scanned ${issues.length} ${STATE} user-feedback issue(s); found ${linked.length} feedback link(s).\n`);
  if (!linked.length) {
    console.log('No linked feedback ids found. Tag issues with a "Feedback-ID: <id>" line to enable auto-resolution.');
    return;
  }

  const toMark = [];
  const emailWarn = [];
  for (const { fid, issue } of linked) {
    const row = await fb.findOne({ _id: new ObjectId(fid) });
    if (!row) { console.log(`  #${issue.number}  ↳ ${fid}  — no such feedback row (skip)`); continue; }
    if (row.addressed) { console.log(`  #${issue.number}  ↳ ${fid}  — already addressed (skip)`); continue; }
    // Only closed issues resolve feedback. An open issue linked here (with --state all)
    // is informational — the work isn't done yet.
    if (issue.state.toLowerCase() !== 'closed') {
      console.log(`  #${issue.number}  ↳ ${fid}  — issue still OPEN, leaving feedback open`);
      continue;
    }
    toMark.push({ fid, issue, row });
    if ((row.email || '').includes('@')) emailWarn.push({ fid, email: row.email });
    console.log(`  #${issue.number} (${issue.title.slice(0, 60)})  ↳ ${fid}  — WILL MARK addressed`);
  }

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY-RUN'}: ${toMark.length} feedback row(s) to mark addressed.`);
  if (emailWarn.length) {
    console.log(`⚠ ${emailWarn.length} have an email — script-marking does NOT send the reply. Resolve in /admin/feedback to email the submitter:`);
    for (const e of emailWarn) console.log(`    ${e.fid}  ${e.email}`);
  }
  if (!APPLY) { console.log('(add --apply to write)'); return; }

  let modified = 0;
  for (const { fid, issue } of toMark) {
    const res = await fb.updateOne(
      { _id: new ObjectId(fid), addressed: { $ne: true } },
      { $set: {
          read: true, read_at: new Date(),
          addressed: true, addressed_at: new Date(),
          addressed_by: 'feedback-issue-reconciler',
          addressed_action: `Resolved by closed issue #${issue.number}: ${issue.title}`.slice(0, 1000),
          addressed_link: issue.url,
          updated_at: new Date(),
        } }
    );
    modified += res.modifiedCount;
  }
  console.log(`modified ${modified}`);
}, { timeoutMs: 120000 });
