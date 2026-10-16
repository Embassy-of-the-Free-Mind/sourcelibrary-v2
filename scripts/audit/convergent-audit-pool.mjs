#!/usr/bin/env node
// PRIOR ART: scripts/audit/convergent-audit-weekly.mjs score (one run, two readers, one comment per run). The spare
// lane's fallback (#6781) runs many Opus-only rounds a week on each account; one comment per round would bury #6420,
// so this pools the rounds of one account-week into one comment. It re-reads each round's draw and Opus reviews with
// the same validator and serious-page rule as `score`, so a round that was stopped part-way counts what it read.
/**
 *   node scripts/audit/convergent-audit-pool.mjs --label "l7a, week to 2026-10-22" [--post] <run dir> [<run dir> …]
 *
 * Rates are by BOOK across the pooled rounds (one page per book: a book drawn in two rounds counts once), Opus
 * only, so nothing here is convergent. Read-only; the only write anywhere is the GitHub comment with --post.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateOutput, keyOf } from '../eval/second-reader/lib.mjs';
import { kOfNBooks, kOfNMarkdown } from '../lib/review-vocabulary.mjs';
import { seriousKinds, isSeriousPage } from './convergent-audit-lib.mjs';

const argv = process.argv.slice(2);
const li = argv.indexOf('--label');
const label = li >= 0 ? argv[li + 1] : 'spare lane';
const post = argv.includes('--post');
const runs = argv.filter((a, i) => !a.startsWith('--') && i !== li + 1);
if (!runs.length) { console.error('usage: convergent-audit-pool.mjs --label L [--post] <run dir>…'); process.exit(2); }
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const rows = { random: [], 'lane-b-written': [] };
const findings = [], used = [];
let seed = 0;
for (const R of runs) {
  let draw;
  try { draw = read(path.join(R, 'draw.json')); } catch { console.error(`skip ${R}: no draw.json`); continue; }
  seed ||= draw.seed;
  let n = 0;
  for (const d of draw.pages) {
    let recs, out;
    try { recs = read(path.join(R, 'packets', `${d.packet}.json`)); out = read(path.join(R, 'readers', 'opus', 'reviews', `${d.packet}.json`)); } catch { continue; }
    const p = validateOutput(out, recs).pages.get(keyOf(recs[0].book_id, recs[0].pages[0].page_number));
    if (!p) continue;
    n++;
    const serious = isSeriousPage(p);
    (rows[d.stratum] ||= []).push({ book_id: d.book_id, page_number: d.page_number, exposure: d.exposure ?? 'unrecorded', serious, kinds: seriousKinds(p) });
    if (serious) {
      const errs = [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].filter((e) => e.severity === 'serious');
      if (p.right_page === 'no') errs.unshift({ class: 'I1', problem: 'image is not the leaf the text is of' });
      findings.push({ run: path.basename(R), ...d, errors: errs });
    }
  }
  used.push({ run: path.basename(R), seed: draw.seed, pages: draw.pages.length, read: n });
}
if (!used.length) { console.error('no round has a draw'); process.exit(1); }
const read_total = used.reduce((s, u) => s + u.read, 0);
const md = [
  `**Spare-lane convergent-audit rounds, pooled (#6420 lane D, #6781): ${label}** — ${used.length} round(s), Opus only`,
  '',
  `When an account was in the last 48 h of its week and the spare lane had no eligible issue, it ran an Opus-only round of the weekly draw (fresh seed, frozen #6338 brief, sealed \`claude -p\`, subscription). ${read_total} of ${used.reduce((s, u) => s + u.pages, 0)} drawn pages were read. **One reader: nothing here is convergent**, and these are findings, not verdicts.`,
  '',
  ...['random', 'lane-b-written'].flatMap((s) => {
    if (!rows[s]?.length) return [];
    return kOfNMarkdown(kOfNBooks(rows[s], { seed }), { what: s === 'random' ? 'random visible non-English books' : 'books lane B wrote a page of', reader: 'opus' });
  }),
  '',
  `Rounds: ${used.map((u) => `\`${u.run}\` (seed ${u.seed}, ${u.read}/${u.pages} read)`).join(', ')}.`,
  '',
  `Serious findings (${findings.length}; first 15):`,
  ...findings.slice(0, 15).map((f) => `- ${f.stratum} · \`${f.book_id}\` p.${f.page_number} (${f.language ?? '?'}, OCR ${f.ocr_model ?? '?'}): ${f.errors.slice(0, 2).map((e) => `${e.class ?? '?'} ${String(e.problem ?? e.note ?? '').slice(0, 140)}`).join('; ')}`),
  '',
  'Headline rates are by book, one page per book across the pooled rounds, served text only, Wilson 95% intervals (scripts/lib/review-vocabulary.mjs). Wrong-leaf or invented text found here is contained per `containment-on-finding.md` by the session that reads this.',
].join('\n');
console.log(md);
if (post) {
  const f = path.join(runs[0], '..', `pooled-${Date.now()}.md`);
  fs.writeFileSync(f, md + '\n');
  const r = spawnSync('gh', ['issue', 'comment', '6420', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body-file', f], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`post FAILED: ${r.stderr}`); process.exit(1); }
  console.log(`posted: ${r.stdout.trim()}`);
}
