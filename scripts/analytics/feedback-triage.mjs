#!/usr/bin/env node
// Feedback triage — pull the open feedback queue, classify each item, and flag
// the ones that need a human (emailed replies, partner-CMS notes). Read-only by
// default. The /feedback skill drives this; see .claude/skills/feedback.
//
// Lifecycle (mirrors src/app/api/feedback/route.ts):
//   unread     read != true
//   read       read == true && addressed != true   <- triaged but not resolved
//   addressed  addressed == true                    <- done (auto-emailed submitter if email present)
//
// Run (report):   set -a; source .env.production.local; set +a; node scripts/analytics/feedback-triage.mjs [--days N] [--all] [--channel web|mcp]
// Mark read:      ... feedback-triage.mjs --mark-read <id,id,...> --apply
// Mark addressed: ... feedback-triage.mjs --mark-addressed <id,id,...> --note "what was done" [--link URL] --apply
//
// NOTE: --mark-addressed here writes Mongo state ONLY. It does NOT send the
// submitter the auto-reply email — that fires solely from the admin API
// (PATCH /api/feedback/[id]). Use script-marking for anonymous / no-email rows
// (the bulk); for rows WITH an email that deserve a reply, resolve them in the
// /admin/feedback UI so the canonical email + idempotency guard run. The report
// flags which rows have an email.

import { withMongo } from '../lib/mongo.mjs';
import { ObjectId } from 'mongodb';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(k);
const DAYS = Number(arg('--days') || 0);            // 0 = all open, regardless of age
const APPLY = has('--apply');

// --- classification: priority cascade, first match wins ---
const CLASSIFIERS = [
  ['translation-request', /translation requested for|needs? translation|not (yet )?translated|please translate|translation\?/i],
  ['praise', /\bthank|gracias|grazie|amazing|wonderful|beautiful|\blove (it|this)|so happy|incre[ií]ble|bello esfuerzo|maravillos/i],
  ['bug', /not loading|won.?t (load|open|work)|can.?t (load|see|open)|error|broken|isn.?t working|doesn.?t work|blank|hides everything|went nuts|stuck|404|missing|no se ve|no carga|no puedo ver/i],
  ['metadata-correction', /\bnot \d{3,4}\b|wrong|incorrect|should be|actually the|you (claim|are using)|edition|impressum|provenance|\bUBN\b|repeatable|separate field|two separate/i],
  ['feature-request', /feature request|would be (nice|great|good)|please add|could you add|suggestion|i.?d like|i wish|make it easier|add a (button|field|way)/i],
];
function classify(r) {
  if ((r.page || '').startsWith('/catalog/')) return 'partner-cms';
  const m = (r.message || '');
  for (const [label, re] of CLASSIFIERS) if (re.test(m)) return label;
  return 'other';
}

// Agent-submitted rows (public MCP submit_feedback tool) have a different
// profile from human ones — long, high-volume, claims unverified — so the
// report splits them out. `channel` is set at insert since 2026-08; the
// user_agent prefix covers older rows (same rule as the backfill).
const isAgent = (r) => r.channel === 'mcp' || (r.user_agent || '').startsWith('SourceLibrary-MCP');

await withMongo(async (db) => {
  const fb = db.collection('feedback');

  // --- write modes ---
  const markRead = arg('--mark-read');
  const markAddr = arg('--mark-addressed');
  if (markRead || markAddr) {
    const ids = (markRead || markAddr).split(',').map((s) => s.trim()).filter((s) => ObjectId.isValid(s));
    if (!ids.length) { console.log('No valid ObjectIds given.'); return; }
    const set = markAddr
      ? { read: true, read_at: new Date(), addressed: true, addressed_at: new Date(), addressed_by: 'feedback-triage-skill', addressed_action: (arg('--note') || '').slice(0, 1000), ...(arg('--link') ? { addressed_link: arg('--link') } : {}), updated_at: new Date() }
      : { read: true, read_at: new Date(), updated_at: new Date() };
    console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} ${markAddr ? 'mark-addressed' : 'mark-read'} on ${ids.length} rows`);
    if (markAddr) {
      const withEmail = await fb.countDocuments({ _id: { $in: ids.map((i) => new ObjectId(i)) }, email: { $regex: '@' } });
      if (withEmail) console.log(`⚠ ${withEmail} of these have an email — script-marking does NOT send the reply. Resolve those in /admin/feedback to email the submitter.`);
    }
    if (!APPLY) { console.log('(add --apply to write)'); return; }
    const res = await fb.updateMany({ _id: { $in: ids.map((i) => new ObjectId(i)) } }, { $set: set });
    console.log(`modified ${res.modifiedCount}`);
    return;
  }

  // --- report mode ---
  const q = has('--all') ? {} : { $or: [{ read: { $ne: true } }, { read: true, addressed: { $ne: true } }] };
  if (DAYS) q.created_at = { $gt: new Date(Date.now() - DAYS * 864e5) };
  const counts = {
    unread: await fb.countDocuments({ read: { $ne: true } }),
    read_unaddressed: await fb.countDocuments({ read: true, addressed: { $ne: true } }),
    addressed: await fb.countDocuments({ addressed: true }),
  };
  let rows = await fb.find(q).sort({ created_at: -1 }).toArray();
  const CHANNEL = arg('--channel'); // 'web' | 'mcp' | null (both)
  if (CHANNEL === 'mcp') rows = rows.filter(isAgent);
  else if (CHANNEL === 'web') rows = rows.filter((r) => !isAgent(r));

  console.log('# Feedback triage');
  console.log(`Queue: ${counts.unread} unread · ${counts.read_unaddressed} read-but-unresolved · ${counts.addressed} addressed (done)`);
  console.log(`Showing ${rows.length} open items${DAYS ? ` (last ${DAYS}d)` : ''}${CHANNEL ? ` (channel: ${CHANNEL})` : ''}\n`);

  const printGroups = (subset) => {
    const groups = {};
    for (const r of subset) (groups[classify(r)] ??= []).push(r);
    const order = ['bug', 'translation-request', 'metadata-correction', 'partner-cms', 'feature-request', 'praise', 'other'];
    for (const g of order) {
      const items = groups[g]; if (!items?.length) continue;
      console.log(`\n## ${g}  (${items.length})`);
      for (const r of items) {
        const email = (r.email || '').includes('@') ? ` ✉ ${r.email}` : '';
        const state = r.read ? '[read]' : '[unread]';
        console.log(`- ${r._id}  ${new Date(r.created_at).toISOString().slice(0, 10)} ${state}${email}  ${r.name ? '~' + r.name : ''}`);
        console.log(`    page: ${r.page || '?'}`);
        console.log(`    ${(r.message || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
      }
    }
  };

  // Humans first — scarce, motivated, and often owed a reply. Agent reports
  // (MCP tool) follow in their own section; treat their claims as unverified.
  const human = rows.filter((r) => !isAgent(r));
  const agent = rows.filter(isAgent);
  if (CHANNEL) {
    printGroups(rows);
  } else {
    console.log(`\n═══ HUMAN feedback (${human.length}) ═══`);
    printGroups(human);
    console.log(`\n═══ AGENT feedback via MCP (${agent.length}) — claims unverified, triage into issues ═══`);
    printGroups(agent);
  }
  const emailed = rows.filter((r) => (r.email || '').includes('@')).length;
  console.log(`\n— ${emailed} open items left an email (reply candidates) · ${rows.length - emailed} anonymous (bulk-resolvable)`);
}, { timeoutMs: 90000 });
