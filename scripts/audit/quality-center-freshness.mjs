#!/usr/bin/env node
/**
 * Is the hand-written part of /quality still current? (#5918)
 *
 * PRIOR ART: scripts/audit/doc-staleness.mjs checks living docs for orphans and old
 * dated stats, not a page's own as-of date against the data it describes;
 * scripts/eval/build-experiments.mjs --check checks that EXPERIMENTS.md matches its
 * sources, not that prose written about them has kept up. Neither fits; this reuses
 * the experiments file-name rule from build-experiments.mjs.
 *
 * /quality reads every number and list from committed files at build time, so those
 * refresh themselves. Three things do not, and this checks each:
 *   1. the page's prose, dated PROSE_AS_OF in src/app/quality/content.ts;
 *   2. the running / next / defect list it shows, dated AS_OF in
 *      src/app/research/quality/open/issues.ts;
 *   3. the feedback synthesis, src/data/quality-feedback-themes.json (generated_on).
 * 1 and 2 are stale when their date is more than --max-days (30) older than the newest
 * experiment write-up in scripts/eval/experiments/. 3 is stale when it is more than
 * --max-days older than today: new feedback arrives whether or not experiments do.
 *
 * No database, no secrets. Run weekly by .github/workflows/quality-center-watch.yml,
 * which files one issue when this fails and closes it when it passes again.
 *
 *   node scripts/audit/quality-center-freshness.mjs [--max-days 30] [--today YYYY-MM-DD]
 *
 * Exit 0: current. Exit 1: something is stale (printed). Exit 2: a date could not be read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATED = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;
const DAY = 86_400_000;

const toDay = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Pure: given the four dates, list what is stale. Dates are ISO YYYY-MM-DD. */
export function checkFreshness({ proseAsOf, openWorkAsOf, newestExperiment, feedbackOn, today, maxDays = 30 }) {
  const findings = [];
  const behind = (label, date, file) => {
    const d = daysBetween(date, newestExperiment);
    if (d > maxDays) {
      findings.push(`${label} is dated ${date}, ${d} days older than the newest experiment write-up (${newestExperiment}). Re-read it against the data, edit what changed, and move the date in ${file}.`);
    }
  };
  behind('The prose on /quality', proseAsOf, 'src/app/quality/content.ts (PROSE_AS_OF)');
  behind('The open-work list /quality shows as Running and Next', openWorkAsOf, 'src/app/research/quality/open/issues.ts (AS_OF)');
  const age = daysBetween(feedbackOn, today);
  if (age > maxDays) {
    findings.push(`The feedback synthesis was generated on ${feedbackOn}, ${age} days ago. Regenerate it: node --env-file=.env.production.local scripts/analytics/quality-feedback-themes.mjs, then review the counts and the "what we did" lines.`);
  }
  return findings;
}

export function readDates(root = ROOT) {
  const content = fs.readFileSync(path.join(root, 'src/app/quality/content.ts'), 'utf8');
  const prose = content.match(/PROSE_AS_OF\s*=\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
  const issues = fs.readFileSync(path.join(root, 'src/app/research/quality/open/issues.ts'), 'utf8');
  const openRaw = issues.match(/export const AS_OF\s*=\s*'([^']+)'/)?.[1];
  const openParsed = openRaw ? Date.parse(`${openRaw} 12:00 UTC`) : NaN;
  const newest = fs.readdirSync(path.join(root, 'scripts/eval/experiments'))
    .map((f) => DATED.exec(f)?.[1]).filter(Boolean).sort().pop();
  const feedbackOn = JSON.parse(fs.readFileSync(path.join(root, 'src/data/quality-feedback-themes.json'), 'utf8')).generated_on;
  return {
    proseAsOf: prose ?? null,
    openWorkAsOf: Number.isNaN(openParsed) ? null : toDay(openParsed),
    newestExperiment: newest ?? null,
    feedbackOn: feedbackOn ?? null,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
  const maxDays = Number(flag('max-days', 30));
  const today = flag('today', toDay(Date.now()));
  let dates;
  try {
    dates = readDates();
  } catch (e) {
    console.error(`could not read a date: ${e.message}`);
    process.exit(2);
  }
  const missing = Object.entries(dates).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`could not read: ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log(`prose ${dates.proseAsOf} · open work ${dates.openWorkAsOf} · newest experiment ${dates.newestExperiment} · feedback ${dates.feedbackOn} · today ${today}`);
  const findings = checkFreshness({ ...dates, today, maxDays });
  for (const f of findings) console.log(`STALE: ${f}`);
  if (!findings.length) console.log('/quality is current.');
  process.exit(findings.length ? 1 : 0);
}
