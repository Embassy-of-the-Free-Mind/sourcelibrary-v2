#!/usr/bin/env node
// PRIOR ART: tengyur-characterize/build-packet.mjs builds review packets of whole pages; this builds per-VERSE
// packets (one Tibetan verse, every stored rendering of it in context) for #6141's verse memory.
/**
 * verse-packets.mjs — step 3 of #6141, $0, files only. Picks the top N verses by pages × divergence (with >= 3
 * renderings of the primary span) from verse-detect.mjs's output and writes drafter packets, BATCH verses each.
 *   node scripts/eval/tengyur-improve/verse-packets.mjs --work /root/timp --n 50 --batch 9 --seed 6141
 * Writes <work>/vm/selected.json and <work>/vm/packets/draft-NN.json (box only: they quote the stored English).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { rng, shuffle } from '../tengyur-characterize/common.mjs';
import { cleanBo } from './verse-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg('work', '/root/timp'), N = Number(arg('n', 50)), BATCH = Number(arg('batch', 9)), SEED = Number(arg('seed', 6141));
const MAXR = 24;
const R = rng(SEED);
const all = JSON.parse(fs.readFileSync(path.join(WORK, 'verses-all.json'), 'utf8'));
const sel = all.filter((v) => v.primary_renderings >= 3).sort((a, b) => b.score - a.score).slice(0, N);
const ids = new Set(sel.map((v) => v.vid));
const occ = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(path.join(WORK, 'occurrences.jsonl')) })) {
  const o = JSON.parse(l); if (!ids.has(o.vid) || !o.en) continue;
  const v = sel.find((x) => x.vid === o.vid); if (o.key !== v.primary_span) continue;
  (occ.get(o.vid) || occ.set(o.vid, []).get(o.vid)).push(o);
}
const pick = new Map([...occ].map(([vid, l]) => [vid, shuffle(l, R).slice(0, MAXR)]));
const needPages = new Set([...pick.values()].flat().map((o) => o.page_id));
const pages = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(path.join(WORK, 'tengyur-pages.jsonl')) })) {
  const p = JSON.parse(l); if (needPages.has(p.id)) pages.set(p.id, p);
}
const SK = { PV: 'Pramāṇavārttika (Dharmakīrti) with Manorathanandin', MMK: 'Mūlamadhyamakakārikā in the Prasannapadā (ed. La Vallée Poussin)', AK: 'Abhidharmakośa(bhāṣya)', BCA: 'Bodhicaryāvatāra with Prajñākaramati' };
const verses = sel.map((v) => {
  const span = v.primary_span.split(' / ');
  const renderings = (pick.get(v.vid) || []).map((o, i) => {
    const p = pages.get(o.page_id); const bo = cleanBo(p.bo);
    const at = bo.indexOf(span[0].split('་').slice(0, 3).join('་'));
    return { r: i + 1, page_url: `https://sourcelibrary.org/book/${o.book_id}?page=${o.pn}`, section: o.section, derge_text: o.text,
      tibetan_context: at >= 0 ? bo.slice(Math.max(0, at - 250), at + 450) : bo.slice(0, 700),
      english_before: p.en.slice(Math.max(0, o.span[0] - 300), o.span[0]), rendering: o.en, english_after: p.en.slice(o.span[1], o.span[1] + 200) };
  });
  return { vid: v.vid, pages: v.pages, divergence: v.divergence, verse_padas: v.padas, span_padas: span,
    sanskrit: v.sanskrit ? { work: v.sanskrit.work, edition: SK[v.sanskrit.work], file: `${WORK}/sanskrit/${v.sanskrit.work}.txt`, found_in_tibetan_root_text: v.sanskrit.root_text } : null,
    renderings };
});
fs.mkdirSync(path.join(WORK, 'vm/packets'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'vm/selected.json'), JSON.stringify(sel.map(({ examples, ...x }) => x), null, 1));
for (let b = 0; b * BATCH < verses.length; b++) fs.writeFileSync(path.join(WORK, `vm/packets/draft-${String(b + 1).padStart(2, '0')}.json`), JSON.stringify(verses.slice(b * BATCH, b * BATCH + BATCH), null, 1));
console.log(`${verses.length} verses, ${verses.reduce((s, v) => s + v.renderings.length, 0)} renderings, ${Math.ceil(verses.length / BATCH)} packets`);
