// PRIOR ART: scripts/batch/siku-translate-lane.mjs spotCheck() (writes its STOP, pages once, comments on #5600 —
// no owner after that), scripts/maintenance/page-frame-sweep-waves.sh say() (same shape in shell),
// scripts/maintenance/pipeline-now-push.mjs LANE_STATE_DIRS (reads `stopped` for one lane, pages nobody),
// scripts/lib/model-limits.mjs (a per-lane stop JSON for quota locks, which expire on their own — a
// containment STOP never does), scripts/lib/ntfy-send.mjs (the sender used here). None opens a ticket or
// keeps paging while the STOP stands; this is the one place that does (#7912).
//
// A lane STOP is a file on a disk. Written alone it has no owner: the Siku lane logged "paused: STOP exists"
// every 15 min for three days and nobody acted (#7912). Every STOP a lane (or a person) writes goes through
// writeLaneStop(), which does four things in order:
//   1. writes the STOP file (the lane reads it; unchanged contract: `rm <stop>` resumes);
//   2. opens, or reuses, one GitHub issue per lane titled "Lane STOP: <lane> — …", labelled `lane-stop`
//      (+ `contained` when kind = 'containment'), with the evidence links, the STOP path and the release command;
//   3. comments on the lane's own issue, linking the ticket;
//   4. upserts a row in the box registry (REGISTRY_PATH), which checkStops() reads daily to page ntfy
//      `sourcelibrary-uptime` once a day per standing STOP, and work-board-push.mjs shows on /admin/work.
// Releasing a STOP stays a human or measured-test decision (containment-on-finding.md): nothing here removes one.
//
// dryRun: no file, no GitHub, no ntfy, no registry write — everything is computed and returned.
// CLI: scripts/maintenance/lane-stops.mjs (stop | register | check | list).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ntfyPost } from './ntfy-send.mjs';

export const REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
export const REGISTRY_PATH = process.env.LANE_STOP_REGISTRY || '/var/lib/sourcelibrary/lane-stops.json';
export const NTFY_URL = 'https://ntfy.sh/sourcelibrary-uptime';
export const KINDS = Object.freeze(['containment', 'quality', 'ops']);
const DAY_MS = 86400_000;

export const issueTitlePrefix = (lane) => `Lane STOP: ${lane} —`;

/** `gh` with stdin; injectable for tests. Returns { status, stdout, stderr }. */
export function ghCli(args, input) {
  const r = spawnSync('gh', args, { input: input ?? '', encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

export function readRegistry(file = REGISTRY_PATH) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j?.stops) ? j : { stops: [] };
  } catch { return { stops: [] }; }
}

export function writeRegistry(reg, file = REGISTRY_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...reg, updated_at: new Date().toISOString() }, null, 1));
  fs.renameSync(tmp, file);
}

/** Rows whose STOP has not been seen removed. */
export const standing = (reg) => (reg.stops || []).filter((r) => !r.released_at);

/** The ticket body. Pure. */
export function issueBody(o) {
  const ev = (o.evidence || []).map((e) => `- ${e.url ? `[${e.label}](${e.url})` : e.label}${e.note ? `: ${e.note}` : ''}`);
  return [
    `**${o.lane}** is stopped. ${o.reason}`,
    '',
    `- STOP: \`${o.stop_path}\` on \`${o.box}\`, written ${o.stopped_at}${o.by ? ` by ${o.by}` : ''}`,
    o.lane_issue ? `- Lane issue: #${o.lane_issue}` : null,
    o.pages_waiting != null ? `- Pages waiting: ${o.pages_waiting.toLocaleString('en-US')} (measured ${o.pages_waiting_at})` : null,
    `- Release (a person's or a measured test's decision, never this ticket's): \`${o.release_command}\``,
    '',
    ev.length ? '**Evidence**' : null,
    ...ev,
    ev.length ? '' : null,
    o.kind === 'containment'
      ? '`contained`: the pages named above are withheld and their books held (`.claude/docs/invariants/containment-on-finding.md`); the repair is still owed.'
      : null,
    `While the STOP stands, ntfy \`sourcelibrary-uptime\` gets one page a day with its age (\`scripts/maintenance/lane-stops.mjs check\`). Registry: \`${o.registry}\` on \`${o.box}\`. Close this when the lane is released or retired (#7912).`,
  ].filter((l) => l != null).join('\n');
}

/** One day's page for a standing STOP. Pure. */
export function pagePayload(row, now = new Date()) {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(row.stopped_at)) / DAY_MS));
  const age = days >= 1 ? `${days} d` : `${Math.max(0, Math.round((now.getTime() - Date.parse(row.stopped_at)) / 3600_000))} h`;
  const ticket = row.ticket?.url ?? (row.ticket?.number ? `#${row.ticket.number}` : 'no ticket');
  return {
    url: NTFY_URL,
    headers: { Title: `Lane STOP standing ${age}: ${row.lane}`, Priority: 'default', Tags: 'octagonal_sign' },
    body: [
      `${row.lane} has been stopped ${age} (since ${row.stopped_at}): ${row.reason}`,
      row.pages_waiting != null ? `Pages waiting: ${row.pages_waiting.toLocaleString('en-US')} (as of ${String(row.pages_waiting_at).slice(0, 10)}).` : null,
      `Ticket: ${ticket}. Release: ${row.release_command}`,
    ].filter(Boolean).join('\n'),
  };
}

function findTicket(lane, gh) {
  const r = gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--label', 'lane-stop', '--search', `"Lane STOP: ${lane}" in:title`, '--json', 'number,title,url', '--limit', '20']);
  if (r.status !== 0) throw new Error(`gh issue list failed: ${r.stderr.slice(0, 200)}`);
  return JSON.parse(r.stdout || '[]').find((i) => i.title.startsWith(issueTitlePrefix(lane))) ?? null;
}

function ensureLabel(gh) {
  // `gh issue create --label x` fails outright when x does not exist. Idempotent: --force updates in place.
  gh(['label', 'create', 'lane-stop', '--repo', REPO, '--color', 'B60205', '--force',
    '--description', 'A lane is stopped by a STOP file; paged daily until released (#7912)']);
}

/**
 * Write (or, with writeFile:false, register an existing) STOP and give it an owner.
 * o: { lane, stopPath, reason, kind, laneIssue?, evidence?: [{label, url?, note?}], pagesWaiting?, pagesWaitingAt?,
 *      releaseCommand?, by?, box?, stoppedAt?, writeFile = true, dryRun = false, registryPath, gh, now,
 *      commentLaneIssue = true (false when the caller posts its own lane-issue comment and links row.ticket) }
 * Returns { row, title, body, ticket, laneComment, actions }.
 */
export async function writeLaneStop(o) {
  const {
    lane, stopPath, reason, kind = 'containment', laneIssue = null, evidence = [], pagesWaiting = null,
    by = null, box = os.hostname(), writeFile = true, dryRun = false, registryPath = REGISTRY_PATH, commentLaneIssue = true,
    gh = ghCli, now = new Date(),
  } = o;
  if (!lane || !stopPath || !reason) throw new Error('writeLaneStop: lane, stopPath and reason are required');
  if (!KINDS.includes(kind)) throw new Error(`writeLaneStop: kind must be one of ${KINDS.join(', ')}`);
  const abs = path.resolve(stopPath);
  const actions = [];

  if (writeFile) {
    if (dryRun) actions.push(`would write ${abs}`);
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, `${reason}\n`); actions.push(`wrote ${abs}`); }
  } else if (!fs.existsSync(abs)) {
    throw new Error(`register: ${abs} does not exist; nothing to register`);
  }
  let stoppedAt = o.stoppedAt ?? null;
  if (!stoppedAt) {
    try { stoppedAt = writeFile && !dryRun ? now.toISOString() : fs.statSync(abs).mtime.toISOString(); } catch { stoppedAt = now.toISOString(); }
  }

  const row = {
    id: `${box}:${abs}`, lane, kind, box, stop_path: abs, reason, by, stopped_at: stoppedAt,
    lane_issue: laneIssue, evidence, pages_waiting: pagesWaiting,
    pages_waiting_at: pagesWaiting != null ? (o.pagesWaitingAt ?? now.toISOString()) : null,
    release_command: o.releaseCommand ?? `rm ${abs}`, ticket: null, registered_at: now.toISOString(),
    last_paged_at: null, released_at: null,
  };
  const title = `${issueTitlePrefix(lane)} ${reason}`.slice(0, 200);
  const body = issueBody({ ...row, registry: registryPath });

  // 2. ticket: reuse the lane's open one (comment the new STOP there) or open one.
  let ticket = null;
  if (dryRun) actions.push(`would open or reuse "${issueTitlePrefix(lane)} …" labelled lane-stop${kind === 'containment' ? ' + contained' : ''}`);
  else {
    try {
      ticket = findTicket(lane, gh);
      if (ticket) {
        const r = gh(['issue', 'comment', String(ticket.number), '--repo', REPO, '--body-file', '-'], `**STOP written again** — ${reason}\n\n${body}`);
        actions.push(r.status === 0 ? `commented on #${ticket.number}` : `comment on #${ticket.number} FAILED: ${r.stderr.slice(0, 200)}`);
        // Not `gh issue edit`: it fails on the Projects-classic deprecation (gh-pr-edit-projects-classic).
        if (kind === 'containment') gh(['api', `repos/${REPO}/issues/${ticket.number}/labels`, '-f', 'labels[]=contained']);
      } else {
        ensureLabel(gh);
        const labels = kind === 'containment' ? 'lane-stop,contained' : 'lane-stop';
        const r = gh(['issue', 'create', '--repo', REPO, '--title', title, '--label', labels, '--body-file', '-'], body);
        if (r.status !== 0) throw new Error(`gh issue create failed: ${r.stderr.slice(0, 200)}`);
        const url = r.stdout.split('\n').pop();
        ticket = { number: Number(url.match(/\/issues\/(\d+)/)?.[1]) || null, url, title };
        actions.push(`opened ${url}`);
      }
    } catch (e) { actions.push(`ticket FAILED: ${e.message}`); }
  }
  row.ticket = ticket ? { number: ticket.number, url: ticket.url } : null;

  // 3. the lane's own issue.
  let laneComment = null;
  if (laneIssue && commentLaneIssue) {
    laneComment = `**Lane stopped** (\`${abs}\` on \`${box}\`): ${reason}\n\nTicket: ${ticket?.url ?? '(dry run)'} — paged daily until released. Release: \`${row.release_command}\``;
    if (dryRun) actions.push(`would comment on #${laneIssue}`);
    else {
      const r = gh(['issue', 'comment', String(laneIssue), '--repo', REPO, '--body-file', '-'], laneComment);
      actions.push(r.status === 0 ? `commented on #${laneIssue}` : `comment on #${laneIssue} FAILED: ${r.stderr.slice(0, 200)}`);
    }
  }

  // 4. registry (upsert by box + path; an earlier released row for the same path is replaced).
  if (dryRun) actions.push(`would upsert ${row.id} in ${registryPath}`);
  else {
    const reg = readRegistry(registryPath);
    reg.stops = [...(reg.stops || []).filter((r) => r.id !== row.id), row];
    writeRegistry(reg, registryPath);
    actions.push(`registered ${row.id} in ${registryPath}`);
  }
  return { row, title, body, ticket, laneComment, actions };
}

/**
 * Daily: page once per standing STOP per UTC day; mark a row released when its file is gone (one comment on
 * its ticket; the ticket stays open: a `contained` repair is still owed). Returns { pages, released, actions }.
 */
export async function checkStops({ registryPath = REGISTRY_PATH, dryRun = false, now = new Date(), send = ntfyPost, gh = ghCli, box = os.hostname() } = {}) {
  const reg = readRegistry(registryPath);
  const pages = [], released = [], actions = [];
  const today = now.toISOString().slice(0, 10);
  for (const row of standing(reg)) {
    if (row.box && row.box !== box) continue; // another box's row: its own checker owns it
    if (!fs.existsSync(row.stop_path)) {
      released.push(row.id);
      if (dryRun) { actions.push(`would mark ${row.id} released`); continue; }
      row.released_at = now.toISOString();
      if (row.ticket?.number) {
        const r = gh(['issue', 'comment', String(row.ticket.number), '--repo', REPO, '--body-file', '-'],
          `STOP removed: \`${row.stop_path}\` on \`${row.box}\` is gone (seen ${row.released_at}); the daily page stops. Close this ticket when the repair it names is done.`);
        actions.push(r.status === 0 ? `released ${row.id}; commented on #${row.ticket.number}` : `released ${row.id}; comment FAILED`);
      } else actions.push(`released ${row.id}`);
      continue;
    }
    if (String(row.last_paged_at || '').slice(0, 10) === today) continue;
    const p = pagePayload(row, now);
    pages.push(p);
    if (dryRun) { actions.push(`would page: ${p.headers.Title}`); continue; }
    try {
      const res = await send(p.url, { method: 'POST', headers: p.headers, body: p.body });
      if (res && res.ok === false) throw new Error(`ntfy ${res.status}`);
      row.last_paged_at = now.toISOString();
      actions.push(`paged: ${p.headers.Title}`);
    } catch (e) { actions.push(`page FAILED for ${row.id}: ${e.message}`); }
  }
  if (!dryRun) writeRegistry(reg, registryPath);
  return { pages, released, actions };
}
