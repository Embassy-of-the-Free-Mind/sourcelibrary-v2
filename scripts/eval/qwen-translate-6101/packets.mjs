// PRIOR ART: scripts/eval/pro-translate-6545/build-packet.py (blind shuffled-label packets, 3 items per part, a key
// file kept apart from the judge) — same shape, in node so the production sanitizer runs on the Qwen outputs.
//
// Build the blind judge packets for the #6101 Qwen translation eval (PREREGISTRATION-qwen-translate-6101.md).
//   node scripts/eval/qwen-translate-6101/packets.mjs --dir=$JOB_SCRATCH --round=1
//     round 1: A, Q1, Q2, Q3 on the stored source, all 57 pages, passes J1 and J2
//   node scripts/eval/qwen-translate-6101/packets.mjs --dir=$JOB_SCRATCH --round=2 --best=q1-qwen3-32b-awq
//     round 2: A, best Q (stored source), best Q (P1s source), the 40 zh pages, passes J1 and J2
// Writes $DIR/judge/r<round>/{PROMPT.md,in-J<p>-NN.jsonl} and $DIR/judge/r<round>/key.json (not for the judge).
import fs from 'fs';
import path from 'path';
import { sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const DIR = arg('dir'); const ROUND = Number(arg('round', '1')); const BEST = arg('best');
const PER = 3;
const HERE = path.dirname(new URL(import.meta.url).pathname);
export const ARMS = { Q1: 'q1-qwen3-32b-awq', Q2: 'q2-qwen3-14b-awq', Q3: 'q3-qwen3.6-27b-awq' };

// What production would store: the empty <think></think> a non-thinking Qwen reply can open with is not text.
export const clean = t => sanitizeTranslationTags(String(t || '').replace(/^\s*<think>\s*<\/think>\s*/, '').trim());
export function loadArm(dir, tag, file = 'eval.jsonl') {
  const m = new Map();
  for (const l of fs.readFileSync(path.join(dir, 'gpu', `out-${tag}`, file), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); if (r.key.includes('#p1#') && !r.key.endsWith('#p1#0')) continue;
    m.set(r.key.replace(/#p1#0$/, ''), r);
  }
  return m;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const set = JSON.parse(fs.readFileSync(path.join(DIR, 'set', 'set.json'), 'utf8')).items;
  let cands;   // name -> Map(id -> text)
  if (ROUND === 1) {
    cands = { A: new Map(set.map(s => [s.id, s.A.text])) };
    for (const [k, tag] of Object.entries(ARMS)) cands[k] = new Map([...loadArm(DIR, tag)].map(([id, r]) => [id, r.text != null ? clean(r.text) : '']));
  } else {
    if (!BEST) throw new Error('--best=<arm tag> required for round 2');
    cands = { A: new Map(set.map(s => [s.id, s.A.text])),
      Qbest: new Map([...loadArm(DIR, BEST)].map(([id, r]) => [id, clean(r.text)])),
      Qbest_p1: new Map([...loadArm(DIR, BEST, 'thru.jsonl')].map(([id, r]) => [id, clean(r.text)])) };
  }
  const items = ROUND === 1 ? set : set.filter(s => s.stratum === 'zh');
  const out = path.join(DIR, 'judge', `r${ROUND}`); fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'JUDGE-PROMPT.md'), path.join(out, 'PROMPT.md'));
  const key = {};
  for (const pass of [1, 2]) {
    const rng = makeRng(6101 * 10 + ROUND * 2 + pass);
    const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const lines = shuf(items).map(s => {
      const names = shuf(Object.keys(cands)); const translations = {}; const k = {};
      names.forEach((n, i) => { translations[`T${i + 1}`] = cands[n].get(s.id) ?? ''; k[`T${i + 1}`] = n; });
      key[`J${pass}|${s.id}`] = k;
      return JSON.stringify({ id: s.id, book: `${s.title} (${s.published || 'n.d.'})`, source: s.source_text,
        image: path.join(DIR, 'set', 'img-j', `${s.id}.jpg`), translations });
    });
    for (let i = 0; i * PER < lines.length; i++)
      fs.writeFileSync(path.join(out, `in-J${pass}-${String(i).padStart(2, '0')}.jsonl`), lines.slice(i * PER, (i + 1) * PER).join('\n') + '\n');
  }
  fs.writeFileSync(path.join(DIR, 'judge', `key-r${ROUND}.json`), JSON.stringify(key));
  console.log(`round ${ROUND}: ${items.length} pages × 2 passes, ${Object.keys(cands).length} candidates, parts ${fs.readdirSync(out).filter(f => f.startsWith('in-')).length}; empty candidates ${Object.values(cands).reduce((n, m) => n + items.filter(s => !m.get(s.id)).length, 0)}`);
}
