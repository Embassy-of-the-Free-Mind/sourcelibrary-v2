#!/usr/bin/env node
// PRIOR ART: scripts/workers/sync-crontab.sh — reports drift between main's live crontab and a committed snapshot;
// it knows one box and never writes a crontab. scripts/lib/lanes.mjs CRON_ROWS — says what each live cron line IS
// (owner, route, review date) by matching it; it holds neither the schedule nor the command, so no line can be
// generated from it. scripts/eval/paddle-*/cron.sh — one-off `crontab -l | grep -v | crontab -` self-removers.
// None turns a table into crontab text.
//
// lanes-crontab — the lane table (infrastructure/lanes.tsv) written into one marked block of this box's crontab (#70).
//
// WHY: a cron lane (an hourly OCR, correction or translation run) runs on whichever box's crontab holds its line.
// Moving one meant hand-editing two live crontabs, so nobody did: on 2026-11-12 gex45 sat at load 110 on 20 threads
// while main was 87% idle. With the table, moving a lane is a one-cell change in a pull request.
//
// WHAT IT TOUCHES: only the lines between the BEGIN and END markers below. Every other line of the crontab is kept
// byte for byte, and a crontab with no block and no row for this box comes back unchanged.
//
//   node scripts/workers/lanes-crontab.mjs                 check (the default): print what the block would change
//   node scripts/workers/lanes-crontab.mjs --apply         write it: backup, install, read back and compare
//   ssh gex45 crontab -l | node scripts/workers/lanes-crontab.mjs --box=gex45 --crontab=- [--out=FILE]
//                                                          check a crontab from another machine (the laptop, CI)
//
// Exit: 0 nothing to do. 1 the block would change, or a row needs a hand action (see SKIPPED / ELSEWHERE).
//       2 refused, nothing written (malformed table, broken markers, unknown box). 3 the install or its read-back failed.
//
// No imports beyond node's own: the guest boxes run this from a checkout that may have no node_modules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The four boxes, by the names scripts/workers/box.sh uses (BOXES), and the hostname each one reports. */
export const BOXES = ['main', 'cloudlayer', 'l7a', 'gex45'];
export const HOSTNAME_BOX = { clawdbot: 'main', 'earthai-live': 'cloudlayer', 'earthai-l7a': 'l7a', 'gex45-1': 'gex45' };
/** A row whose box is `off` runs nowhere. It is the middle step of a move: see JOB-HOSTS.md. */
export const OFF = 'off';
export const TABLE_PATH = 'infrastructure/lanes.tsv';
export const TABLE_HEADER = 'lane\tbox\tschedule\tcommand';
export const BEGIN = `# BEGIN lanes (generated from ${TABLE_PATH}; edit the table, not this block)`;
export const END = '# END lanes';

const isBegin = (l) => /^\s*#\s*BEGIN lanes\b/.test(l);
const isEnd = (l) => /^\s*#\s*END lanes\b/.test(l);
const squash = (s) => s.trim().replace(/\s+/g, ' ');
/** A crontab line cron would run: not blank, not a comment, not a VAR=value line. */
const isJob = (l) => { const t = l.trim(); return t !== '' && !t.startsWith('#') && !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t); };

export function boxOfHostname(hostname) {
  return HOSTNAME_BOX[String(hostname).split('.')[0]] ?? null;
}

/** Five cron fields separated by single spaces, or one of cron's @words. Ranges are left to `crontab` itself. */
export function validSchedule(s) {
  if (/^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(s)) return true;
  const f = s.split(' ');
  return f.length === 5 && f.every((x) => /^[0-9A-Za-z*/,-]+$/.test(x));
}

/**
 * The table text -> { rows: [{ lane, box, schedule, command, line }], errors: [string] }.
 * Any error means the whole table is refused: a half-read table would silently drop lanes from a crontab.
 */
export function parseTable(text) {
  const rows = []; const errors = [];
  let sawHeader = false;
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    if (raw.includes('\r')) { errors.push(`line ${n}: carriage return (save the table with Unix line endings)`); return; }
    if (raw.trim() === '' || raw.trim().startsWith('#')) return;
    if (!sawHeader) {
      sawHeader = true;
      if (raw !== TABLE_HEADER) errors.push(`line ${n}: the first row must be the header, tab-separated: lane, box, schedule, command`);
      return;
    }
    const cells = raw.split('\t');
    if (cells.length !== 4) { errors.push(`line ${n}: ${cells.length} tab-separated cells, expected 4 (lane, box, schedule, command). A command cannot hold a tab`); return; }
    const [lane, box, schedule, command] = cells;
    const before = errors.length;
    TABLE_HEADER.split('\t').forEach((name, k) => {
      if (cells[k] === '') errors.push(`line ${n}: empty ${name}`);
      else if (cells[k] !== cells[k].trim()) errors.push(`line ${n}: ${name} has a space at its start or end`);
    });
    if (errors.length > before) return;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(lane)) errors.push(`line ${n}: lane "${lane}" must be lower-case letters, digits and hyphens`);
    if (!BOXES.includes(box) && box !== OFF) errors.push(`line ${n} (${lane}): box "${box}" is not one of ${BOXES.join(', ')} or ${OFF}`);
    if (!validSchedule(schedule)) errors.push(`line ${n} (${lane}): schedule "${schedule}" is not five cron fields separated by single spaces, or an @word`);
    if (command.startsWith('#')) errors.push(`line ${n} (${lane}): the command starts with #, so cron would read it as a comment`);
    if (/[\x00-\x1f\x7f]/.test(command)) errors.push(`line ${n} (${lane}): the command holds a control character`);
    const twin = rows.find((r) => r.lane === lane);
    if (twin) errors.push(`line ${n}: lane "${lane}" is already on line ${twin.line}`);
    const same = rows.find((r) => squash(r.command) === squash(command));
    if (same) errors.push(`line ${n} (${lane}): the same command is already lane "${same.lane}" on line ${same.line}. A lane keeps its book claims on one box's disk, so it runs on one box at a time`);
    rows.push({ lane, box, schedule, command, line: n });
  });
  if (!sawHeader) errors.push('no header row (lane, box, schedule, command)');
  return { rows, errors };
}

/** Where the block sits in a crontab's lines: { begin, end } (-1, -1 when there is none) or { error }. */
export function findBlock(lines) {
  const begins = []; const ends = [];
  lines.forEach((l, i) => { if (isBegin(l)) begins.push(i); else if (isEnd(l)) ends.push(i); });
  if (begins.length === 0 && ends.length === 0) return { begin: -1, end: -1 };
  const where = `BEGIN on line(s) ${begins.map((i) => i + 1).join(', ') || 'none'}, END on line(s) ${ends.map((i) => i + 1).join(', ') || 'none'}`;
  if (begins.length !== 1 || ends.length !== 1) return { error: `the crontab's lanes markers are not one BEGIN and one END (${where}). Repair them by hand` };
  if (ends[0] < begins[0]) return { error: `the crontab's "# END lanes" comes before its "# BEGIN lanes" (${where}). Repair them by hand` };
  return { begin: begins[0], end: ends[0] };
}

/** The lines outside the block, in order (the newline that ends the file is not a line). null when the markers are broken. */
export function outsideLines(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const b = findBlock(lines);
  if (b.error) return null;
  return b.begin < 0 ? lines : lines.filter((_, i) => i < b.begin || i > b.end);
}

/**
 * The second lock on a write: a new crontab may differ from the old one only inside the block.
 * Returns null when that holds, else the reason to refuse. planCrontab keeps outside lines by construction;
 * this compares its RESULT, so a bug there (or in a later edit of it) cannot delete someone's cron line.
 */
export function guardOutside(before, after) {
  const a = outsideLines(before); const b = outsideLines(after);
  if (a === null) return 'the live crontab has broken lanes markers';
  if (b === null) return 'the new crontab would have broken lanes markers';
  if (b.length < a.length) return `the new crontab would have ${b.length} lines outside the lanes block and the live one has ${a.length}: ${a.length - b.length} line(s) would be lost`;
  const k = a.findIndex((l, i) => l !== b[i]);
  if (k >= 0 || b.length !== a.length) return `a line outside the lanes block would change (first difference at outside line ${k >= 0 ? k + 1 : a.length + 1})`;
  return null;
}

/**
 * THE CORE. Crontab text, table text and a box name in; the new crontab text out. No I/O, so it runs anywhere.
 *
 *   installed  rows written into this box's block
 *   skipped    rows for this box whose command a line OUTSIDE the block already runs (installed by hand).
 *              They are left out of the block so the lane cannot run twice; remove the hand line, then run again.
 *   elsewhere  rows placed on another box (or off) whose command a hand line HERE still runs. Nothing this box can
 *              fix by writing its block, so it is reported: the lane would run on two boxes.
 *
 * When `ok` is false, `text` is the input unchanged.
 */
export function planCrontab({ crontab, table, box }) {
  const fail = (errors) => ({ ok: false, errors, text: crontab, changed: false, rows: 0, installed: [], skipped: [], elsewhere: [], added: [], removed: [] });
  if (!BOXES.includes(box)) return fail([`"${box}" is not one of the boxes (${BOXES.join(', ')})`]);
  const t = parseTable(table);
  if (t.errors.length) return fail(t.errors.map((e) => `${TABLE_PATH} ${e}`));
  const lines = crontab.split('\n');
  const b = findBlock(lines);
  if (b.error) return fail([b.error]);

  const hand = [];  // jobs outside the block, with their line number in the crontab
  lines.forEach((l, i) => { if ((b.begin < 0 || i < b.begin || i > b.end) && isJob(l)) hand.push({ line: i + 1, text: squash(l) }); });
  const installed = []; const skipped = []; const elsewhere = [];
  for (const r of t.rows) {
    const h = hand.find((x) => x.text.includes(squash(r.command)));
    if (r.box === box) { if (h) skipped.push({ lane: r.lane, line: h.line }); else installed.push(r); }
    else if (h) elsewhere.push({ lane: r.lane, box: r.box, line: h.line });
  }

  const block = [BEGIN, ...installed.flatMap((r) => [`# lane: ${r.lane}`, `${r.schedule} ${r.command}`]), END];
  let out; let old = [];
  if (b.begin >= 0) {
    old = lines.slice(b.begin, b.end + 1);
    out = [...lines.slice(0, b.begin), ...block, ...lines.slice(b.end + 1)];
  } else if (installed.length === 0) {
    out = lines;                                                     // no block, nothing to write: leave it alone
  } else if (crontab === '') {
    out = [...block, ''];
  } else if (crontab.endsWith('\n')) {
    out = [...lines.slice(0, -1), ...block, ''];                     // at the end, so every VAR= line above applies
  } else {
    out = [...lines, ...block, ''];
  }
  const text = out === lines ? crontab : out.join('\n');
  const now = b.begin >= 0 || installed.length ? block : [];
  return {
    ok: true, errors: [], text, changed: text !== crontab, rows: t.rows.length, installed, skipped, elsewhere,
    added: now.filter((l) => !old.includes(l)), removed: old.filter((l) => !now.includes(l)),
  };
}

/** What a plan says, one string a line. `show` turns stored text into printable text (the CLI holds bytes as latin1). */
export function describePlan(p, { box, mode = 'check', show = (s) => s } = {}) {
  const cut = (s) => { const v = show(s); return v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v; };
  if (!p.ok) return [...p.errors.map((e) => `REFUSED: ${show(e)}`), `${mode} box=${box}: REFUSED, nothing changed (${p.errors.length} problem(s) above)`];
  const out = [];
  for (const l of p.removed) out.push(`  - ${cut(l)}`);
  for (const l of p.added) out.push(`  + ${cut(l)}`);
  for (const s of p.skipped) out.push(`SKIPPED lane ${s.lane}: already installed by hand (crontab line ${s.line}): remove the hand line first, then run this again`);
  for (const e of p.elsewhere) out.push(`ELSEWHERE lane ${e.lane}: the table puts it ${e.box === OFF ? 'on no box (off)' : `on ${e.box}`}, but crontab line ${e.line} here still runs it by hand: remove that line`);
  const here = `${p.rows} lane(s) in the table, ${p.installed.length} in this box's block`;
  const attention = p.skipped.length + p.elsewhere.length;
  const tail = attention ? `; ${attention} lane(s) need a hand action (above)` : '';
  const verb = mode === 'apply' ? 'CHANGED' : 'WOULD CHANGE';
  out.push(p.changed
    ? `${mode} box=${box}: ${verb} the lanes block, +${p.added.length} -${p.removed.length} line(s) (${here})${tail}`
    : `${mode} box=${box}: in sync, nothing to write (${here})${tail}`);
  return out;
}

/** Exit code of a finished check or apply: see the header. */
export const exitCode = (p, { applied = false } = {}) => (!p.ok ? 2 : (p.changed && !applied) || p.skipped.length || p.elsewhere.length ? 1 : 0);

/**
 * --apply, with its I/O passed in so the whole sequence is tested without a real crontab.
 *   readCrontab()            -> the live crontab text
 *   installCrontab(file)     -> { ok, err }   (`crontab <file>`)
 * Order: plan, guard, back up the old crontab (and check the backup), confirm nothing edited the crontab meanwhile,
 * install, read back, compare. Returns { code, lines, plan, backup? }.
 */
export function runApply({ box, table, readCrontab, installCrontab, backupDir, now = new Date(), plan = planCrontab, show = (s) => s }) {
  const before = readCrontab();
  const p = plan({ crontab: before, table, box });
  const lines = describePlan(p, { box, mode: 'apply', show });
  if (!p.ok) return { code: 2, lines, plan: p };
  const g = guardOutside(before, p.text);
  if (g) return { code: 2, lines: [`REFUSED: ${g}. Nothing written`, `apply box=${box}: REFUSED, nothing changed`], plan: p };
  if (!p.changed) return { code: exitCode(p, { applied: true }), lines, plan: p };

  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  const dir = path.join(backupDir, stamp.slice(0, 10));
  const backup = path.join(dir, `crontab-${stamp}.before`); const next = path.join(dir, `crontab-${stamp}.new`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(backup, before, 'latin1'); fs.writeFileSync(next, p.text, 'latin1');
  if (fs.readFileSync(backup, 'latin1') !== before) return { code: 2, lines: [`REFUSED: the backup ${backup} does not read back as the live crontab. Nothing written`], plan: p };
  if (readCrontab() !== before) return { code: 2, lines: ['REFUSED: the crontab changed while this ran (someone is editing it). Nothing written; run again'], plan: p };
  const restore = `Restore with: crontab ${backup}`;
  const inst = installCrontab(next);
  const after = readCrontab();
  if (!inst.ok) {
    const state = after === before ? 'The live crontab is unchanged' : `The live crontab is NOT what it was. ${restore}`;
    return { code: 3, lines: [`FAILED: crontab did not accept ${next}: ${show(String(inst.err || '').trim())}. ${state}`], plan: p, backup };
  }
  if (after !== p.text) return { code: 3, lines: [`FAILED: the installed crontab does not read back as ${next}. ${restore}`], plan: p, backup };
  return { code: exitCode(p, { applied: true }), lines: [...lines, `apply box=${box}: installed and read back; the old crontab is ${backup}`], plan: p, backup };
}

// ---- command line ----
// Crontab and table are held as latin1 strings: one character a byte, so text that is not valid UTF-8 (or is, like
// the box-drawing comments in main's crontab) goes out exactly as it came in.
function liveCrontab() {
  const r = spawnSync('crontab', ['-l'], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return r.stdout;
  if (/no crontab for/.test(r.stderr || '')) return '';
  throw new Error(`crontab -l failed: ${(r.stderr || r.error?.message || '').trim()}`);
}

function main(argv) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const show = (s) => Buffer.from(s, 'latin1').toString('utf8');
  const say = (l) => console.log(`[lanes-crontab] ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} ${l}`);
  const die = (l) => { say(`REFUSED: ${l}`); process.exit(2); };
  const o = { mode: 'check' };
  for (const a of argv) {
    const m = /^--(box|crontab|table|out)=(.+)$/.exec(a);
    if (a === '--check') o.mode = 'check';
    else if (a === '--apply') o.mode = 'apply';
    else if (m) o[m[1]] = m[2];
    else die(`unknown argument ${a}. Usage: lanes-crontab.mjs [--check | --apply] [--box=NAME --crontab=FILE|- [--out=FILE]] [--table=FILE]`);
  }
  if (o.mode === 'apply' && (o.box || o.crontab || o.table || o.out)) die('--apply takes no other option: it writes this box\'s own crontab from the committed table');
  const box = o.box || boxOfHostname(os.hostname());
  if (!box) die(`this host (${os.hostname()}) is not one of the four boxes. To check from elsewhere: --box=NAME --crontab=FILE`);
  const tableFile = o.table || path.join(repo, TABLE_PATH);
  let table;
  try { table = fs.readFileSync(tableFile, 'latin1'); } catch (e) { die(`cannot read the table ${tableFile}: ${e.message}`); }

  try {
    if (o.mode === 'apply') {
      // Install only what is committed: a half-edited table in a dirty checkout must not reach a live crontab.
      const st = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--', TABLE_PATH], { encoding: 'utf8' });
      if (st.status !== 0) die(`cannot ask git whether ${TABLE_PATH} is committed: ${(st.stderr || '').trim()}`);
      if (st.stdout.trim() && !process.env.LANES_UNCOMMITTED) die(`${TABLE_PATH} is not the committed file (LANES_UNCOMMITTED=1 to apply it anyway)`);
      const r = runApply({
        box, table, show, readCrontab: liveCrontab, backupDir: process.env.LANES_BACKUP_DIR || '/root/backups/lanes-crontab',
        installCrontab: (f) => { const x = spawnSync('crontab', [f], { encoding: 'latin1' }); return { ok: x.status === 0, err: x.stderr || x.error?.message }; },
      });
      r.lines.forEach(say);
      process.exit(r.code);
    }
    const crontab = o.crontab ? fs.readFileSync(o.crontab === '-' ? 0 : o.crontab, 'latin1') : liveCrontab();
    const p = planCrontab({ crontab, table, box });
    const g = p.ok ? guardOutside(crontab, p.text) : null;
    if (g) die(`${g}. This is a bug in lanes-crontab.mjs`);
    describePlan(p, { box, show }).forEach(say);
    if (o.out && p.ok) fs.writeFileSync(o.out, p.text, 'latin1');
    process.exit(exitCode(p));
  } catch (e) { die(e.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
