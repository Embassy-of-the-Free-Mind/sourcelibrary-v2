#!/usr/bin/env node
// PRIOR ART: translation-vs-reference/build-packet.mjs (#5702) needs a human reference per page; the 20 dev pages
// have none, so the base choice is judged source-only (the #5274 corpus-audit stance). This builds that packet and
// scores it. It never touches the 71 test pages.
/**
 *   node dev-packet.mjs build --a qwen=<zs-qwen.jsonl> --b gemma=<zs-gemma.jsonl> --dev <dev.jsonl> --out <dir>
 *   node dev-packet.mjs score --out <dir>      (reads <dir>/verdicts.jsonl written by the judge)
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanTranslation } from './prompt.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const [, , cmd, ...argv] = process.argv;
const arg = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const OUT = arg('--out');

if (cmd === 'build') {
  const [an, af] = arg('--a').split('='), [bn, bf] = arg('--b').split('=');
  const A = new Map(readJsonl(af).map((r) => [r.id, r.text])), B = new Map(readJsonl(bf).map((r) => [r.id, r.text]));
  // Only decides which arm shows as X vs Y. The committed key.json records the assignment actually judged and
  // `score` reads that, so this generator does not affect any reported number; a rebuild gives a fresh blinding.
  const rnd = makeRng(5793);
  const items = [], key = [];
  for (const d of readJsonl(arg('--dev'))) {
    const id = `dev:${d.page_id}`;
    const flip = rnd() < 0.5;
    const [x, y] = flip ? [[bn, B.get(id)], [an, A.get(id)]] : [[an, A.get(id)], [bn, B.get(id)]];
    items.push({ item: items.length + 1, source: d.source, X: cleanTranslation(x[1]), Y: cleanTranslation(y[1]) });
    key.push({ item: items.length, X: x[0], Y: y[0], id });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'packet.jsonl'), items.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
  console.log(`${items.length} items → ${OUT}`);
} else if (cmd === 'score') {
  const key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'), 'utf8'));
  const v = new Map(readJsonl(path.join(OUT, 'verdicts.jsonl')).map((r) => [r.item, r]));
  const agg = {};
  for (const k of key) {
    const r = v.get(k.item); if (!r) continue;
    for (const lab of ['X', 'Y']) {
      const arm = k[lab]; const a = (agg[arm] ||= { n: 0, fid: [], omission: 0, untranslated: 0 });
      a.n++; a.fid.push(r[lab].fidelity); a.omission += r[lab].omission ? 1 : 0; a.untranslated += r[lab].untranslated ? 1 : 0;
    }
  }
  for (const a of Object.values(agg)) { a.mean = +(a.fid.reduce((x, y) => x + y, 0) / a.fid.length).toFixed(2); }
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(agg, null, 1));
  console.log(JSON.stringify(agg, null, 1));
}
