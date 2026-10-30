// PRIOR ART: scripts/eval/build-work-gold-set.mjs builds pairs from our clusters for human labels; these pairs come from an outside catalogue's groups (#7761).
// one judged pair per external group we split: A = a book in the group's largest work_id, B = a book outside it.
import fs from 'fs';
const [,, booksF, mapF, outF, label, MAX = '100000'] = process.argv;
const books = new Map(fs.readFileSync(booksF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(b => [b.id, b]));
const maps = fs.readFileSync(mapF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(m => books.has(m.id));
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const byKey = new Map(); for (const m of maps) { if (!byKey.has(m.key)) byKey.set(m.key, new Set()); byKey.get(m.key).add(m.id); }
const thin = b => ({ id: b.id, title: b.display_title && b.display_title !== b.title ? `${b.title} [display: ${b.display_title}]` : b.title, author: b.author, year: b.published ?? b.year ?? null, language: b.language, pages: b.pages_count, work_id: b.work_id });
const out = [];
for (const [k, set] of byKey) { const ids = [...set]; if (ids.length < 2) continue;
  const ws = new Map(); for (const id of ids) { const w = books.get(id).work_id || 'none:' + id; ws.set(w, [...(ws.get(w) || []), id]); }
  if (ws.size < 2) continue; const g = [...ws.values()].sort((a, b) => b.length - a.length);
  out.push({ source: label, ext_key: k, group_books: ids.length, group_work_ids: ws.size, a: thin(books.get(g[0][0])), b: thin(books.get(g[1][0])) }); }
const pick = out.sort((p, q) => hash(label + p.ext_key) - hash(label + q.ext_key)).slice(0, +MAX);
fs.writeFileSync(outF, pick.map(p => JSON.stringify(p)).join('\n') + '\n'); console.log(label, 'split groups', out.length, 'written', pick.length);
