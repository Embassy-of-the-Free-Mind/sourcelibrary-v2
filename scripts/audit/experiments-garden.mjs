#!/usr/bin/env node
/**
 * Weekly tidy-up of the experiment log (#5939): what in scripts/eval/experiments/
 * needs a person's attention, as ONE list.
 *
 * PRIOR ART: scripts/eval/experiments-lint.mjs (PR gate: a NEW entry has a valid
 * header; it says nothing about entries already on main, or about time);
 * scripts/audit/quality-center-freshness.mjs (/quality's prose dates against the
 * newest write-up; not the entries themselves); scripts/eval/decision-cards-audit.mjs
 * (whether a decision had enough evidence; not whether one was ever taken). None of
 * them reads the headers across entries, or the pages that cite them.
 *
 * FINDINGS
 *   1. no-header   a dated entry without a header (or with an invalid one);
 *   2. stale       `undecided` for more than --undecided-days (21) with no newer entry
 *                  on any of its issues — a decision owed and forgotten;
 *   3. cited       a page or lib under src/ cites a `superseded` entry by file name
 *                  (comment lines are skipped);
 *   4. conflict    on one canon, stage and measure, a live `adopted` and a live
 *                  `rejected` entry — two verdicts a reader may see side by side;
 *                  read both and supersede one, or narrow their canons;
 *   5. note        /quality's monthly "What changed this month" note (MONTH_NOTE in
 *                  src/app/quality/content.ts) is missing or more than --note-days (35) old.
 *
 * $0: no database, no model, no network. Run weekly by
 * .github/workflows/experiments-garden.yml, which files ONE issue while findings
 * persist and closes it on the first clean run.
 *
 *   node scripts/audit/experiments-garden.mjs [--today YYYY-MM-DD] [--json]
 * Exit 0 clean, 1 findings, 2 the instrument failed (unreadable index or directory).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExperiment, canonIds } from '../eval/lib/experiment-header.mjs';
import { buildIndex } from '../eval/build-experiments.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 86_400_000;
const DATED = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Pure: entries (the index records) + citations + note date → findings by kind. */
export function garden({ entries, headerProblems = [], citations = [], noteAsOf = null, today, undecidedDays = 21, noteDays = 35 }) {
  const f = { 'no-header': [], stale: [], cited: [], conflict: [], note: [] };
  for (const p of headerProblems) f['no-header'].push(p);
  for (const e of entries) if (!e.status) f['no-header'].push(`${e.file}: no header`);

  for (const e of entries) {
    if (e.status !== 'undecided') continue;
    const age = days(e.date, today);
    if (age <= undecidedDays) continue;
    const newer = entries.find((o) => o.date > e.date && o.issues.some((i) => e.issues.includes(i)));
    if (!newer) f.stale.push(`${e.file}: undecided for ${age} days, no newer entry on ${e.issues.length ? e.issues.map((i) => `#${i}`).join(', ') : 'its question (no issue)'}${e.decision ? ` — ${e.decision}` : ''}`);
  }

  const status = new Map(entries.map((e) => [e.file, e]));
  for (const c of citations) {
    const e = status.get(c.file);
    if (e?.status === 'superseded') f.cited.push(`${c.where} cites ${c.file}, superseded by ${e.superseded_by}`);
  }

  const groups = new Map();
  for (const e of entries) {
    if (!['adopted', 'rejected'].includes(e.status) || !e.stage) continue;
    for (const canon of e.canons) {
      const k = `${canon} · ${e.stage} · ${e.measure[0] ?? 'none'}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
  }
  for (const [k, list] of groups) {
    const a = list.filter((e) => e.status === 'adopted'), r = list.filter((e) => e.status === 'rejected');
    if (a.length && r.length) f.conflict.push(`${k}: adopted ${a.map((e) => e.file).join(', ')} vs rejected ${r.map((e) => e.file).join(', ')}`);
  }

  if (!noteAsOf) f.note.push('/quality has no "What changed this month" note yet: set MONTH_NOTE in src/app/quality/content.ts (written by a person).');
  else if (days(noteAsOf, today) > noteDays) f.note.push(`/quality's "What changed this month" note is dated ${noteAsOf}, ${days(noteAsOf, today)} days ago: write this month's (MONTH_NOTE in src/app/quality/content.ts).`);
  return f;
}

/** Every `YYYY-MM-DD-slug.md` named on a non-comment line of a .ts/.tsx file under src/. */
export function findCitations(root = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          for (const m of line.matchAll(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md)\b/g)) out.push({ file: m[1], where: `${path.relative(root, p)}:${i + 1}` });
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

export function readNoteDate(root = ROOT) {
  const content = fs.readFileSync(path.join(root, 'src/app/quality/content.ts'), 'utf8');
  return content.match(/MONTH_NOTE[^=]*=\s*\{[^}]*as_of:\s*'(\d{4}-\d{2}-\d{2})'/s)?.[1] ?? null;
}

const LABEL = {
  'no-header': 'Entries without a valid header',
  stale: 'Undecided for more than 21 days, nothing newer on the same issue',
  cited: 'Pages citing a superseded entry',
  conflict: 'Live verdicts that disagree (same canon, stage and measure: one adopted, one rejected)',
  note: 'Monthly reflection',
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
  const today = flag('today', new Date().toISOString().slice(0, 10));
  let entries, headerProblems = [];
  try {
    const dir = path.join(ROOT, 'scripts/eval/experiments');
    entries = buildIndex(dir).entries;
    const names = fs.readdirSync(dir);
    const canons = canonIds();
    for (const n of names.filter((x) => DATED.test(x))) {
      const { problems } = readExperiment(fs.readFileSync(path.join(dir, n), 'utf8'), { name: n, exists: (x) => names.includes(x), canons });
      for (const p of problems) headerProblems.push(`${n}: ${p}`);
    }
  } catch (e) {
    console.error(`experiments-garden: could not read the log: ${e.message}`);
    process.exit(2);
  }
  const f = garden({ entries, headerProblems, citations: findCitations(), noteAsOf: readNoteDate(), today,
    undecidedDays: Number(flag('undecided-days', 21)), noteDays: Number(flag('note-days', 35)) });
  const total = Object.values(f).reduce((s, l) => s + l.length, 0);
  if (args.includes('--json')) console.log(JSON.stringify({ today, entries: entries.length, findings: f }, null, 1));
  else {
    console.log(`Experiment log, ${today}: ${entries.length} entries, ${total} finding(s).`);
    for (const [k, list] of Object.entries(f)) {
      if (!list.length) continue;
      console.log(`\n### ${LABEL[k]} (${list.length})\n`);
      for (const x of list) console.log(`- ${x}`);
    }
  }
  process.exit(total ? 1 : 0);
}
