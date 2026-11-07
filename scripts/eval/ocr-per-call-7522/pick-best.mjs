#!/usr/bin/env node
// PRIOR ART: /data/scratch/sl/jobs/agy-per-call-7503/pick-best-7503.py (#7503, on cloudlayer, not in the repo) — the
// same rule for English versions; this one picks among OCR reads and lays out a directory `cli-ocr.mjs apply` reads.
/**
 * #7522 useful output: per page, the best Opus-judged read of the four arms — usable, with no omission, addition,
 * cross-page bleed or order error, then fewest misreads; ties go to the one-page arms (A1, A1b), then B2, C4. A page
 * with no such read gets none. The chosen reads are copied into DIR/best (each .txt and .meta.json, the prompt files
 * their hashes need), for:
 *   node --env-file=... scripts/batch/cli-ocr.mjs apply --out=DIR/best --reason="#7522 best-of-arms, Opus-judged" [--apply]
 *
 *   node scripts/eval/ocr-per-call-7522/pick-best.mjs --scratch=DIR      (needs DIR/results.json from score.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const ORDER = ['A1', 'A1b', 'B2', 'C4'];
const res = JSON.parse(fs.readFileSync(path.join(S, 'results.json'), 'utf8'));
const BEST = path.join(S, 'best');
fs.rmSync(BEST, { recursive: true, force: true });
fs.mkdirSync(path.join(BEST, 'prompts'), { recursive: true });
// One live prompt for every arm: the one-page reads rebuild their prompt from prompt-base.txt.
const bases = new Set(ORDER.map((a) => fs.readFileSync(path.join(S, a, 'prompt-base.txt'), 'utf8')));
if (bases.size !== 1) throw new Error('the arms were read on different live prompts');
for (const f of ['prompt-base.txt', 'prompt-ref.json']) fs.copyFileSync(path.join(S, 'A1', f), path.join(BEST, f));
const clean = (r) => r.delivered && r.usable && !r.omissions && !r.additions && !r.cross_page_bleed && !r.order_errors;
const choice = {};
for (const id of [...new Set(res.rows.map((r) => r.page_id))]) {
  const c = res.rows.filter((r) => r.page_id === id && clean(r)).sort((a, b) => a.misreads - b.misreads || ORDER.indexOf(a.arm) - ORDER.indexOf(b.arm))[0];
  if (!c) { choice[id] = null; continue; }
  choice[id] = { arm: c.arm, misreads: c.misreads, call_pages: c.call_pages };
  const dir = path.join(S, c.arm);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8'));
  fs.copyFileSync(path.join(dir, `${id}.txt`), path.join(BEST, `${id}.txt`));
  fs.writeFileSync(path.join(BEST, `${id}.meta.json`), JSON.stringify({ ...meta, eval_pick: { issue: 7522, arm: c.arm, misreads: c.misreads } }, null, 1));
  if (meta.prompt_sent_file) fs.copyFileSync(path.join(dir, meta.prompt_sent_file), path.join(BEST, meta.prompt_sent_file));
}
fs.writeFileSync(path.join(S, 'choice.json'), JSON.stringify(choice, null, 1));
const picked = Object.values(choice).filter(Boolean);
const byArm = Object.fromEntries(ORDER.map((a) => [a, picked.filter((c) => c.arm === a).length]));
console.log(JSON.stringify({ pages: Object.keys(choice).length, picked: picked.length, none: Object.values(choice).filter((c) => !c).length, no_misreads: picked.filter((c) => !c.misreads).length, by_arm: byArm }));
