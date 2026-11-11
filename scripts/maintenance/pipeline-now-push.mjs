#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/work-board-push.mjs — the pattern copied (each box upserts one ops_reports document,
// an admin page renders it, no deploy to refresh; redact() reused). It reports headless Claude JOBS, not the cron
// lanes that OCR and translate books. .claude/docs/pipeline.md / pipeline-phases.md — hand-written, and stale within
// weeks (#7759). scripts/batch/siku-translate-lane.mjs `pools` — the agy pool reader, reused via scripts/lib/agy-pools.mjs.
/**
 * pipeline-now push (/admin/pipeline, #7759): what is translating, OCRing and enriching books RIGHT NOW, read from
 * live state, so nobody has to keep a pipeline doc in step by hand.
 *
 *   --box <name>   on EACH box (main/hetzner, cloudlayer, l7a, gex45), hourly from cron. Reads the box's own live
 *                  crontab and keeps the lines that run a pipeline stage (OCR, translate, enrich, embed, import,
 *                  QC, orchestrator): schedule, script, stage, flags, trailing comment, and the age and last line of
 *                  the log it appends to. Plus every agy pool on the box (`agy -p /quota`, 0 tokens), lane STOP
 *                  files, and the GPU queue (gex45). Upserts {_id:'pipeline-now:<box>', type:'pipeline-now'}.
 *   --corpus       on main only, nightly. Pages translated and OCR'd per day by lane × model (last 7 days, from the
 *                  indexed translation.updated_at / ocr.updated_at), the spend dial (system_config processing_control),
 *                  the last quality gates. Upserts {_id:'pipeline-now:corpus'}.
 *                  Also per-day hand-off counts (GPU drafts, agy corrections, translated and completed books, first-
 *                  translation searches and ingests) and `stalls` (#8482 part C, scripts/lib/hand-off-stalls.mjs): ntfy
 *                  high priority once a day per edge when a stage hands 0 for 24 h after its feeder produced.
 *   --red-ntfy     on main, Mondays: one ntfy line to sourcelibrary-uptime naming every red line across the boxes
 *                  (#8283), read from the box documents. Nothing when no line is red.
 *   --dry-run      print the document (or the ntfy line), write nothing.
 *
 * RED LINES (#8283): each live line is judged against the cron-row registry (scripts/lib/lanes.mjs CRON_ROWS,
 * judgeCronLine): UNREGISTERED, RETIRED BUT LIVE, PAST REVIEW, IDLE 7 DAYS (from the corpus document's pages per
 * stamp), MATCHES A RETIRED PATTERN. The verdicts ride on the line as `red`; the page shows them at the top.
 *
 * The boxes cannot ssh to each other, so each writes its own section and main's page assembles them. Claude account
 * headroom is not collected here: the page reads ops_reports `claude-limits:latest`, which main already pushes.
 * Privacy: env VALUES never leave the box (only names of a short allowlist), every string goes through redact().
 * Nothing but the admin page reads these documents, so a write here actuates nothing.
 *
 *   node --env-file=.env.production.local scripts/maintenance/pipeline-now-push.mjs --box hetzner
 *   node --env-file=.env.production.local scripts/maintenance/pipeline-now-push.mjs --corpus
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redact } from './work-board-push.mjs';
import { cronRowFor, judgeCronLine, judgeStops, STOP_ROWS } from '../lib/lanes.mjs';
import { windowOf, ocrStageWindows, GPU_DRAFT_LANE_RE, ARMC_LANE, evaluateStalls, edgesToPage, recordPaged, pageText, WINDOW_HOURS } from '../lib/hand-off-stalls.mjs';

export const COLLECTION = 'ops_reports';
export const TYPE = 'pipeline-now';
export const CORPUS_DAYS = 7;
export const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';

// ───────────────────────────────────────────── pure helpers (unit-tested)

/**
 * Stage of a cron command, from the script it runs. First match wins, so the more specific rules come first
 * (a QC script whose name mentions translation is QC, not translation).
 */
export const STAGE_RULES = Object.freeze([
  ['qc', /scripts\/(?:audit|eval)\/|withhold-stale|mark-stale|health-alert|pipeline-health|lane-judge|tca-|translation-corpus-audit/],
  ['orchestrator', /pipeline-orchestrator|daily-pipeline-report|workers\/scheduler\.mjs/],
  ['embed', /embed/],
  ['research', /ft-search|first-translation/],
  ['translate', /translat|siku-|reader-request-lane/],
  ['ocr', /ocr|paddle|kraken|lighton|mineru|refused-pages|gpu-queue|gpu\/|pre-ocr/],
  ['enrich', /enrich|geocode|thesaurus|hires-gallery|printed-page|extract-images|image-embed/],
  ['import', /acquire|import\/|archive-lanes|catalog-coverage/],
]);
export const STAGES = Object.freeze([...STAGE_RULES.map(([s]) => s)]);

const SCRIPT_RE = /(?:^|[\s=])((?:\/[\w.-]+)*\/?scripts\/[\w./-]+\.(?:mjs|js|ts|sh|py)|\/root\/bin\/[\w.-]+)/g;
/** A script path as shown: repo-relative when it lives in the checkout. */
const shortScript = (p) => p.replace(/^.*?\/(scripts\/)/, '$1');

/**
 * The scripts a command runs, the EXECUTED one first: a path right after node/bash/sh/python3 (or their flags) beats
 * one that only appears in an existence guard (`[ -f scripts/lib/x.mjs ] && … node scripts/workers/y.mjs`).
 */
export function scriptsOf(cmd) {
  const all = [...cmd.matchAll(SCRIPT_RE)].map(m => ({ path: m[1], at: m.index }));
  const run = (a) => /(?:node|bash|sh|python3?|tsx)(?:\s+-{1,2}[\w=./-]+)*\s+$/.test(cmd.slice(Math.max(0, a.at - 120), a.at + 1));
  const ordered = [...all.filter(run), ...all.filter(a => !run(a))];
  return [...new Set(ordered.map(a => shortScript(a.path)))];
}

/** Stage of the executed script; a guard-only script decides only when the executed one matches no rule. */
export function stageOf(cmd) {
  const scripts = scriptsOf(cmd);
  for (const target of scripts.length ? scripts : [cmd]) {
    for (const [stage, re] of STAGE_RULES) if (re.test(target)) return stage;
  }
  return null;
}

/** Env names worth showing (values are never stored). */
export const ENV_NAMES = Object.freeze(['AGY_HOME', 'AGY_POOL_SHARED', 'AGY_ALLOW_HEAVY', 'OCR_LITE_ONLY', 'CANDIDATE_READS', 'STEWARD']);

/** `--flag` / `--flag=value` arguments and allowlisted env assignments ("AGY_HOME=/root/.agy-james"). */
export function flagsOf(cmd) {
  // `--flag=value`, or `--flag value` when the next word is a plain value (not another flag, a redirect or a pipe).
  const flags = [...new Set([...cmd.matchAll(/(?:^|\s)(--[a-z][\w-]*)(?:=([^\s"';|&>]+)|\s+(?![-<>|&;$])([\w.,:%+-]{1,40})(?=[\s"']|$))?/g)]
    .map(m => (m[2] ?? m[3]) !== undefined ? `${m[1]}=${m[2] ?? m[3]}` : m[1]))]
    .filter(f => !/^--(?:env-file|no-warnings|import)\b/.test(f));
  const env = [];
  for (const n of ENV_NAMES) {
    const m = cmd.match(new RegExp(`(?:^|[\\s;])${n}=([^\\s;"']+)`));
    if (m) env.push(`${n}=${m[1]}`);
  }
  return { flags: flags.slice(0, 12).map(f => redact(f, 80)), env: env.map(e => redact(e, 80)) };
}

/** The file a cron line appends its output to (the last `>> file`), or null. */
export function logPathOf(cmd) {
  const all = [...cmd.matchAll(/>>\s*([^\s;|&]+)/g)].map(m => m[1]);
  return all.length ? all[all.length - 1] : null;
}

/** The trailing `# comment` of a cron line (outside quotes), or ''. */
export function trailingComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && /\s/.test(line[i - 1] ?? '')) return line.slice(i + 1).trim();
  }
  return '';
}

const CRON_FIELDS_RE = /^(?:[\d*\/,-]+\s+){4}[\d*\/,-]+\s+\S/;

/**
 * Parse crontab text into job lines: { schedule, cmd, comment, disabled, tag }. Env lines (FOO=bar) and prose
 * comments are skipped; a COMMENTED-OUT job line ("#OCRFIRST-7701 50 * * * * …") is kept with disabled: true and its
 * tag, because a lane switched off is part of the picture.
 */
export function parseCrontab(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    let line = raw.trim();
    let disabled = false, tag = null;
    if (line.startsWith('#')) {
      const m = line.match(/^#+\s*([A-Za-z][\w.-]*:?)?\s*(.*)$/);
      const rest = m?.[2] ?? '';
      if (!CRON_FIELDS_RE.test(rest)) continue;
      disabled = true; tag = m[1] ? m[1].replace(/:$/, '') : null; line = rest;
    }
    if (!line) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    let schedule, cmd;
    const at = line.match(/^(@\w+)\s+(.*)$/);
    if (at) { schedule = at[1]; cmd = at[2]; }
    else {
      if (!CRON_FIELDS_RE.test(line)) continue;
      schedule = line.split(/\s+/).slice(0, 5).join(' ');
      cmd = line.replace(/^(\S+\s+){5}/, '');
    }
    out.push({ schedule, cmd, comment: trailingComment(cmd), disabled, tag });
  }
  return out;
}

/** The subcommand a lane script is run with (`cli-ocr-lane.mjs correct …` → "correct"), or null. */
export function modeOf(cmd, script) {
  const name = script ? script.split('/').pop().replace(/[.$^*+?()[\]{}|\\]/g, '\\$&') : null;
  const re = new RegExp(`(?:${name ? `${name}|` : ''}\\$f)["']?\\s+([a-z][\\w-]*)(?=\\s|$|["'])`);
  const m = cmd.match(re);
  return m ? m[1] : null;
}

/**
 * A one-shot line (day-of-month AND month fixed, e.g. "5 22 30 10 *") — a scheduled edit, not a lane.
 * Shown apart so a dated sed does not read as a running stage.
 */
export function isOneShot(schedule) {
  const p = schedule.split(/\s+/);
  return p.length === 5 && /^\d+$/.test(p[2]) && /^\d+$/.test(p[3]);
}

/**
 * The pipeline lanes in a crontab: one row per job line whose script runs a stage. With `box`, each row also carries
 * its registry row id (`registry`, null when unregistered) and its red verdicts (`red`, judgeCronLine, #8283); the
 * raw command is judged here and never stored.
 */
export function pipelineLines(text, { box = null, now = new Date(), laneTotals = null } = {}) {
  const rows = [];
  for (const { schedule, cmd, comment, disabled, tag } of parseCrontab(text)) {
    const stage = stageOf(cmd);
    if (!stage) continue;
    const scripts = scriptsOf(cmd);
    const row = {
      stage, schedule, one_shot: isOneShot(schedule), disabled, disabled_tag: tag,
      script: scripts[0] ?? null, scripts: scripts.slice(0, 4), mode: modeOf(cmd, scripts[0]),
      ...flagsOf(cmd), log: logPathOf(cmd), comment: redact(comment, 200),
    };
    if (box) {
      const line = { cmd, stage, script: row.script, mode: row.mode, disabled, one_shot: row.one_shot };
      const reg = cronRowFor(box, line);
      Object.assign(row, {
        registry: reg ? { id: reg.id, status: reg.status, issue: reg.issue ?? null, route: reg.route ?? null, review_by: reg.review_by ?? null, open: reg.open ?? null } : null,
        red: judgeCronLine(box, line, { now, laneTotals }),
      });
    }
    rows.push(row);
  }
  return rows.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || String(a.script).localeCompare(String(b.script)));
}

/** Last informative line of a text tail (a bare "done in 997ms" footer says nothing about what ran). */
export function lastLine(tail) {
  const lines = String(tail).split('\n').map(l => l.trim()).filter(l => l && !/^(?:\[[\w-]+\]\s*)?done in [\d.]+\s*m?s$/i.test(l));
  return lines.length ? lines[lines.length - 1] : '';
}

// ───────────────────────────────────────────── live readers (box)

function tailOf(file, bytes = 4096) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function mtimeIso(file) {
  try { return fs.statSync(file).mtime.toISOString(); } catch { return null; }
}

function liveCrontab() {
  try { return execFileSync('crontab', ['-l'], { encoding: 'utf8', timeout: 10_000 }); } catch { return ''; }
}

function hasCmd(name) {
  return spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).status === 0;
}

/** Lane state dirs with a STOP switch. Add a lane here when it gets one. */
export const LANE_STATE_DIRS = Object.freeze([
  { lane: 'siku-translate (#5600)', dir: '/mnt/HC_Volume_105839809/siku-lane-5600' },
]);

function laneStates() {
  const out = [];
  for (const { lane, dir } of LANE_STATE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const row = { lane, stopped: fs.existsSync(path.join(dir, 'STOP')), state_at: mtimeIso(path.join(dir, 'state.json')) };
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      const w = Array.isArray(s.waves) ? s.waves[s.waves.length - 1] : null;
      Object.assign(row, {
        written_total: s.written_total ?? null, spot_at: s.spot_at ?? null,
        last_wave: w ? { id: w.id, pool: w.pool, written: w.written ?? null, stopped: w.stopped ? redact(String(w.stopped), 120) : null, finished_at: w.finished_at ?? null } : null,
      });
    } catch { /* no state yet */ }
    out.push(row);
  }
  return out;
}

function gpuQueue() {
  const q = '/root/gpu-queue';
  if (!fs.existsSync(q)) return null;
  const ls = (d) => { try { return fs.readdirSync(path.join(q, d)).filter(f => !f.startsWith('.')).sort(); } catch { return []; } };
  const pending = ls('pending');
  const lock = fs.existsSync('/root/gpu.lock') ? redact(tailOf('/root/gpu.lock', 300).trim(), 120) || 'held' : null;
  return { pending: pending.length, next: pending.slice(0, 5), held: ls('held').length, lock };
}

async function agyPools() {
  if (!hasCmd('agy')) return null;
  const { readPools, poolName } = await import('../lib/agy-pools.mjs');
  return readPools({ model: 'gemini-3.8-flash-low' }).map(p => ({
    pool: poolName(p),
    busy: Boolean(p.busy),
    weekly: p.reading?.weekly ?? null, weekly_reset: p.reading?.weeklyReset ?? null,
    five_hour: p.reading?.fiveHour ?? null, five_hour_reset: p.reading?.fiveHourReset ?? null,
    claude: p.reading?.claude ?? null,
  }));
}

/**
 * The pools, also left on the box for the laptop's menu bar (~/tools/claude-limits reads it over ssh): one file, no
 * second /quota call. Atomic, so a reader never sees half a file.
 */
export const POOLS_FILE = '/root/agy-quota/pools.json';
function writePoolsFile(doc, file = POOLS_FILE) {
  if (!doc.agy_pools) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ box: doc.box, generated_at: doc.generated_at, pools: doc.agy_pools }, null, 1));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* the admin page still has the reading */ }
}

/** Pages per stamp (lane, else source) over the corpus document's window, both fields summed; null without it. */
export function laneTotalsOf(corpus) {
  if (!corpus?.translated_per_day && !corpus?.ocr_per_day) return null;
  const t = {};
  for (const r of [...(corpus.translated_per_day ?? []), ...(corpus.ocr_per_day ?? [])]) t[r.lane] = (t[r.lane] ?? 0) + r.pages;
  return t;
}

/** The red lines of every box document, for the weekly ntfy: "box: script mode (FLAG, FLAG)". */
export function redSummary(docs) {
  const out = [];
  for (const d of docs) for (const l of d.lines ?? []) {
    if (!l.red?.length) continue;
    const name = `${l.script?.split('/').pop() ?? '(inline)'}${l.mode ? ` ${l.mode}` : ''}`;
    out.push(`${d.box}: ${name} (${[...new Set(l.red.map(r => r.flag))].join(', ')})`);
  }
  return [...new Set(out)];
}

export async function collectBox({ box, now = new Date(), laneTotals = null }) {
  const lines = pipelineLines(liveCrontab(), { box, now, laneTotals }).map(r => ({
    ...r,
    log_at: r.log ? mtimeIso(r.log) : null,
    log_last: r.log ? redact(lastLine(tailOf(r.log)), 200) : null,
  }));
  return {
    _id: `${TYPE}:${box}`, type: TYPE, box, host: os.hostname(), generated_at: now.toISOString(),
    lines, lanes: laneStates(), gpu_queue: gpuQueue(), agy_pools: await agyPools(),
    stops: collectBoxStops(box, now),
  };
}

// ───────────────────────────────────────────── stops (#8283, Phase 1 item 1 of #5302): discovery is read-only

/**
 * Where a lane or job parks a STOP* file. Explicit and small on purpose: a filesystem-wide find would also report
 * every STOP that is a program's own state. Add a root when a lane gets a STOP switch. `*` is one path segment.
 */
export const STOP_GLOBS = Object.freeze([
  '/mnt/HC_Volume_105839809/*/STOP*',
  '/root/*/STOP*',
  '/root/ft-batches/*/STOP*',
  '/root/gpu-backlog-*/*/STOP*',
]);
export const ROUTES_TSV = '/root/bin/ocr-filler-routes.tsv';

/** Expand a glob whose only wildcard is `*` within a segment. `fsApi` is injectable for tests. */
export function expandGlob(pattern, fsApi = fs) {
  let paths = ['/'];
  for (const seg of pattern.split('/').filter(Boolean)) {
    const next = [];
    for (const base of paths) {
      if (!seg.includes('*')) { next.push(path.join(base, seg)); continue; }
      const re = new RegExp(`^${seg.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      let names = [];
      try { names = fsApi.readdirSync(base); } catch { /* unreadable root: nothing there */ }
      for (const n of names) if (re.test(n)) next.push(path.join(base, n));
    }
    paths = next;
  }
  return paths.filter((p) => { try { return fsApi.statSync(p).isFile(); } catch { return false; } });
}

/** The STOP files that exist under STOP_GLOBS, deduplicated by real path (a symlinked job dir is one stop). */
export function discoverStopFiles(box, { globs = STOP_GLOBS, fsApi = fs } = {}) {
  const seen = new Map();
  for (const g of globs) for (const p of expandGlob(g, fsApi)) {
    let real = p;
    try { real = fsApi.realpathSync(p); } catch { /* keep the given path */ }
    if (seen.has(real)) continue;
    let detail = '', at = null;
    try {
      detail = redact(String(fsApi.readFileSync(real, 'utf8')).trim().split('\n')[0] ?? '', 140);
      at = fsApi.statSync(real).mtime.toISOString().slice(0, 10);
    } catch { /* unreadable: keep the path */ }
    seen.set(real, { kind: 'stop-file', box, key: p, detail: detail || '(empty file)', set_at: at, scope: null });
  }
  return [...seen.values()];
}

/** Routes switched off in ocr-filler-routes.tsv: a first column of `off` or `-`. Comment lines are not routes. */
export function parseRoutesOff(text, box) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [on, route, kind, issue] = line.split('\t');
    if (!route || !['off', '-'].includes(on.trim())) continue;
    out.push({ kind: 'route-off', box, key: route.trim(), detail: `${kind ?? 'route'} · issue ${issue ?? '?'}`, set_at: null, scope: null });
  }
  return out;
}

/** The directory a stop-file row lives in (up to the first `*`), to tell "stop gone" from "volume not mounted". */
const rowRoot = (r) => (r.match.path ? r.match.path.split('*')[0].replace(/\/[^/]*$/, '') : null);

/** Rows this box can judge STALE: stop-file rows whose directory is readable, route-off rows when the tsv was read. */
export function readableRows(rows, { fsApi = fs, routesRead = false } = {}) {
  return rows.filter((r) => (r.kind === 'stop-file' ? !!rowRoot(r) && fsApi.existsSync(rowRoot(r)) : r.kind === 'route-off' && routesRead));
}

/** Hold reasons from the newest pipeline_next_daily report's `held` array, one per reason (books and pages summed). */
export function holdStops(report) {
  const by = new Map();
  for (const h of report?.held ?? []) {
    const e = by.get(h.reason) ?? { kind: 'hold-reason', box: 'corpus', key: h.reason, detail: `issue ${h.issue ?? 'none'}`, set_at: null, scope: { books: 0, pages: 0 } };
    e.scope.books += h.all?.books ?? 0;
    e.scope.pages += h.all?.pages ?? 0;
    by.set(h.reason, e);
  }
  return [...by.values()];
}

/** Quality gates whose verdict is NO-GO. */
export const noGoGates = (gates) => (gates ?? []).filter((g) => (g.verdict ?? g.decision) === 'NO-GO')
  .map((g) => {
    const id = g.id ?? String(g._id);
    const at = g.created_at ?? g.at ?? gateTime(id);
    const books = g.window?.books ?? g.books ?? null;
    return { kind: 'quality-gate', box: 'corpus', key: id, detail: `${g.step ?? '?'} step`, set_at: at ? String(at instanceof Date ? at.toISOString() : at).slice(0, 10) : null, scope: books != null ? { books, pages: null } : null };
  });

/** Stops of one box, judged. Reads only; a box without the tsv or the mounted volume does not call its rows stale. */
export function collectBoxStops(box, now = new Date()) {
  let routes = [], routesRead = false;
  try { routes = parseRoutesOff(fs.readFileSync(ROUTES_TSV, 'utf8'), box); routesRead = true; } catch { /* not a GPU box */ }
  const found = [...discoverStopFiles(box), ...routes];
  return judgeStops(found, { box, judged: ['stop-file', 'route-off'], now, rows: readableRows(STOP_ROWS, { routesRead }) });
}

/** Corpus stops: every hold reason and NO-GO gate. A source that could not be read judges nothing (unknown, not clear). */
export function collectCorpusStops(report, gates, now = new Date()) {
  const judged = [];
  if (report) judged.push('hold-reason');
  if (gates) judged.push('quality-gate');
  return judgeStops([...(report ? holdStops(report) : []), ...(gates ? noGoGates(gates) : [])], { box: 'corpus', judged, now });
}

/** Flagged stops across docs, unowned first, for the digest line. */
export function flaggedStops(docs) {
  const all = [];
  for (const d of docs) for (const s of d.stops ?? []) if (s.flags?.length) all.push({ ...s, doc: d.box });
  const rank = (s) => (s.flags.some((f) => f.flag === 'NO OWNER') ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b));
}

// ───────────────────────────────────────────── corpus (main)

/** Pages written per UTC day × lane × model since `since`, on one text field ('translation' | 'ocr'). */
async function perDay(db, field, since) {
  const rows = await db.collection('pages').aggregate([
    { $match: { [`${field}.updated_at`]: { $gte: since } } },
    { $group: {
      _id: {
        day: { $dateToString: { format: '%Y-%m-%d', date: `$${field}.updated_at` } },
        lane: { $ifNull: [`$${field}.lane`, { $ifNull: [`$${field}.source`, 'unlabelled'] }] },
        model: { $ifNull: [`$${field}.model`, 'unknown'] },
      },
      pages: { $sum: 1 },
    } },
  ], { hint: { [`${field}.updated_at`]: -1 }, maxTimeMS: 300_000, allowDiskUse: true }).toArray();
  return rows.map(r => ({ day: r._id.day, lane: String(r._id.lane), model: String(r._id.model), pages: r.pages }))
    .sort((a, b) => a.day.localeCompare(b.day) || b.pages - a.pages);
}

/** qg_translate_202610101657_… → 2026-10-10T16:57Z (gate documents carry no created_at). */
export function gateTime(id) {
  const m = String(id ?? '').match(/_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z` : null;
}


// ───────────────────────────────────────────── hand-off counts (#8482 part C)

const HOUR = 36e5;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * OCR pages per lane per window (last 24 h, the 72 h before), on the indexed ocr.updated_at, hinted like perDay.
 * The armc lane (agy-flash-ocr) also writes first reads, so a zero there is a stall but a non-zero does not prove
 * the GPU drafts are being picked up (a false negative, never a false alarm).
 */
async function ocrWindows(db, now) {
  const since = new Date(now.getTime() - (WINDOW_HOURS.last24h + WINDOW_HOURS.prev72h) * HOUR);
  const cut = new Date(now.getTime() - WINDOW_HOURS.last24h * HOUR);
  const rows = await db.collection('pages').aggregate([
    { $match: { 'ocr.updated_at': { $gte: since } } },
    { $group: { _id: { lane: { $ifNull: ['$ocr.lane', { $ifNull: ['$ocr.source', 'unlabelled'] }] }, w: { $cond: [{ $gt: ['$ocr.updated_at', cut] }, 'last24h', 'prev72h'] } }, pages: { $sum: 1 } } },
  ], { hint: { 'ocr.updated_at': -1 }, maxTimeMS: 300_000, allowDiskUse: true }).toArray();
  return rows.map(r => ({ lane: String(r._id.lane), window: r._id.w, pages: r.pages }));
}

/**
 * Books per day reaching pipeline_auto.status translate_complete / complete, on the indexed
 * {pipeline_auto.status, pipeline_auto.last_updated}. PROXY: `books.summary.generated_at` / `index.generatedAt` are
 * unindexed (a full books scan, 72 s on 587K docs, measured 2026-11-10), so enrichment is read as the book reaching
 * `complete`, which also counts books completed without enrichment. A book enriched on the side (a held book,
 * #8482 stall 3) does not move pipeline_auto and is not counted.
 */
async function bookStatusPerDay(db, since, now) {
  const cut = new Date(now.getTime() - WINDOW_HOURS.last24h * HOUR);
  const cut96 = new Date(now.getTime() - (WINDOW_HOURS.last24h + WINDOW_HOURS.prev72h) * HOUR);
  const rows = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $in: ['translate_complete', 'complete'] }, 'pipeline_auto.last_updated': { $gte: since } } },
    { $group: { _id: { s: '$pipeline_auto.status', d: { $dateToString: { format: '%Y-%m-%d', date: '$pipeline_auto.last_updated' } }, w: { $cond: [{ $gt: ['$pipeline_auto.last_updated', cut] }, 'last24h', { $cond: [{ $gt: ['$pipeline_auto.last_updated', cut96] }, 'prev72h', 'older'] }] } }, n: { $sum: 1 } } },
  ], { hint: { 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1 }, maxTimeMS: 120_000 }).toArray();
  return rows.map(r => ({ status: r._id.s, day: r._id.d, window: r._id.w, books: r.n }));
}

/**
 * first_translation_attempts rows from the last `days`, via the only index (_id; an ObjectId carries its insert time).
 * ingest = the insert day, search = the row's own `date` (when the search ran). A row exists only once ingested, so
 * a search never ingested is invisible here: this edge catches an ingest that stops while searches still land late,
 * not a runner killed before it ever wrote (that needs the batch directory on the box; out of scope).
 */
async function ftAttempts(db, now, days) {
  const { ObjectId } = await import('mongodb');
  const from = ObjectId.createFromTime(Math.floor((now.getTime() - days * 24 * HOUR) / 1000));
  const rows = await db.collection('first_translation_attempts').find({ _id: { $gte: from } }, { projection: { date: 1 } }).toArray();
  return rows.map(r => ({ ingested: r._id.getTimestamp(), searched: r.date ? new Date(r.date) : null }));
}

/** Per-day counts of every hand-off stage for the last CORPUS_DAYS, and the stage window totals. Pure given its rows. */
export function handoffCounts({ ocrRows, ocrWin, bookRows, ft, translatedRows, now }) {
  const days = [];
  for (let i = CORPUS_DAYS - 1; i >= 0; i--) days.push(dayOf(now.getTime() - i * 24 * HOUR));
  const per = Object.fromEntries(days.map(d => [d, { day: d, gpu_draft: 0, armc_correct: 0, translated_pages: 0, translate_books: 0, enrich_books: 0, ft_search: 0, ft_ingest: 0 }]));
  for (const r of ocrRows ?? []) {
    const p = per[r.day]; if (!p) continue;
    if (GPU_DRAFT_LANE_RE.test(r.lane)) p.gpu_draft += r.pages; else if (r.lane === ARMC_LANE) p.armc_correct += r.pages;
  }
  for (const r of translatedRows ?? []) if (per[r.day]) per[r.day].translated_pages += r.pages;
  const win = { translate: { last24h: 0, prev72h: 0 }, enrich: { last24h: 0, prev72h: 0 }, ft_search: { last24h: 0, prev72h: 0 }, ft_ingest: { last24h: 0, prev72h: 0 } };
  for (const r of bookRows ?? []) {
    const stage = r.status === 'complete' ? 'enrich' : 'translate';
    if (per[r.day]) per[r.day][`${stage}_books`] += r.books;
    if (r.window in win[stage]) win[stage][r.window] += r.books;
  }
  for (const r of ft ?? []) {
    const searched = r.searched && !isNaN(r.searched) ? r.searched : null;
    if (per[dayOf(r.ingested)]) per[dayOf(r.ingested)].ft_ingest++;
    if (searched && per[dayOf(searched)]) per[dayOf(searched)].ft_search++;
    const wi = windowOf(r.ingested, now); if (wi) win.ft_ingest[wi]++;
    const ws = searched ? windowOf(searched, now) : null; if (ws) win.ft_search[ws]++;
  }
  return { per_day: days.map(d => per[d]), windows: { ...ocrStageWindows(ocrWin), ...win } };
}

export async function collectCorpus(db, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (CORPUS_DAYS - 1)));
  const dial = await db.collection('system_config').findOne({ _id: 'processing_control' }, { projection: { paused: 1, daily_budget_usd: 1, updated_at: 1 } });
  const gates = await db.collection('quality_gates').find({}, { projection: { id: 1, step: 1, verdict: 1, decision: 1, created_at: 1, 'window.label': 1, 'window.books': 1 } })
    .sort({ _id: -1 }).limit(3).toArray();
  const errors = [];
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${redact(e.message, 160)}`); return null; } };
  const translatedPerDay = await safe('translation', () => perDay(db, 'translation', since));
  const ocrPerDay = await safe('ocr', () => perDay(db, 'ocr', since));
  const ocrWin = await safe('ocr windows', () => ocrWindows(db, now));
  const bookRows = await safe('books by status', () => bookStatusPerDay(db, since, now));
  const ft = await safe('first_translation_attempts', () => ftAttempts(db, now, 14));
  const counts = handoffCounts({ ocrRows: ocrPerDay, ocrWin, bookRows, ft, translatedRows: translatedPerDay, now });
  // An unread side is UNKNOWN, never zero: drop a stage whose query failed so its edge cannot raise a false stall.
  const dropStages = (cond, ...stages) => { if (cond) for (const st of stages) delete counts.windows[st]; };
  dropStages(!ocrWin, 'gpu_draft', 'armc_correct');
  dropStages(!bookRows, 'translate', 'enrich');
  dropStages(!ft, 'ft_search', 'ft_ingest');
  // Holds: reuse the newest daily report's `held` array (reason, issue, books, pages); no book rescan.
  const nextReport = await safe('pipeline_next_daily', () => db.collection('ops_reports').find({ type: 'pipeline_next_daily' }, { projection: { held: 1 } }).sort({ _id: -1 }).limit(1).next());
  const stops = collectCorpusStops(nextReport?.held ? nextReport : null, gates, now);
  const previous = (await db.collection(COLLECTION).findOne({ _id: `${TYPE}:corpus` }, { projection: { stalls: 1 } }).catch(() => null))?.stalls ?? [];
  const stalls = recordPaged(evaluateStalls(counts.windows), previous, [], now);
  return {
    _id: `${TYPE}:corpus`, type: TYPE, box: 'corpus', generated_at: now.toISOString(), since: since.toISOString(),
    dial: dial ? { paused: dial.paused ?? null, daily_budget_usd: dial.daily_budget_usd ?? null } : null,
    quality_gates: gates.map(g => ({ id: g.id ?? String(g._id), step: g.step ?? null, verdict: g.verdict ?? g.decision ?? null, window: g.window?.label ?? null, books: g.window?.books ?? null, at: g.created_at ?? gateTime(g.id) })),
    translated_per_day: translatedPerDay,
    ocr_per_day: ocrPerDay,
    handoffs_per_day: counts?.per_day ?? null,
    handoff_windows: counts?.windows ?? null,
    stalls,
    stops,
    errors,
  };
}

/**
 * Page ntfy (high priority, one message) for stalled edges not paged in the last 24 h, then record last_paged_at on
 * the document. The record is written only if ntfy answered 2xx, so a failed page is tried again tomorrow's run.
 */
async function pageStalls(doc, now = new Date()) {
  const due = edgesToPage(doc.stalls, doc.stalls, now);
  if (!due.length) return;
  try {
    const res = await fetch(NTFY_TOPIC, { method: 'POST', body: pageText(due), headers: { Title: 'Pipeline: hand-off stalled', Priority: 'high', Tags: 'rotating_light' } });
    console.log(`${now.toISOString()} ntfy ${res.status}: ${due.map(d => d.edge).join(', ')}`);
    if (res.ok) doc.stalls = recordPaged(doc.stalls, doc.stalls, due, now);
  } catch (e) { doc.errors.push(`ntfy: ${redact(e.message, 120)}`); }
}

// ───────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = argv.includes('--dry-run');
  const corpus = argv.includes('--corpus');
  const redNtfy = argv.includes('--red-ntfy');
  const box = arg('--box');
  if (!corpus && !box && !redNtfy) { console.error('usage: pipeline-now-push.mjs --box <name> | --corpus | --red-ntfy [--dry-run]'); process.exit(2); }

  const needDb = corpus || redNtfy || !dry;
  let client = null, db = null;
  if (needDb) {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'bookstore');
  }
  try {
    if (redNtfy) {
      const docs = await db.collection(COLLECTION).find({ type: TYPE, box: { $ne: 'corpus' } }).toArray();
      const red = redSummary(docs);
      if (!red.length) { console.log(`${new Date().toISOString()} no red lines on ${docs.length} boxes`); return; }
      const body = `${red.length} red cron line${red.length === 1 ? '' : 's'}: ${red.join('; ')}. /admin/pipeline/now (#8283)`;
      if (dry) { console.log(body); return; }
      const res = await fetch(NTFY_TOPIC, { method: 'POST', body, headers: { Title: 'Pipeline: red cron lines', Tags: 'warning' } });
      console.log(`${new Date().toISOString()} ntfy ${res.status}: ${body}`);
      return;
    }
    // IDLE 7 DAYS reads main's nightly corpus document; a dry run without the db does not judge it.
    const laneTotals = corpus || !db ? null : laneTotalsOf(await db.collection(COLLECTION).findOne({ _id: `${TYPE}:corpus` }).catch(() => null));
    const doc = corpus ? await collectCorpus(db) : await collectBox({ box, laneTotals });
    if (dry) { console.log(JSON.stringify(doc, null, 2)); if (corpus) { const due = edgesToPage(doc.stalls, doc.stalls, new Date()); if (due.length) console.log(`would page: ${pageText(due)}`); } return; }
    if (corpus) await pageStalls(doc);
    if (!corpus) writePoolsFile(doc);
    await db.collection(COLLECTION).replaceOne({ _id: doc._id }, doc, { upsert: true });
    const n = corpus ? `${doc.translated_per_day?.length ?? 0} translation rows, ${doc.ocr_per_day?.length ?? 0} ocr rows` : `${doc.lines.length} lines, ${doc.agy_pools?.length ?? 0} pools`;
    console.log(`${new Date().toISOString()} wrote ${doc._id}: ${n}${doc.errors?.length ? ` · errors: ${doc.errors.join('; ')}` : ''}`);
  } finally {
    await client?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error(e); process.exit(1); });
}
