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
 *   --dry-run      print the document, write nothing.
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

export const COLLECTION = 'ops_reports';
export const TYPE = 'pipeline-now';
export const CORPUS_DAYS = 7;

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

/** The pipeline lanes in a crontab: one row per job line whose script runs a stage. */
export function pipelineLines(text) {
  const rows = [];
  for (const { schedule, cmd, comment, disabled, tag } of parseCrontab(text)) {
    const stage = stageOf(cmd);
    if (!stage) continue;
    const scripts = scriptsOf(cmd);
    rows.push({
      stage, schedule, one_shot: isOneShot(schedule), disabled, disabled_tag: tag,
      script: scripts[0] ?? null, scripts: scripts.slice(0, 4), mode: modeOf(cmd, scripts[0]),
      ...flagsOf(cmd), log: logPathOf(cmd), comment: redact(comment, 200),
    });
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
  }));
}

export async function collectBox({ box, now = new Date() }) {
  const lines = pipelineLines(liveCrontab()).map(r => ({
    ...r,
    log_at: r.log ? mtimeIso(r.log) : null,
    log_last: r.log ? redact(lastLine(tailOf(r.log)), 200) : null,
  }));
  return {
    _id: `${TYPE}:${box}`, type: TYPE, box, host: os.hostname(), generated_at: now.toISOString(),
    lines, lanes: laneStates(), gpu_queue: gpuQueue(), agy_pools: await agyPools(),
  };
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

export async function collectCorpus(db, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (CORPUS_DAYS - 1)));
  const dial = await db.collection('system_config').findOne({ _id: 'processing_control' }, { projection: { paused: 1, daily_budget_usd: 1, updated_at: 1 } });
  const gates = await db.collection('quality_gates').find({}, { projection: { id: 1, step: 1, verdict: 1, decision: 1, created_at: 1, 'window.label': 1, 'window.books': 1 } })
    .sort({ _id: -1 }).limit(3).toArray();
  const errors = [];
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${redact(e.message, 160)}`); return null; } };
  return {
    _id: `${TYPE}:corpus`, type: TYPE, box: 'corpus', generated_at: now.toISOString(), since: since.toISOString(),
    dial: dial ? { paused: dial.paused ?? null, daily_budget_usd: dial.daily_budget_usd ?? null } : null,
    quality_gates: gates.map(g => ({ id: g.id ?? String(g._id), step: g.step ?? null, verdict: g.verdict ?? g.decision ?? null, window: g.window?.label ?? null, books: g.window?.books ?? null, at: g.created_at ?? gateTime(g.id) })),
    translated_per_day: await safe('translation', () => perDay(db, 'translation', since)),
    ocr_per_day: await safe('ocr', () => perDay(db, 'ocr', since)),
    errors,
  };
}

// ───────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = argv.includes('--dry-run');
  const corpus = argv.includes('--corpus');
  const box = arg('--box');
  if (!corpus && !box) { console.error('usage: pipeline-now-push.mjs --box <name> | --corpus [--dry-run]'); process.exit(2); }

  const needDb = corpus || !dry;
  let client = null, db = null;
  if (needDb) {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'bookstore');
  }
  try {
    const doc = corpus ? await collectCorpus(db) : await collectBox({ box });
    if (dry) { console.log(JSON.stringify(doc, null, 2)); return; }
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
