#!/usr/bin/env node
// PRIOR ART: scripts/eval/flash-reread-5924/T-TASK.md + C-TASK.md (the blind reader's verdict words, the zh lang_note and
// the pairwise preference, kept verbatim) and w-packets.mjs (per-book packets on disk for reader subagents; here one sealed
// claude -p per page, through claudeCall, so the reader sees only this page's files).
/**
 * judge.mjs — blind Opus judge, page image + the arms' texts as X/Y[/Z] in a seeded order. Files only.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-ditto-restore-5274/judge.mjs P0,P3-ia,P2-ia [--conc=4]
 * Pages: the 30 zero + 5 keep pages, then 5 swap controls (seed 52741): one text replaced by another page's text of an arm.
 * Writes $JOB_SCRATCH/w/judge/<slug>.json (verdicts by label) and judge/key.json (label → arm, read only by score-judge).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRng } from '../lib/paired-stats.mjs';
import { claudeCall } from '../../batch/claude-ocr.mjs';
import { convertPaddle, envelope } from '../../lib/paddle-zh-lane.mjs';

const W = path.join(process.env.JOB_SCRATCH, 'w'); const OUT = path.join(W, process.env.JUDGE_DIR || 'judge'); fs.mkdirSync(OUT, { recursive: true });
const ARMS = process.argv[2].split(','); const CONC = Number(process.argv.find((a) => a.startsWith('--conc='))?.slice(7) || 4);
const pages = JSON.parse(fs.readFileSync(path.join(W, 'pages.json'), 'utf8'));
const LABELS = ['X', 'Y', 'Z'].slice(0, ARMS.length);
const r = makeRng(5274);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const textOf = (arm, p) => {
  if (arm === 'P0') return fs.readFileSync(path.join(W, 'p0', `${p.slug}.txt`), 'utf8');
  if (arm.startsWith('P1-')) { const c = convertPaddle(fs.readFileSync(path.join(W, 'p1', arm.slice(3), 'out', p.bid, `${p.pn}.txt`), 'utf8')); return envelope(c.body); }
  const j = JSON.parse(fs.readFileSync(path.join(W, arm, `${p.slug}.json`), 'utf8')); return j.text || '';
};
const items = pages.map((p) => ({ uid: p.slug, p, arms: ARMS, order: shuffle(ARMS) }));
const r2 = makeRng(52741); const zero = pages.filter((p) => p.set === 'zero');
for (let i = 0; i < 5; i++) {
  const p = zero[Math.floor(r2() * zero.length)]; let o; do { o = zero[Math.floor(r2() * zero.length)]; } while (o === p);
  const swapArm = ARMS[i % ARMS.length];
  items.push({ uid: `swap${i}-${p.slug}`, p, arms: ARMS, order: shuffle(ARMS), swap: { arm: swapArm, from: o.slug, other: o } });
}
const key = Object.fromEntries(items.map((x) => [x.uid, { labels: Object.fromEntries(LABELS.map((l, i) => [l, x.order[i]])), swap: x.swap ? { arm: x.swap.arm, from: x.swap.from } : null }]));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
const pairs = LABELS.flatMap((a, i) => LABELS.slice(i + 1).map((b) => `${a}${b}`));
const prompt = `You are a careful reader of Classical Chinese. You judge ${LABELS.length} transcriptions of the SAME page, labelled ${LABELS.join(', ')}, against the page image. You do not know where any of them came from; do not guess. Open ./page.jpg and ${LABELS.map((l) => `./${l}.txt`).join(', ')} with the Read tool (the only tool you may use).

The page is from a Qing court rhyme or word dictionary. Conventions: vertical columns read top to bottom, right to left. A traditional ↔ simplified or variant-form (異體字) substitution of the SAME character is minor. Added modern punctuation is minor. A different character that changes the word, a dropped or doubled column, or columns read out of order so the text runs in the wrong sequence, is material. Interlinear small-character commentary (雙行小注) dropped is an omission. In this kind of book a short thin vertical stroke in a character cell is a ditto mark standing for a character of the entry's headword: it is part of the text.

Metadata tags (<header>, <page-num> …) are part of a transcription; judge them, but layout and tag differences alone are minor.

Per transcription, a verdict:
- misleading — a reader is misled about what the page says: a meaning change (a wrong word, number, name or negation that changes the sense), an omitted passage (a line or more of the page's text missing), or another leaf's text served as this one's.
- flawed — errors, but the gist is right: spelling, single letters, punctuation, normalisation that does not change the sense.
- sound — faithful to the page.
With the verdict, list up to 5 defects: the words as transcribed (quote), what the page has (print), and material (true when it changes or drops meaning). Also not_this_leaf (true when it is another leaf's text, not a misread).
Per pair (${pairs.join(', ')}): which is better, or tie, and whether the loser's defect is material.

Reply with one JSON object and nothing else:
{${LABELS.map((l) => `"${l}":{"verdict":"misleading|flawed|sound","not_this_leaf":false,"defects":[{"quote":"…","print":"…","material":true}]}`).join(',')},${pairs.map((k) => `"${k}":{"prefer":"${k[0]}|${k[1]}|tie","loser_material":false}`).join(',')},"why":"one or two lines, quoting the decisive words"}`;
const done = (u) => fs.existsSync(path.join(OUT, `${u}.json`)) && JSON.parse(fs.readFileSync(path.join(OUT, `${u}.json`), 'utf8')).verdict;
const todo = items.filter((x) => !done(x.uid)); let i = 0, stop = null;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < todo.length && !stop) {
    const x = todo[i++];
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'zhj-'));
    fs.copyFileSync(path.join(W, 'img/ia', `${x.p.slug}.jpg`), path.join(dir, 'page.jpg'));
    x.order.forEach((arm, k) => fs.writeFileSync(path.join(dir, `${LABELS[k]}.txt`), x.swap?.arm === arm ? textOf(arm, x.swap.other) : textOf(arm, x.p)));
    let v = null, res = null;
    for (let t = 0; t < 2 && !v; t++) {
      res = await claudeCall(prompt, 'opus', dir);
      if (res.cls === 'usage_limit') { stop = res.err; break; }
      try { v = JSON.parse(String(res.text).match(/\{[\s\S]*\}/)[0]); } catch { /* retried once */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(path.join(OUT, `${x.uid}.json`), JSON.stringify({ uid: x.uid, verdict: v, model: res?.model, usage: res?.usage, secs: res?.secs, raw: v ? undefined : String(res?.text).slice(0, 1000) }, null, 1));
    console.log(x.uid, v ? LABELS.map((l) => v[l]?.verdict).join('/') : 'NO ANSWER');
  }
}));
if (stop) { console.error('STOPPED', stop); process.exit(3); }
