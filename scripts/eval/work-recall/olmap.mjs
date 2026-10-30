// PRIOR ART: none — no script mapped ia_identifier to Open Library works before (git grep ol_dump) (#7761).
// ol-matches.jsonl (ocaid -> OL works) + live-books.jsonl -> map-ol.jsonl {id, key, method}
import fs from 'fs';
const [,, booksF, olF, outF] = process.argv;
const byIa = new Map();
for (const l of fs.readFileSync(booksF, 'utf8').trim().split('\n')) { const b = JSON.parse(l); if (b.ia_identifier) byIa.set(b.ia_identifier, [...(byIa.get(b.ia_identifier) || []), b.id]); }
const out = []; let noWork = 0;
for (const l of fs.readFileSync(olF, 'utf8').trim().split('\n')) { const r = JSON.parse(l); if (!r.works?.length) { noWork++; continue; }
  for (const id of byIa.get(r.ocaid) || []) for (const w of r.works) out.push({ id, key: w, method: 'ol' }); }
fs.writeFileSync(outF, out.map(o => JSON.stringify(o)).join('\n') + '\n'); console.log('rows', out.length, 'editions without a work', noWork);
