// PRIOR ART: scripts/eval/work-resolver-probe.mjs flags suspect pairs from our own titles; this reads an OUTSIDE catalogue's work key instead (#7761).
// usage: node agree.mjs <live-books.jsonl> <mapping.jsonl {id, key, method}> <label> [outPairs.jsonl]
import fs from 'fs';
const [,, booksF, mapF, label, outF] = process.argv;
const books = new Map(fs.readFileSync(booksF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(b => [b.id, b]));
const maps = fs.readFileSync(mapF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(m => books.has(m.id));
const wsize = new Map(); for (const b of books.values()) if (b.work_id) wsize.set(b.work_id, (wsize.get(b.work_id) || 0) + 1);
const byKey = new Map(); for (const m of maps) { if (!byKey.has(m.key)) byKey.set(m.key, []); byKey.get(m.key).push(m); }
const keyOf = new Map(); for (const m of maps) { if (!keyOf.has(m.id)) keyOf.set(m.id, new Set()); keyOf.get(m.id).add(m.key); }
let groups2 = 0, split = 0, pairsAll = 0, pairsLinked = 0, booksMissing = 0; const splitPairs = [];
for (const [k, ms] of byKey) {
  const ids = [...new Set(ms.map(m => m.id))]; if (ids.length < 2) continue; groups2++;
  const ws = new Map(); for (const id of ids) { const w = books.get(id).work_id || ('none:' + id); ws.set(w, [...(ws.get(w) || []), id]); }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { pairsAll++; const a = books.get(ids[i]), b = books.get(ids[j]); if (a.work_id && a.work_id === b.work_id) pairsLinked++; else splitPairs.push({ key: k, a: ids[i], b: ids[j], method: ms.find(m => m.id === ids[i]).method + '/' + ms.find(m => m.id === ids[j]).method }); }
  if (ws.size > 1) { split++; const largest = Math.max(...[...ws.values()].map(v => v.length)); booksMissing += ids.length - largest; }
}
// reverse: our multi-book clusters whose mapped members carry disjoint ext keys
const byW = new Map(); for (const id of keyOf.keys()) { const w = books.get(id).work_id; if (w && wsize.get(w) > 1) byW.set(w, [...(byW.get(w) || []), id]); }
let wChecked = 0, wDisjoint = 0; const overPairs = [];
for (const [w, ids] of byW) { if (ids.length < 2) continue; wChecked++;
  let disjoint = false; for (let i = 0; i < ids.length && !disjoint; i++) for (let j = i + 1; j < ids.length; j++) { const A = keyOf.get(ids[i]), B = keyOf.get(ids[j]); if (![...A].some(x => B.has(x))) { disjoint = true; overPairs.push({ work_id: w, a: ids[i], b: ids[j] }); break; } }
  if (disjoint) wDisjoint++; }
const r = { label, mapped_live_books: keyOf.size, ext_keys: byKey.size, ext_groups_ge2: groups2, ext_groups_we_split: split, books_we_would_join: booksMissing, pairs: pairsAll, pairs_we_link: pairsLinked, pair_recall: +(pairsLinked / pairsAll).toFixed(3), our_multi_clusters_checked: wChecked, our_clusters_ext_disjoint: wDisjoint };
console.log(JSON.stringify(r));
if (outF) fs.writeFileSync(outF, [...splitPairs.map(p => JSON.stringify({ side: 'missed', ...p })), ...overPairs.map(p => JSON.stringify({ side: 'over', ...p }))].join('\n') + '\n');
