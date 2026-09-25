// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — counts referenced pages per cell from results files; this census counts LIVE pages per catalogue stratum against references, for eval-design.md §11 (2026-09-25 snapshot, not a tool).
// Count sealed-registry pages and reference pages (refs/<slug>.txt exists) by language x period.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const refs = path.join(dir, 'refs');
function period(y) {
  if (y == null) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
const cells = new Map();
const perFile = [];
const srcByLang = new Map();
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const reg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const sp = Array.isArray(reg.spares) ? reg.spares : Object.values(reg.spares || {}).flat(); const pages = [...(reg.pages || []), ...sp];
  let refN = 0;
  for (const p of pages) {
    const hasRef = fs.existsSync(path.join(refs, p.slug + '.txt'));
    const y = typeof p.year === 'number' ? p.year : (String(p.published || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/) || [])[1];
    const per = period(y ? Number(y) : null);
    const lang = p.language || reg.stratum;
    const k = `${lang}||${per}`;
    const c = cells.get(k) || { language: lang, period: per, registry_pages: 0, reference_pages: 0, books: new Set() };
    c.registry_pages++; if (hasRef) c.reference_pages++; c.books.add(p.book_id); cells.set(k, c);
    if (hasRef) {
      refN++;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(refs, p.slug + '.json'), 'utf8'));
        const s = srcByLang.get(lang) || new Map();
        s.set(m.source || '(unstated)', (s.get(m.source || '(unstated)') || 0) + 1); srcByLang.set(lang, s);
      } catch {}
    }
  }
  perFile.push({ file: f, stratum: reg.stratum, sealed_at: reg.sealed_at, issue: reg.issue, n: reg.n, pages: reg.pages?.length, spares: reg.spares?.length, with_reference: refN, substrata: (reg.substrata || []).map(s => `${s.name}:${s.n}`).join(',') });
}
console.log('file\tstratum\tsealed\tissue\tn\tpages\tspares\twithRef\tsubstrata');
for (const r of perFile) console.log([r.file, r.stratum, (r.sealed_at || '').slice(0, 10), r.issue, r.n, r.pages, r.spares, r.with_reference, r.substrata].join('\t'));
console.log('\nlanguage\tperiod\tbooks\tregistry_pages\treference_pages');
for (const c of [...cells.values()].sort((a, b) => a.language.localeCompare(b.language) || a.period.localeCompare(b.period)))
  console.log([c.language, c.period, c.books.size, c.registry_pages, c.reference_pages].join('\t'));
console.log('\nreference sources by language');
for (const [l, s] of srcByLang) console.log(l + ': ' + [...s].map(([k, v]) => `${k}=${v}`).join(', '));
fs.writeFileSync('./refcount.json', JSON.stringify({ perFile, cells: [...cells.values()].map(c => ({ ...c, books: c.books.size })) }, null, 2));
