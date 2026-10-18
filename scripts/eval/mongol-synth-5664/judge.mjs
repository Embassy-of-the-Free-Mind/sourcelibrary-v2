#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/mongol-argon-probe-5664.mjs (judgePrompt and the sealed `claude -p` call — copied and
 * changed: that judge read an English translation of a whole page; this one reads the model's Mongolian Unicode
 * for one column, with no translation step, as #6813 proposed). scripts/batch/claude-ocr.mjs (claudeEnv: strip
 * ANTHROPIC_API_KEY so `claude -p` uses the subscription, #6553).
 *
 * The frozen meaning check for the synthetic-trained Mongolian Kanjur reader (#5664). Preregistered in
 * scripts/eval/experiments/2026-10-18-mongol-synth-prereg-5664.md BEFORE any trained model was read.
 *
 *   meaning   each column's Unicode read beside the Derge Tibetan window of the same passage; and, in the same
 *             calls, shuffled in, the same read beside ANOTHER text's window (the control). Up to 10 pairs a call.
 *   calib     judge sanity: the catalogue's own Unicode title beside its text's Derge opening (must match), and
 *             beside another text's opening (must not).
 *   names     each name unit's read (every column of the text's first two sides) beside the expected Sanskrit,
 *             Tibetan and Mongolian titles; control: another unit's titles.
 *   score     tallies verdicts -> score.json
 *
 *   node scripts/eval/mongol-synth-5664/judge.mjs <stage> --eval DIR --reads reads-<tag>.jsonl --out DIR
 *
 * Writes files only. Opus via the Claude subscription ($0); no Gemini, no Mongo.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';

const STAGE = process.argv[2];
const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const EVAL = arg('eval');
const OUT = arg('out');
const READS = arg('reads');
const PER_CALL = Number(arg('per-call', 5));
const PAR = Number(arg('parallel', 2));
fs.mkdirSync(OUT, { recursive: true });

function claudeEnv() {
  const e = { ...process.env };
  delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN;
  return e;
}
function opus(prompt) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/claude', ['-p', prompt, '--model', 'opus', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'],
      { cwd: OUT, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = '';
      try { text = JSON.parse(out).result || ''; } catch { text = out; }
      resolve({ code, text, err: err.slice(-500) });
    });
  });
}
// deterministic shuffle (mulberry32)
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, seed) { const r = rng(seed); const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const readsById = () => Object.fromEntries(fs.readFileSync(READS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));

const MEANING_RUBRIC = `You are checking machine readings of the Mongolian Kanjur (Beijing woodblock, 1718-20): Classical Mongolian
translations of Tibetan canonical texts. Each item below gives (A) a passage of the Derge Tibetan and (B) a short
string that a model produced, in Unicode Mongolian script, from ONE printed column (roughly 4-10 words). Spelling
may be non-standard: o/u, ö/ü, t/d, q/γ, k/g are often merged by the print, and suffixes may be joined or split.
Read (B) as Classical Mongolian and decide whether it is a reading of some stretch of (A).

Judge MEANING only. Stock phrases that occur everywhere in the canon (homage formulas, "bodhisattva mahāsattva",
"the Blessed One said", "thus", "all rejoiced", lists of the perfections) do NOT count on their own: a match needs
specific content (a name, number, distinctive term or image, or a distinctive sequence of two or more content
words) that corresponds, in order, to something specific in (A).

Verdicts:
- match: (B) reads as Classical Mongolian and most of its content words correspond, in order, to a specific stretch of (A).
- partial: at least one specific content element corresponds to (A), but much of (B) does not, or is garbled.
- no: (B) is readable Mongolian but its specific content is not in (A), or it holds only stock phrases.
- unreadable: (B) is empty, not Mongolian, a loop or repetition, or letters that do not form Mongolian words.`;

function meaningPrompt(batch) {
  const items = batch.map((b, i) => `### Item ${i + 1}  (id ${b.qid})\n(A) Tibetan, Derge:\n${b.tibetan}\n\n(B) Model reading (Mongolian):\n${(b.mongolian || '').trim() || '(empty)'}\n`).join('\n');
  return `${MEANING_RUBRIC}

${items}
Answer ONLY with one JSON line per item, between marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"id": "<id>", "verdict": "match|partial|no|unreadable", "gloss": "<your English rendering of (B), short>", "why": "<the specific content that agrees or not>"}`;
}

function namesPrompt(batch) {
  const items = batch.map((b, i) => `### Item ${i + 1}  (id ${b.qid})
Expected titles of the text that should begin on these two pages:
- Sanskrit: ${b.titles.skt}
- Tibetan (Wylie): ${b.titles.tib}
- Mongolian (transliteration): ${b.titles.mong || '(not given)'}
Model reading, every column of the two pages in order (Mongolian Unicode; Sanskrit and Tibetan names may be
written in Galik letters U+1880-18AA or in ordinary Mongolian letters):
${(b.mongolian || '').trim() || '(empty)'}
`).join('\n');
  return `You are checking machine readings of the Mongolian Kanjur (Beijing woodblock, 1718-20). A Kanjur text opens with
its title in the language of India (Sanskrit, transcribed), in Tibetan (transcribed), and in Mongolian. For each item,
decide whether each expected title can be recognised in the model's reading. Spelling in the print merges o/u, ö/ü,
t/d, q/γ, k/g; Sanskrit and Tibetan are transcribed loosely. "yes" = most of that title's words are recognisable in
order; "partly" = at least one distinctive word of it (not generic: not just ārya, sūtra, nāma, mahāyāna, qutuγ-tu,
sudur, neretü, yeke kölgen) is recognisable; "no" otherwise.

${items}
Answer ONLY with one JSON line per item, between marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"id": "<id>", "sanskrit": "yes|partly|no", "tibetan": "yes|partly|no", "mongolian": "yes|partly|no", "found": "<the words you recognised, as read>"}`;
}

function parseLines(text) {
  const m = /<<<BEGIN>>>([\s\S]*?)<<<END>>>/.exec(text || '');
  const body = m ? m[1] : text || '';
  return body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function runBatches(qs, mkPrompt, outFile) {
  const done = fs.existsSync(outFile) ? Object.fromEntries(fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.qid, r])) : {};
  const todo = qs.filter((q) => !done[q.qid]);
  const batches = [];
  for (let i = 0; i < todo.length; i += PER_CALL) batches.push(todo.slice(i, i + PER_CALL));
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const b = batches[next++];
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await opus(mkPrompt(b));
        const got = Object.fromEntries(parseLines(r.text).map((x) => [x.id, x]));
        const ok = b.filter((q) => got[q.qid]);
        for (const q of ok) fs.appendFileSync(outFile, JSON.stringify({ qid: q.qid, ...q.meta, ...got[q.qid], id: undefined }) + '\n');
        process.stderr.write(`batch ${b[0].qid}..: ${ok.length}/${b.length} (exit ${r.code})\n`);
        if (ok.length === b.length) break;
        b.splice(0, b.length, ...b.filter((q) => !got[q.qid]));
      }
    }
  }
  await Promise.all(Array.from({ length: PAR }, worker));
}

if (STAGE === 'meaning' || STAGE === 'calib') {
  const meaning = JSON.parse(fs.readFileSync(path.join(EVAL, 'meaning.json'), 'utf8'));
  const qs = [];
  if (STAGE === 'meaning') {
    const reads = readsById();
    for (const m of meaning) {
      const r = reads[m.id];
      if (!r) continue;
      qs.push({ qid: `${m.id}|real`, tibetan: m.tibetan, mongolian: r.text, meta: { item: m.id, kind: 'real' } });
      qs.push({ qid: `${m.id}|control`, tibetan: m.control.tibetan, mongolian: r.text, meta: { item: m.id, kind: 'control', control_from: m.control.from } });
    }
  } else {
    meaning.forEach((m, i) => {
      if (!m.calib?.mongolian) return;
      const o = meaning[(i + 15) % meaning.length];
      qs.push({ qid: `${m.id}|calib-real`, tibetan: m.calib.tibetan, mongolian: m.calib.mongolian, meta: { item: m.id, kind: 'calib-real' } });
      qs.push({ qid: `${m.id}|calib-control`, tibetan: o.calib.tibetan, mongolian: m.calib.mongolian, meta: { item: m.id, kind: 'calib-control' } });
    });
  }
  // short ids so the judge cannot read real/control from them
  const sh = shuffle(qs, 5664).map((q, i) => ({ ...q, qid: `q${String(i + 1).padStart(3, '0')}`, meta: { ...q.meta, key: q.qid } }));
  await runBatches(sh, meaningPrompt, path.join(OUT, `judge-${STAGE}.jsonl`));
} else if (STAGE === 'names') {
  const units = JSON.parse(fs.readFileSync(path.join(EVAL, 'names.json'), 'utf8'));
  const reads = readsById();
  const qs = [];
  for (const u of units) {
    const text = u.columns.map((c) => reads[c]?.text || '').join('\n');
    qs.push({ qid: `${u.unit}|real`, titles: u.titles, mongolian: text, meta: { item: u.unit, kind: 'real' } });
    qs.push({ qid: `${u.unit}|control`, titles: u.control.titles, mongolian: text, meta: { item: u.unit, kind: 'control' } });
  }
  const sh = shuffle(qs, 5665).map((q, i) => ({ ...q, qid: `n${String(i + 1).padStart(3, '0')}`, meta: { ...q.meta, key: q.qid } }));
  await runBatches(sh, namesPrompt, path.join(OUT, 'judge-names.jsonl'));
} else if (STAGE === 'score') {
  const rd = (f) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const tally = (rows, kind, field = 'verdict') => {
    const r = rows.filter((x) => x.kind === kind); const c = {};
    for (const x of r) c[x[field]] = (c[x[field]] || 0) + 1;
    return { n: r.length, ...c };
  };
  const m = rd('judge-meaning.jsonl'); const cal = rd('judge-calib.jsonl'); const nm = rd('judge-names.jsonl');
  const real = tally(m, 'real'); const ctl = tally(m, 'control');
  const score = {
    meaning: { real, control: ctl, match_rate: real.n ? (real.match || 0) / real.n : null, control_match_rate: ctl.n ? (ctl.match || 0) / ctl.n : null },
    calib: { real: tally(cal, 'calib-real'), control: tally(cal, 'calib-control') },
    names: ['sanskrit', 'tibetan', 'mongolian'].reduce((o, f) => ({ ...o, [f]: { real: tally(nm, 'real', f), control: tally(nm, 'control', f) } }), {}),
  };
  score.meaning.bar = { match_rate_min: 0.6, control_match_rate_max: 0.1 };
  score.meaning.passes = score.meaning.match_rate !== null && score.meaning.match_rate >= 0.6 && score.meaning.control_match_rate <= 0.1;
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(score, null, 1));
  console.log(JSON.stringify(score, null, 1));
} else {
  console.error('stage: meaning | calib | names | score'); process.exit(2);
}
