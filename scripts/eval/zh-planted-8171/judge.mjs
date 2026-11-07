// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (blind Opus judge reading arms against a page image: here the judge
// reads English against two TEXT readings, no image) and zh-punct-8140 on PR #8146 (no judge: P is exact). Neither
// shows a judge two planted readings in random order. claudeCall and the ledger/caps come from ./calls.mjs.
/**
 * #8171 task T judge. One `claude -p --model opus` call per passage (text only, no tools). The judge sees the passage
 * with every edit site written as ⟦k: <reading 1> | <reading 2>⟧ (one character of context each side, the two readings
 * in seeded order: it cannot tell which was planted), and one to three English translations labelled T1..T3 in seeded
 * order. Per translation and site: which reading the English renders (1, 2, neither, unclear), and whether the English
 * (or a note in it) flags the place as odd, corrupt or variant.
 *
 *   node --env-file=… scripts/eval/zh-planted-8171/judge.mjs --priv=DIR --kind=edited|baseline|wrong [--only=subset|nonsubset] [--conc=3]
 *
 * kind=edited:   the edited passage's sites; English from G-T-edited (subset passages: also G2-T-edited, O-T-edited).
 * kind=baseline: the same sites; English from G-T-orig (it renders the ORIGINAL at every site).
 * kind=wrong:    6 seeded passages; English from G-T-edited of ANOTHER seeded passage (truth: neither).
 * Writes <priv>/judge/<kind>/<slug>.json { slug, kind, order: {site: [r1,r2]}, labels: {T1: arm}, parsed, raw }.
 */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { claudeCall, setLedger, used } from './calls.mjs';
import { makeRng } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = argOf('priv'); setLedger(path.join(PRIV, 'calls.jsonl'));
const KIND = argOf('kind', 'edited'), ONLY = argOf('only', 'all'), CONC = +argOf('conc', 3);
const OUT = path.join(PRIV, 'judge', KIND); fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(here, 'sample.json'), 'utf8'));
const seedOf = (s) => parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const plant = (slug) => JSON.parse(fs.readFileSync(path.join(PRIV, 'plant', `${slug}.json`), 'utf8'));
const english = (dir, slug) => { const f = path.join(PRIV, 'out', dir, `${slug}.json`); if (!fs.existsSync(f)) return null; const r = JSON.parse(fs.readFileSync(f, 'utf8')); return r.answer || null; };

/** The passage (edited text) with each site shown as two readings in seeded order. Returns { text, order }. */
export function markedPassage(rec) {
  const rng = makeRng(seedOf(`judge-order:${rec.slug}`));
  const c = [...rec.edited]; let out = ''; let i = 0; const order = {};
  rec.edits.forEach((e, k) => {
    const L = e.lenEdited ?? [...e.after].length;
    const pre = c[e.pos - 1] ?? '', post = c[e.pos + L] ?? '';
    const edited = pre + e.after + post, orig = pre + e.before + post;
    const pair = rng() < 0.5 ? [edited, orig] : [orig, edited];
    order[k + 1] = { r1: pair[0] === edited ? 'edited' : 'orig', r2: pair[1] === edited ? 'edited' : 'orig' };
    out += c.slice(i, Math.max(0, e.pos - 1)).join('') + `⟦${k + 1}: ${pair[0]} | ${pair[1]}⟧`;
    i = e.pos + L + 1;
  });
  out += c.slice(i).join('');
  return { text: out, order };
}

function prompt(marked, nSites, trans) {
  const ts = trans.map((t, k) => `=== T${k + 1} ===\n${t}`).join('\n\n');
  return `You are checking English translations of a classical Chinese passage against the Chinese.

At ${nSites} places the Chinese is shown as two alternative readings, written ⟦k: reading 1 | reading 2⟧ (each reading includes one character of context on either side; an empty-looking difference means one reading lacks a character such as 不). The two readings differ in meaning: a negation present or absent, 有 versus 無, a different number, or a different name.

For each translation and each place k, decide which reading the English renders:
- "1" if the English clearly renders reading 1,
- "2" if it clearly renders reading 2,
- "neither" if the English renders neither (it says something else there, or omits the place, or is a translation of different text),
- "unclear" if you cannot tell.
Also say whether that translation draws attention to that place as odd, corrupt, a variant or an emendation (in the text, a bracket or a note): "flag": true or false.

Judge only what the English says. Do not judge which reading is correct or better.

Chinese:
${marked}

${ts}

Answer with JSON only, no prose, in this shape:
{"T1": {"1": {"reading": "1", "flag": false}, "2": {...}}, "T2": {...}}`;
}

function parse(text) {
  const m = String(text).match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const subset = new Set(sample.passages.filter((p) => p.subset).map((p) => p.slug));
let jobs = [];
if (KIND === 'edited') {
  for (const p of sample.passages) {
    if (ONLY === 'subset' && !subset.has(p.slug)) continue;
    if (ONLY === 'nonsubset' && subset.has(p.slug)) continue;
    const arms = subset.has(p.slug) ? ['G', 'G2', 'O'] : ['G'];
    jobs.push({ slug: p.slug, src: p.slug, arms: arms.map((a) => ({ arm: a, dir: `${a}-T-edited` })) });
  }
} else if (KIND === 'baseline') {
  for (const p of sample.passages.filter((x) => x.baseline)) jobs.push({ slug: p.slug, src: p.slug, arms: [{ arm: 'G', dir: 'G-T-orig' }] });
} else if (KIND === 'wrong') {
  const rng = makeRng(seedOf('judge-wrong:8171'));
  const all = sample.passages.map((p) => p.slug).map((s) => [rng(), s]).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  for (let k = 0; k < 6; k++) jobs.push({ slug: all[k], src: all[k + 6], arms: [{ arm: 'G', dir: 'G-T-edited' }] });
}

let stop = null;
async function one(j) {
  const f = path.join(OUT, `${j.slug}.json`);
  if (fs.existsSync(f) || stop) return;
  const rec = plant(j.slug);
  const items = j.arms.map((a) => ({ ...a, en: english(a.dir, j.src) }));
  if (items.some((x) => !x.en)) { console.log(`${j.slug} SKIP missing English ${items.filter((x) => !x.en).map((x) => x.arm)}`); return; }
  const rng = makeRng(seedOf(`judge-arms:${j.slug}:${KIND}`));
  const shuffled = items.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const labels = Object.fromEntries(shuffled.map((x, k) => [`T${k + 1}`, x.arm]));
  const { text, order } = markedPassage(rec);
  let r;
  try { r = await claudeCall(prompt(text, rec.edits.length, shuffled.map((x) => x.en)), { what: `judge-${KIND}:${j.slug}` }); } catch (e) { stop = e.message; return; }
  if (r.cls === 'quota') { stop = `quota at ${j.slug}`; return; }
  const parsed = parse(r.text);
  fs.writeFileSync(f, JSON.stringify({ slug: j.slug, src: j.src, kind: KIND, order, labels, parsed, raw: r.text, cls: r.cls, model: r.model, seconds: r.seconds }));
  console.log(`${j.slug} ${parsed ? 'ok' : 'UNPARSED ' + r.cls} ${r.seconds.toFixed(0)}s`);
}
const q = [...jobs];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? `STOPPED: ${stop}` : `done judge-${KIND} (${jobs.length}); calls used ${JSON.stringify(used())}`);
