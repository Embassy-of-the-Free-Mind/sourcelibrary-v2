#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/pipeline-hold-drift.mjs (daily; reconciles the hold MARKER against the STATUS
 * — clobbered, orphaned, leaked — and flags one reason's release, ia-wrong-leaf-4790. It asks "is the
 * hold still holding?", never "should it still be held?", and it reads neither GitHub nor the ops
 * decision log; this borrows its one-issue --alert shape). scripts/maintenance/daily-digest.mjs and
 * ntfy-morning-digest.mjs count tier:hold PRs, not held books. scripts/maintenance/hold-pipeline-books.mjs
 * releases; it does not look for what to release.
 *
 * hold-release-check — which holds nobody is releasing (#7860). Weekly.
 *
 * WHY. Placing a hold is one line; nothing owned releasing one. On 2026-10-31: 464,263 held books under
 * 108 reasons; 1,535 had sat a month on `*-awaits-derek` holds whose decisions were already made
 * (Tibetan: Opus via claude -p, 10-24; Syriac: $45 approved), and the Leiden Qur'an stayed held after
 * its pages checked clean. Every hold now carries `release_when` (scripts/lib/pipeline-hold.mjs); this
 * reads it, per (reason, issue, release_when) group, and lists:
 *
 *   QUIET      held over 14 days, and the issue that owns it had no comment in 14 days (or it has no
 *              issue at all). Nobody is working toward the release.
 *   DECIDED    an `*-awaits-*` hold, or one whose release_when is a decision, whose decision appears in
 *              ops DECIDED.md or a DECISIONS-PENDING.md "Done" section (punctuation and case folded), or —
 *              for an awaits hold, or when the ops log cannot be read — a "decided" / "default taken"
 *              comment on its issue after the hold. Decided, never released.
 *   DUE        release_when is a date in the past, or an issue that is now closed.
 *   NO_CONDITION  a hold with no release_when: a writer that bypassed holdBook(). Must be 0.
 *
 * NOT ACQUIRED (NOT_ACQUIRED_HOLD_REASONS: manifest-only-lazy-pages, acquisition-wave-2026-10b) is
 * reported on its own line and never flagged: catalogue records without pages are a storage state, not a
 * decision anyone is sitting on (#7860 group 1). `test` conditions are counted, not run.
 *
 * Exit 0 = nothing flagged, 1 = flagged, 2 = could not measure (Mongo, GitHub or both ops files
 * unreadable for a check that needs them). UNKNOWN is not PASS (measurement-instruments.md).
 *
 * --alert keeps ONE GitHub issue (deduped by title): filed when anything is flagged, its body rewritten
 * each run, a comment when the flagged set of reasons changes, closed on the first clean run.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/hold-release-check.mjs [--json] [--alert] [--out <file.json>]
 *   SL_OPS_DIR=<ops clone>   read DECIDED.md / DECISIONS-PENDING.md there (default ~/sourcelibrary-ops; else GitHub)
 */
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isNotAcquiredReason } from '../lib/pipeline-hold.mjs';

const REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
const OPS_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-ops';
const ISSUE_TITLE = 'Holds nobody is releasing (weekly hold-release check)';
const QUIET_DAYS = 14;
const JSON_OUT = process.argv.includes('--json');
const ALERT = process.argv.includes('--alert');
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const DAY = 86_400_000;

/** Case and punctuation folded, so 'Syriac re-translation' finds 'syriac retranslation'. */
export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/** The decided text: all of DECIDED.md, and the "## Done …" sections of DECISIONS-PENDING.md. */
export function decidedLines(decidedMd, pendingMd) {
  const out = [];
  if (decidedMd) for (const l of decidedMd.split('\n')) if (l.trim()) out.push({ file: 'DECIDED.md', line: l });
  if (pendingMd) {
    let inDone = false;
    for (const l of pendingMd.split('\n')) {
      if (/^##\s/.test(l)) inDone = /^##\s+Done\b/i.test(l);
      else if (inDone && l.trim()) out.push({ file: 'DECISIONS-PENDING.md Done', line: l });
    }
  }
  return out.map((x) => ({ ...x, folded: fold(x.line) }));
}

/** The first decided line naming any of `terms` (folded, at least 6 characters, so a stray word cannot match). */
export function findDecision(lines, terms) {
  const fs = [...new Set(terms.map(fold).filter((t) => t.length >= 6))];
  for (const x of lines) for (const t of fs) if (x.folded.includes(t)) return { file: x.file, term: t, line: x.line.trim().slice(0, 220) };
  return null;
}

export const AWAITS = /-awaits-/;
/** Flags for one group, from its facts. Pure, so the rules are tested without Mongo or GitHub. */
export function classify(g, { now, issues, decided, decidedReadable }) {
  const flags = [];
  const rw = g.release_when;
  if (!rw) flags.push({ flag: 'NO_CONDITION' });
  const owner = rw?.kind === 'issue' ? rw.ref : g.issue;
  const ist = owner ? issues.get(owner) : null;
  if (rw?.kind === 'date' && Date.parse(rw.ref) < now) flags.push({ flag: 'DUE', why: `release_when date ${rw.ref} has passed` });
  if (rw?.kind === 'issue' && ist?.state === 'closed') flags.push({ flag: 'DUE', why: `#${rw.ref} closed ${String(ist.closed_at).slice(0, 10)}` });
  const ageDays = (now - new Date(g.oldest).getTime()) / DAY;
  if (ageDays > QUIET_DAYS && !(rw?.kind === 'issue' && ist?.state === 'closed')) {
    if (!owner) flags.push({ flag: 'QUIET', why: `held ${Math.floor(ageDays)} days with no issue to watch` });
    else if (ist?.state === 'closed') flags.push({ flag: 'QUIET', why: `held ${Math.floor(ageDays)} days; its issue #${owner} closed ${String(ist.closed_at).slice(0, 10)}` });
    else if (ist && ist.state === 'open' && !ist.recent_comment) flags.push({ flag: 'QUIET', why: `held ${Math.floor(ageDays)} days; #${owner} has no comment in ${QUIET_DAYS} days` });
  }
  if (AWAITS.test(g.reason) || rw?.kind === 'decision') {
    const hit = decidedReadable ? findDecision(decided, [rw?.kind === 'decision' ? rw.ref : '', AWAITS.test(g.reason) ? g.reason : '']) : null;
    if (hit) flags.push({ flag: 'DECIDED', why: `${hit.file}: "${hit.line}"` });
    else if ((AWAITS.test(g.reason) || !decidedReadable) && ist?.decided_comment) flags.push({ flag: 'DECIDED', why: `#${owner} comment ${ist.decided_comment.at.slice(0, 10)}: "${ist.decided_comment.text}"` });
  }
  return flags;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 32 << 20 }).trim();
}

function readOps(name) {
  const dir = process.env.SL_OPS_DIR || join(homedir(), 'sourcelibrary-ops');
  const p = join(dir, name);
  if (existsSync(p)) return readFileSync(p, 'utf8');
  try { return gh(['api', `repos/${OPS_REPO}/contents/${name}`, '-H', 'Accept: application/vnd.github.raw']); } catch { return null; }
}

/** State, closed date, a comment in the last QUIET_DAYS, and (if asked) the first "decided" comment after `since`. */
function issueFacts(n, since) {
  const it = JSON.parse(gh(['api', `repos/${REPO}/issues/${n}`]));
  const quietSince = new Date(Date.now() - QUIET_DAYS * DAY).toISOString();
  // `since` filters on a comment's updated_at; created_at is checked too, so an old comment edited today does not count.
  const recent = JSON.parse(gh(['api', `repos/${REPO}/issues/${n}/comments?since=${quietSince}&per_page=100`]) || '[]').filter((c) => c.created_at >= quietSince);
  let decided_comment = null;
  if (since) {
    const all = JSON.parse(gh(['api', '--paginate', `repos/${REPO}/issues/${n}/comments?since=${since}&per_page=100`]) || '[]');
    const c = all.find((x) => x.created_at >= since && /\b(decided|default taken)\b/i.test(x.body || ''));
    if (c) decided_comment = { at: c.created_at, text: (c.body.match(/[^\n]*\b(decided|default taken)\b[^\n]*/i)?.[0] || '').trim().slice(0, 160) };
  }
  return { state: it.state, closed_at: it.closed_at, recent_comment: recent.length > 0, decided_comment };
}

async function main() {
  let mongo;
  try { mongo = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 }); await mongo.connect(); } catch (e) { console.error(`UNKNOWN: cannot reach Mongo — ${e.message}`); return 2; }
  const now = Date.now();
  let groups;
  try {
    groups = (await mongo.db('bookstore').collection('books').aggregate([
      { $match: { 'pipeline_auto.hold': { $exists: true } } },
      { $group: {
        _id: { reason: '$pipeline_auto.hold.reason', issue: '$pipeline_auto.hold.issue', kind: '$pipeline_auto.hold.release_when.kind', ref: '$pipeline_auto.hold.release_when.ref' },
        n: { $sum: 1 }, visible: { $sum: { $cond: [{ $eq: ['$visible', true] }, 1, 0] } },
        oldest: { $min: '$pipeline_auto.hold.held_at' }, newest: { $max: '$pipeline_auto.hold.held_at' },
      } },
      { $sort: { n: -1 } },
    ], { allowDiskUse: true }).toArray()).map((g) => ({
      reason: g._id.reason, issue: g._id.issue ?? null, release_when: g._id.kind ? { kind: g._id.kind, ref: g._id.ref } : null,
      n: g.n, visible: g.visible, oldest: g.oldest, newest: g.newest,
    }));
  } catch (e) { console.error(`UNKNOWN: ${e.message}`); return 2; } finally { await mongo.close().catch(() => {}); }

  const notAcquired = groups.filter((g) => isNotAcquiredReason(g.reason));
  const scope = groups.filter((g) => !isNotAcquiredReason(g.reason));
  const decidedMd = readOps('DECIDED.md'), pendingMd = readOps('DECISIONS-PENDING.md');
  const decidedReadable = !!(decidedMd || pendingMd);
  const decided = decidedLines(decidedMd, pendingMd);

  // One read per issue: the hold's own issue and any issue a release_when names; "decided" comments only where needed.
  const wantDecided = new Map();
  for (const g of scope) {
    const owner = g.release_when?.kind === 'issue' ? g.release_when.ref : g.issue;
    if (!owner) continue;
    const needs = AWAITS.test(g.reason) || (!decidedReadable && g.release_when?.kind === 'decision');
    const since = new Date(g.oldest).toISOString();
    if (!wantDecided.has(owner)) wantDecided.set(owner, null);
    if (needs && (!wantDecided.get(owner) || since < wantDecided.get(owner))) wantDecided.set(owner, since);
  }
  const issues = new Map();
  try { for (const [n, since] of wantDecided) issues.set(n, issueFacts(n, since)); } catch (e) { console.error(`UNKNOWN: GitHub read failed — ${String(e.stderr || e.message).split('\n')[0]}`); return 2; }

  const rows = scope.map((g) => ({ ...g, flags: classify(g, { now, issues, decided, decidedReadable }) }));
  const flagged = rows.filter((r) => r.flags.length);
  const byFlag = {};
  for (const r of flagged) for (const f of new Set(r.flags.map((x) => x.flag))) byFlag[f] = { groups: (byFlag[f]?.groups || 0) + 1, books: (byFlag[f]?.books || 0) + r.n };
  const totals = {
    held: groups.reduce((s, g) => s + g.n, 0), reasons: new Set(groups.map((g) => g.reason)).size,
    not_acquired: notAcquired.reduce((s, g) => s + g.n, 0), in_scope: scope.reduce((s, g) => s + g.n, 0),
    in_scope_reasons: new Set(scope.map((g) => g.reason)).size, flagged_books: flagged.reduce((s, r) => s + r.n, 0),
    flagged_reasons: new Set(flagged.map((r) => r.reason)).size, by_flag: byFlag, ops_log: decidedReadable ? 'read' : 'UNREADABLE (fell back to issue comments)',
    by_kind: rows.reduce((o, r) => { const k = r.release_when?.kind || 'none'; o[k] = (o[k] || 0) + r.n; return o; }, {}),
  };

  log(`hold-release check ${new Date(now).toISOString().slice(0, 10)}: ${totals.held} held books under ${totals.reasons} reasons`);
  log(`  not acquired (reported apart, never flagged): ${totals.not_acquired} — ${notAcquired.map((g) => `${g.reason} ${g.n}`).join(', ') || 'none'}`);
  log(`  in scope: ${totals.in_scope} books, ${totals.in_scope_reasons} reasons; release_when kinds ${Object.entries(totals.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')}; ops decision log ${totals.ops_log}`);
  log(`  flagged: ${totals.flagged_books} books under ${totals.flagged_reasons} reasons — ${Object.entries(byFlag).map(([k, v]) => `${k} ${v.books} books/${v.groups} groups`).join(', ') || 'none'}`);
  for (const r of flagged) log(`  ${String(r.n).padStart(7)} ${r.reason}${r.issue ? ` #${r.issue}` : ''} [${r.release_when ? `${r.release_when.kind}:${r.release_when.ref}` : 'no release_when'}] ${r.flags.map((f) => `${f.flag}${f.why ? ` (${f.why})` : ''}`).join('; ')}`);

  const report = { at: new Date(now).toISOString(), totals, not_acquired: notAcquired, flagged, rows };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
  if (JSON_OUT) console.log(JSON.stringify({ totals, flagged: flagged.map((r) => ({ reason: r.reason, issue: r.issue, release_when: r.release_when, n: r.n, flags: r.flags })) }));
  if (ALERT) alert(report);
  return flagged.length ? 1 : 0;
}

function alert({ at, totals, flagged }) {
  const reasons = [...new Set(flagged.map((r) => r.reason))].sort();
  const marker = `<!-- hold-release-check reasons: ${reasons.join(',')} -->`;
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const body = `${marker}\n**${totals.flagged_books} held books under ${totals.flagged_reasons} reasons** are flagged at ${at} `
    + `(${Object.entries(totals.by_flag).map(([k, v]) => `${k} ${v.books}`).join(', ')}), of ${totals.in_scope} held books in scope. `
    + `${totals.not_acquired} not-acquired catalogue records (manifest-only-lazy-pages, acquisition-wave-2026-10b) are counted apart and never flagged.\n\n`
    + '| books | reason | release_when | flags |\n|---:|---|---|---|\n'
    + flagged.slice(0, 120).map((r) => `| ${r.n} | \`${r.reason}\`${r.issue ? ` #${r.issue}` : ''} | ${r.release_when ? esc(`${r.release_when.kind}:${r.release_when.ref}`) : '**none**'} | ${esc(r.flags.map((f) => `${f.flag}${f.why ? `: ${f.why}` : ''}`).join('; ')).slice(0, 400)} |`).join('\n')
    + (flagged.length > 120 ? `\n\n… and ${flagged.length - 120} more groups (run the check for the full list).` : '')
    + '\n\n**QUIET**: held over 14 days, its issue silent 14 days. **DECIDED**: the decision it waits on is in ops DECIDED.md / DECISIONS-PENDING Done, or a "decided"/"default taken" comment. '
    + '**DUE**: its release date passed or its issue closed. **NO_CONDITION**: no `release_when` (a writer bypassed `holdBook()`). '
    + 'Release with `scripts/maintenance/hold-pipeline-books.mjs --release-held --reason <reason> --apply`, or say on the hold\'s issue why it stays. '
    + `Filed by \`scripts/audit/hold-release-check.mjs --alert\` (weekly, #7860). Rewritten each run; closes itself on the first clean run.`;
  try {
    const list = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title,body', '--limit', '20']) || '[]');
    const open = list.find((i) => i.title.startsWith(ISSUE_TITLE)) || null;
    if (flagged.length && !open) log(`filed ${gh(['issue', 'create', '--repo', REPO, '--title', ISSUE_TITLE, '--body', body])}`);
    else if (flagged.length) {
      const prev = (open.body.match(/<!-- hold-release-check reasons: ([^>]*) -->/)?.[1] || '').split(',').filter(Boolean);
      gh(['issue', 'edit', String(open.number), '--repo', REPO, '--body', body]);
      const added = reasons.filter((r) => !prev.includes(r)), gone = prev.filter((r) => !reasons.includes(r));
      if (added.length || gone.length) gh(['issue', 'comment', String(open.number), '--repo', REPO, '--body', `Flagged reasons changed at ${at}: ${added.length ? `new ${added.map((r) => `\`${r}\``).join(', ')}` : ''}${added.length && gone.length ? '; ' : ''}${gone.length ? `cleared ${gone.map((r) => `\`${r}\``).join(', ')}` : ''}. ${totals.flagged_books} books flagged.`]);
      log(`updated #${open.number}${added.length || gone.length ? ' (commented)' : ''}`);
    } else if (open) { gh(['issue', 'close', String(open.number), '--repo', REPO, '--comment', `Nothing flagged at ${at}: ${totals.in_scope} held books in scope, every one with a live owner, an undecided decision or a future date. Closing.`]); log(`closed #${open.number}`); }
  } catch (e) {
    console.error(`GitHub issue step failed: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
