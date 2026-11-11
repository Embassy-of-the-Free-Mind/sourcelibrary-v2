#!/usr/bin/env node
// PRIOR ART: scripts/eval/stale-gate-6567/gate.mjs (judge-prep / score: the blind MQM judge prompt, labels shuffled per
// page, `material` = an accuracy error of major or critical severity, reply parsing). It judges a SEALED draw from its own
// pages.json; this reviews pages the #6567 run has already WRITTEN, read back live from the database, so it is a separate
// file. Its runners are reused as they are: opus.mjs (Opus via `claude -p`) and run-cli-arm.py (Gemini 3.1 Pro via `agy -p`).
//
// The 30-page convergent review of the stale-Siku retranslation (#6567), after the pilot and after the full run. $0.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/stale-retranslate-6567/review.mjs prep --name=pilot --run=stale-retranslate-6567-pilot [--n=30]
//   node scripts/eval/stale-gate-6567/opus.mjs --requests=$JOB_SCRATCH/review-pilot/judge.jsonl --out=scripts/eval/stale-retranslate-6567/reads/pilot-judge-O.jsonl --arm=O-judge --parallel=2
//   python3 scripts/eval/stale-gate-6567/run-cli-arm.py --requests=… --out=…/pilot-judge-P.jsonl --arm=P-judge --model=gemini-3.1-pro-high --job=stale-retranslate-6567 --kind=judge --tool-gate --gate-reason="…" --print-timeout=300 --parallel=2
//   node scripts/eval/stale-retranslate-6567/review.mjs score --name=pilot
//
// Draw: `--n` pages written by run(s) matching `--run` (a prefix), seeded (6567 + name), from DONE (the run's done.jsonl).
// Each page's candidates, labelled A/B[/C] in a seeded order: the NEW English (as now stored), the OLD English (the
// page_revisions snapshot the write took), and on up to 6 pages a PLANT: the new English with one number word changed.
// The judges are not told which is which, nor that a plant exists. The GO test is the NEW English's material errors per
// page, under each judge (≤ 0.5 for GO). Plants caught show that the judge reads closely enough to see such an error.
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

/** The JSON object a reply carries (gate.mjs parseReply, copied: importing gate.mjs runs its stage). */
function parseReply(text) {
  let t = String(text || '');
  const a = t.indexOf('<<<BEGIN>>>'), b = t.lastIndexOf('<<<END>>>');
  if (a >= 0 && b > a) t = t.slice(a + 11, b);
  t = t.replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const x = t.indexOf('{'), y = t.lastIndexOf('}');
  if (x < 0 || y <= x) return null;
  try { return JSON.parse(t.slice(x, y + 1)); } catch { return null; }
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const NAME = args.name || 'pilot';
const SCRATCH = path.join(process.env.JOB_SCRATCH || '/tmp', `review-${NAME}`);
const DONE = args.done || path.join(process.env.JOB_SCRATCH || '/tmp', 'run', 'done.jsonl');
const READS = path.join(HERE, 'reads');
fs.mkdirSync(SCRATCH, { recursive: true }); fs.mkdirSync(READS, { recursive: true });
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const lastRows = (f) => { const m = new Map(); for (const r of readJsonl(f)) m.set(r.uid, r); return m; };
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 6567);

const NUMS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twenty', 'thirty', 'hundred', 'thousand'];
const SWAP = { two: 'five', three: 'seven', four: 'nine', five: 'two', six: 'eight', seven: 'three', eight: 'six', nine: 'four', ten: 'forty', twenty: 'sixty', thirty: 'eighty', hundred: 'thousand', thousand: 'hundred' };
/** One number word in the body (not in tags) changed, or null when the page has none. */
function plant(text) {
  const re = new RegExp(`(?<![<\\w])\\b(${NUMS.join('|')})\\b`, 'i');
  const body = text.replace(/<(meta|summary|keywords|note|gloss)>[\s\S]*?<\/\1>/g, (m) => '\u0000'.repeat(m.length));
  const m = re.exec(body);
  if (!m) return null;
  const w = text.slice(m.index, m.index + m[1].length), to = SWAP[w.toLowerCase()];
  const cased = w[0] === w[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  return { text: text.slice(0, m.index) + cased + text.slice(m.index + w.length), from: w, to: cased, at: m.index };
}

const stage = process.argv[2];

if (stage === 'prep') {
  const { MongoClient } = await import('mongodb');
  const n = Number(args.n || 30);
  const written = readJsonl(DONE).filter((r) => r.outcome === 'written' && String(r.run).startsWith(args.run || 'stale-retranslate-6567'));
  const pick = shuffle([...written].sort((a, b) => (a.page_id < b.page_id ? -1 : 1)), makeRng(seedOf(NAME))).slice(0, n);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const tpl = fs.readFileSync(path.join(HERE, '../stale-gate-6567/prompt-judge.txt'), 'utf8');
  const reqs = [], map = [];
  let planted = 0;
  for (const [i, r] of pick.entries()) {
    const uid = `${NAME[0]}${String(i + 1).padStart(2, '0')}`;
    const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.engine.input.image_url': 1, 'translation.data': 1, 'translation.engine.run.job_id': 1 } });
    if (!String(p?.translation?.engine?.run?.job_id || '').startsWith('stale-retranslate-6567')) { console.log(`  ${r.page_id}: no longer this run's English; skipped`); continue; }
    // the snapshot writePageTranslation took right before this run's write (the English it replaced)
    const rev = await db.collection('page_revisions').find({ page_id: r.page_id, field: 'translation', created_at: { $lte: new Date(new Date(r.at).getTime() + 5000) } }).sort({ created_at: -1 }).limit(1).next();
    const oldEn = rev?.data || null;
    const img = path.join(SCRATCH, `${uid}.jpg`);
    const url = p.ocr?.engine?.input?.image_url || p.archived_photo; // image-pick-ok: the image the Paddle lane read, as the gate
    if (!fs.existsSync(img)) { const res = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!res.ok) throw new Error(`image ${r.page_id} ${res.status}`); fs.writeFileSync(img, Buffer.from(await res.arrayBuffer())); }
    const cands = [{ arm: 'new', text: p.translation.data }];
    if (oldEn && oldEn !== p.translation.data) cands.push({ arm: 'old', text: oldEn });
    const pl = planted < 6 ? plant(p.translation.data) : null;
    if (pl) { cands.push({ arm: 'plant', text: pl.text }); planted++; }
    shuffle(cands, makeRng(seedOf(uid)));
    const labels = cands.map((_, k) => 'ABC'[k]);
    map.push({ uid, page_id: r.page_id, book_id: p.book_id, page_number: p.page_number, cer: r.cer, labels: Object.fromEntries(cands.map((x, k) => [labels[k], x.arm])), plant: pl ? { from: pl.from, to: pl.to } : null, old_found: !!oldEn });
    const block = cands.map((x, k) => `\n===== CANDIDATE ${labels[k]} =====\n${x.text}\n`).join('');
    reqs.push({ uid, image: img, prompt: tpl.replace('{N}', String(cands.length)).replaceAll('{LABELS}', labels.join(', ')).replace('{READING}', p.ocr.data).replace('{CANDIDATES}', block) });
  }
  await c.close();
  fs.writeFileSync(path.join(SCRATCH, 'judge.jsonl'), reqs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(HERE, `${NAME}-map.json`), JSON.stringify({ seed: `6567+${NAME}`, run: args.run, items: map }, null, 1) + '\n');
  console.log(`${NAME}: ${reqs.length} judge requests (${planted} with a plant, ${map.filter((m) => !m.old_found).length} without the old English) → ${SCRATCH}/judge.jsonl`);
  process.exit(0);
}

if (stage === 'score') {
  const map = JSON.parse(fs.readFileSync(path.join(HERE, `${NAME}-map.json`), 'utf8')).items;
  const judges = { O: lastRows(path.join(READS, `${NAME}-judge-O.jsonl`)), P: lastRows(path.join(READS, `${NAME}-judge-P.jsonl`)) };
  const MATERIAL = (e) => ['mistranslation', 'omission', 'addition', 'untranslated'].includes(e.category) && ['major', 'critical'].includes(e.severity);
  const STYLE = (e) => ['fluency', 'terminology', 'style', 'markup'].includes(e.category);
  const norm = (s) => String(s || '').toLowerCase();
  const per = [];
  for (const m of map) {
    const row = { uid: m.uid, page_id: m.page_id, cer: m.cer };
    for (const [jn, rows] of Object.entries(judges)) {
      const r = rows.get(m.uid), j = r?.text ? parseReply(r.text) : null;
      if (!j?.candidates) { row[jn] = null; continue; }
      row[jn] = { secs: r.secs };
      for (const [lab, arm] of Object.entries(m.labels)) {
        const errs = j.candidates[lab]?.errors || [];
        if (arm === 'plant') { row[jn].plant_caught = errs.some((e) => norm(e.english).includes(norm(m.plant.to))); continue; }
        row[jn][arm] = { material: errs.filter(MATERIAL).length, minor_accuracy: errs.filter((e) => !MATERIAL(e) && !STYLE(e)).length, style: errs.filter(STYLE).length, material_spans: errs.filter(MATERIAL).map((e) => `${e.category}/${e.severity}: ${e.english} — ${e.page_says || ''}`.slice(0, 240)) };
      }
    }
    per.push(row);
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const summary = {};
  for (const jn of ['O', 'P']) {
    const xs = per.filter((r) => r[jn]);
    const paired = xs.filter((r) => r[jn].old);
    const ci = wilson(xs.filter((r) => r[jn].new.material > 0).length, xs.length);
    summary[jn] = {
      scored: xs.length, failed: per.length - xs.length,
      new_material_per_page: mean(xs.map((r) => r[jn].new.material)),
      new_pages_with_material: xs.filter((r) => r[jn].new.material > 0).length, new_pages_with_material_wilson: ci,
      new_style_per_page: mean(xs.map((r) => r[jn].new.style)),
      paired_n: paired.length, paired_new: mean(paired.map((r) => r[jn].new.material)), paired_old: mean(paired.map((r) => r[jn].old.material)),
      new_better: paired.filter((r) => r[jn].new.material < r[jn].old.material).length, new_worse: paired.filter((r) => r[jn].new.material > r[jn].old.material).length,
      plants: { carried: xs.filter((r) => r[jn].plant_caught != null).length, caught: xs.filter((r) => r[jn].plant_caught).length },
    };
  }
  const go = ['O', 'P'].every((jn) => summary[jn].scored > 0 && summary[jn].new_material_per_page <= 0.5);
  const out = { name: NAME, go, threshold: 0.5, summary, per_page: per };
  fs.writeFileSync(path.join(HERE, `${NAME}-results.json`), JSON.stringify(out, null, 1) + '\n');
  const f2 = (x) => (x == null ? '–' : x.toFixed(2));
  const L = [`| judge | scored (failed) | NEW material / page | pages with a material error | OLD material / page (paired n) | new better / worse | plants caught | NEW style / page |`, '|---|---|---|---|---|---|---|---|'];
  for (const [jn, label] of [['O', 'Opus'], ['P', 'Gemini 3.1 Pro']]) { const s = summary[jn]; L.push(`| ${label} | ${s.scored} (${s.failed}) | ${f2(s.new_material_per_page)} | ${s.new_pages_with_material}/${s.scored} (Wilson ${Math.round(100 * s.new_pages_with_material_wilson[0])}–${Math.round(100 * s.new_pages_with_material_wilson[1])}%) | ${f2(s.paired_old)} (${s.paired_n}) | ${s.new_better} / ${s.new_worse} | ${s.plants.caught}/${s.plants.carried} | ${f2(s.new_style_per_page)} |`); }
  L.push('', `GO (NEW material errors per page ≤ 0.5 under both judges): ${go ? 'YES' : 'NO'}`);
  fs.writeFileSync(path.join(HERE, `${NAME}-results.md`), L.join('\n') + '\n');
  console.log(L.join('\n'));
}
