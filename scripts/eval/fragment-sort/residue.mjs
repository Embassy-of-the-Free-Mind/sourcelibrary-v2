// PRIOR ART: none — looked in scripts/eval/INDEX.md and scripts/eval/lib/; a one-off dump of classify.mjs's unmatched rows for reading by eye (#7065).
// Join classify.mjs output back to the fetched originals and print each unmatched passage with ~500 characters of
// the ORIGINAL-language OCR around the name, for reading by eye. Usage: node residue.mjs <cls.jsonl> <orig.jsonl> <44|47> > residue.md
import fs from 'node:fs';
const [CLS, ORIG, FIG] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const orig = new Map(rd(ORIG).map((r) => [`${r.id}:${r.p}`, r]));
const NAME = FIG == 44 ? /philola|φιλολα|filola/i : /archyt|ἀρχύτ|αρχυτ|architas|archita/i;
const seen = new Set();
for (const c of rd(CLS).filter((c) => c.cls === 'unmatched')) {
  const k = `${c.id}:${c.p}`; if (seen.has(k)) continue; seen.add(k);
  const o = orig.get(k);
  const t = (o?.ocr || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const i = t.search(NAME);
  console.log(`### ${c.y} ${c.a} — ${c.t}\nhttps://sourcelibrary.org/book/${c.id}?page=${c.p}  ${c.ref || ''}\nEN: ${c.s.slice(0, 400)}\nORIG: ${i < 0 ? '(name not found in OCR) ' + t.slice(0, 300) : t.slice(Math.max(0, i - 250), i + 450)}\n`);
}
