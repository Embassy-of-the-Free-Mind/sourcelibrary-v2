// PRIOR ART: scripts/eval/tengyur-characterize/plants.mjs (#5829's planters: negation flip, agent/name swap), used
// here unchanged; this adds the two shapes #6545 also asks for (a number changed, a clause dropped) and plants
// several errors in different sentences of one text.
/**
 * stdin: JSON [{key, text, kinds: ['negation'|'name'|'number'|'clause', ...], seed}]
 * stdout: JSON [{key, text, plants: [{kind, old, new, how, dropped?}]}]  (a kind that finds no site falls back to
 * the next of negation → number → name → clause; `text` is the planted text). Nothing in the output names the plant
 * to a model: the caller keeps it in the key.
 */
import { makePlanters } from '../tengyur-characterize/plants.mjs';
import { rng, shuffle } from '../tengyur-characterize/common.mjs';

const NUMW = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve', 'twenty', 'thirty', 'forty', 'hundred', 'thousand', 'first', 'second', 'third', 'fourth', 'fifth', 'seventh'];
const SWAP = { two: 'three', three: 'five', four: 'six', five: 'seven', six: 'eight', seven: 'nine', eight: 'four', nine: 'six', ten: 'twelve', twelve: 'ten', twenty: 'forty', thirty: 'sixty', forty: 'twenty', hundred: 'thousand', thousand: 'hundred', first: 'second', second: 'third', third: 'fourth', fourth: 'fifth', fifth: 'third', seventh: 'ninth' };

function planters(R) {
  const P = makePlanters(R);
  const number = (en) => {
    for (const s of shuffle(P.bodySentences(en), R)) {
      const m = s.match(new RegExp(`\\b(${NUMW.join('|')})\\b`, 'i')) || s.match(/\b(\d{1,4})\b/);
      if (!m) continue;
      const w = m[1]; const low = w.toLowerCase();
      let rep = SWAP[low] ?? String(Number(w) + (Number(w) > 9 ? 10 : 3));
      if (/^[A-Z]/.test(w)) rep = rep[0].toUpperCase() + rep.slice(1);
      return { old: s, new: s.slice(0, m.index) + rep + s.slice(m.index + w.length), how: `${w} → ${rep}` };
    }
    return null;
  };
  const clause = (en) => {
    for (const s of shuffle(P.bodySentences(en), R)) {
      const parts = s.split(/(?<=,)\s+/);
      if (parts.length < 3) continue;
      for (const i of shuffle([...Array(parts.length - 2).keys()].map((k) => k + 1), R)) {
        const words = parts[i].split(/\s+/).length;
        if (words < 4 || words > 25) continue;
        const ns = [...parts.slice(0, i), ...parts.slice(i + 1)].join(' ');
        return { old: s, new: ns, how: 'clause dropped', dropped: parts[i] };
      }
    }
    return null;
  };
  const name = (en) => P.plantAgent(en) || null;
  return { negation: P.plantReversal, number, name, clause };
}

const input = JSON.parse(await new Promise((res) => { let d = ''; process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => res(d)); }));
const out = [];
for (const it of input) {
  const pl = planters(rng(it.seed));
  let text = it.text; const plants = [];
  for (const k of it.kinds) {
    for (const kind of [k, 'negation', 'number', 'name', 'clause']) {
      const p = pl[kind](text);
      if (!p || p.old === p.new || plants.some((q) => q.new.includes(p.old) || p.old.includes(q.new))) continue;
      const t2 = text.replace(p.old, p.new);
      if (t2 === text) continue;
      text = t2; plants.push({ kind, ...p }); break;
    }
  }
  out.push({ key: it.key, text, plants });
}
process.stdout.write(JSON.stringify(out));
