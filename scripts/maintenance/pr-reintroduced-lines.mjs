#!/usr/bin/env node
/**
 * Flag a revert-by-conflict-resolution: lines this PR ADDS that a merge to main
 * REMOVED in the last 14 days. Warn only — one comment, never a failing check.
 *
 * PRIOR ART: scripts/maintenance/pr-tier.mjs — reads the same `gh pr diff` and
 * classifies risk by path; it has no notion of what main did to a line. This is
 * the line-level sibling and runs from the same workflow (pr-tier.yml).
 *
 * WHY (#5415): when #5269 was rebuilt on #5272 its conflict resolution kept its
 * OWN side of a fact line — "Scanning is $60 a book" came back one line under
 * #5272's "$550K for 3,000 books". `git log -S` showed #4673 added the line,
 * #5272 removed it, #5269 re-added it. A resolution that takes "ours" on a line
 * the PR never meant to change is a silent revert of someone else's merged work,
 * and no check caught it; a reader did.
 *
 * Method: for each added line ≥ 40 chars (trimmed; cap 200 per PR, code and prose
 * alike), `git log -S<line> --since=14.days origin/main -- <file>`; a hit counts
 * only if that commit REMOVED the line (not added it). Report the removing merge.
 *
 * Usage:
 *   node scripts/maintenance/pr-reintroduced-lines.mjs --pr 5269            # print findings
 *   node scripts/maintenance/pr-reintroduced-lines.mjs --pr 5269 --comment  # also post ONE comment
 * Needs `gh` authenticated and origin/main history for the window (the workflow
 * fetches `--shallow-since`; locally a normal clone has it).
 */
import { execFileSync, execSync } from 'node:child_process';

const MARKER = '<!-- pr-reintroduced-lines -->';
const MIN_LEN = 40;
const CAP = 200;
const SINCE = '14.days';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const sh = (cmd, opts = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }); }
  catch (e) { return e.stdout || ''; }
};
const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ''; }
};

/** Parse a unified diff into [{file, line}] for added lines worth checking. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    if (raw.startsWith('--- ') || raw.startsWith('@@') || raw.startsWith('diff ')) continue;
    if (!file || file === '/dev/null' || !raw.startsWith('+')) continue;
    const line = raw.slice(1);
    const t = line.trim();
    if (t.length < MIN_LEN) continue;
    if (!/[A-Za-z]{3}/.test(t)) continue;               // punctuation-only, hashes, base64
    if (/^[\s\-=*#/|+]+$/.test(t)) continue;            // rules, separators
    out.push({ file, line: t });
  }
  return out;
}

/** Commits on `base` within the window that REMOVED this exact line from `file`. */
export function removedBy(file, line, base = 'origin/main') {
  const shas = git('log', `-S${line}`, `--since=${SINCE}`, '--format=%H', base, '--', file).split('\n').filter(Boolean);
  const hits = [];
  for (const sha of shas) {
    const patch = git('show', '--format=%h %s', '--unified=0', sha, '--', file);
    const removed = patch.split('\n').some((l) => l.startsWith('-') && !l.startsWith('---') && l.slice(1).trim() === line);
    const added = patch.split('\n').some((l) => l.startsWith('+') && !l.startsWith('+++') && l.slice(1).trim() === line);
    if (removed && !added) {
      const head = patch.split('\n')[0] || sha.slice(0, 7);
      const pr = (head.match(/\(#(\d+)\)\s*$/) || [])[1];
      hits.push({ sha: sha.slice(0, 7), ref: pr ? `#${pr}` : sha.slice(0, 7), subject: head });
    }
  }
  return hits;
}

export function findReintroduced(diff) {
  const lines = addedLines(diff);
  const checked = lines.slice(0, CAP);
  const findings = [];
  const seen = new Set();
  for (const { file, line } of checked) {
    const key = file + '\0' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = removedBy(file, line);
    if (hits.length) findings.push({ file, line, hits });
  }
  return { findings, checked: checked.length, total: lines.length };
}

function body(number, r) {
  const out = [MARKER, `**This PR re-introduces ${r.findings.length} line${r.findings.length === 1 ? '' : 's'} that a merge to \`main\` removed in the last 14 days — deliberate?**`, '',
    'A rebase or merge-main resolution that keeps "ours" on a line the PR never meant to change silently reverts someone else\'s merged work (#5415: a $60-a-book footnote came back one line under a figure that contradicted it). Warn only — if these are intended, ignore this.', ''];
  for (const f of r.findings.slice(0, 15)) {
    out.push(`- \`${f.file}\` — removed by ${f.hits.map((h) => h.ref).join(', ')}`);
    out.push(`  \`${f.line.slice(0, 160)}\``);
  }
  if (r.findings.length > 15) out.push(`- …and ${r.findings.length - 15} more`);
  out.push('', `_Checked ${r.checked} of ${r.total} added lines ≥ ${MIN_LEN} chars. Script: \`scripts/maintenance/pr-reintroduced-lines.mjs\`._`);
  return out.join('\n');
}

function main() {
  const number = parseInt(val('--pr'), 10);
  if (!number) { console.error('usage: --pr N [--comment]'); process.exit(1); }
  const diff = sh(`gh pr diff ${number}`);
  if (!diff.trim()) { console.log(`#${number}: empty diff, nothing to check`); return; }
  const r = findReintroduced(diff);
  console.log(`#${number}: ${r.findings.length} re-introduced line(s) among ${r.checked}/${r.total} checked`);
  for (const f of r.findings) console.log(`  ${f.file}  ← removed by ${f.hits.map((h) => h.ref).join(', ')}\n    ${f.line.slice(0, 120)}`);
  if (!r.findings.length || !has('--comment')) return;
  const pr = JSON.parse(sh(`gh pr view ${number} --json comments`));
  if ((pr.comments || []).some((c) => (c.body || '').includes(MARKER))) { console.log('already commented; not repeating'); return; }
  sh(`gh pr comment ${number} --body-file -`, { input: body(number, r) });
  console.log('commented');
}

if (process.argv[1] && process.argv[1].endsWith('pr-reintroduced-lines.mjs')) main();
