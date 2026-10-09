// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
import fs from 'node:fs';
import { norm, scoreRead } from './score-lib.mjs';
const slots = JSON.parse(fs.readFileSync('slots.json', 'utf8'));
const gt = Object.fromEntries(fs.readFileSync('gt-eye.jsonl', 'utf8').trim().split('\n').map(JSON.parse).map((g) => [g.id, g]));
const T = JSON.parse(fs.readFileSync('texts.json', 'utf8'));
// add the by-eye slot found while reading (print line 2 of vol II p300)
slots.push({ id: 'd68', kind: 'disputed', book_id: '6a30825e675ed2bdbe36f107', page: 300, page_id: '6a30825e675ed2bdbe36f233', flash: 'कारणभेदप्रतिनियमान्न', lite: 'कारणभेदाप्रतिनियमान्न', src: 'by-eye (missed by detector)' });
const S = slots.filter((s) => gt[s.id]?.print).map((s) => ({ ...s, ...gt[s.id] }));
let bad = 0;
for (const s of S) {
  const t = T.find((x) => x.page_id === s.page_id); const ref = norm(t.flash);
  const core = norm(s.core || s.print);
  for (const alt of [s.flash, s.lite]) if (norm(alt) !== core && norm(alt).includes(core)) { console.log('AMBIG core in wrong variant', s.id); bad++; }
  const res = {};
  for (const k of ['lite', 'flash', 'pro']) res[k] = scoreRead(ref, t[k], s);
  const expect = { lite: norm(s.lite).includes(core), flash: norm(s.flash).includes(core) };
  const flag = res.lite.right !== expect.lite || res.flash.right !== expect.flash ? ' <-- MISMATCH' : '';
  if (flag) bad++;
  console.log(s.id, 'L', +res.lite.right, 'F', +res.flash.right, 'P', +res.pro.right, '| pro span', res.pro.span.slice(0, 40), flag);
}
fs.writeFileSync('slots-final.json', JSON.stringify(S, null, 1));
console.log('slots', S.length, 'problems', bad);
