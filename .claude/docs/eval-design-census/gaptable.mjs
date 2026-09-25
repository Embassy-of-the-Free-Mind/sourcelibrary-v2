// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — counts referenced pages per cell from results files; this census counts LIVE pages per catalogue stratum against references, for eval-design.md §11 (2026-09-25 snapshot, not a tool).
// Gap table: every catalogue stratum (language x period) with >= 20 live books, with reference pages today,
// what directional (30 referenced books) and decision-grade (50) need, cheapest source, and cost estimate.
import fs from 'node:fs';
const strata = JSON.parse(fs.readFileSync('./strata-atlas.json', 'utf8'));
// Library-page references today (registry pages whose reference text exists), from refcount.mjs (language||period -> n)
const libRefs = {}; for (const c of JSON.parse(fs.readFileSync('./refcount.json', 'utf8')).cells) libRefs[`${c.language}||${c.period}`] = c.reference_pages;
// External references today (Wikisource-hosted scans + pinned canonical pages), from refbyfile.mjs, language||period -> n
const extRefs = {  // Wikisource-hosted scans (ws-*), no book_id
  'Latin||1500s': 10, 'Latin||1600s': 11, 'Latin||1700s': 12, 'Latin||1800s': 30, 'Latin||pre-1500': 2,
  'German||1500s': 1, 'German||1700s': 9, 'German||1800s': 20,
  'Greek||1800s': 23, 'Greek||1900+': 2,
};
const pinnedRefs = {  // ground-truth/ pinned library pages (book_id + page_number), year unrecorded -> counted on the 'unknown' row
  'Latin||unknown': 12, 'German||unknown': 7, 'Greek||unknown': 17, 'Hebrew||unknown': 4, 'Armenian||unknown': 9, 'Chinese||unknown': 6,
};
// Cheapest reference source per language, with a per-page human cost class:
//  aligned = e-text exists, align to OUR scan + QA leaf identity (~3 min/page);  transcribe-print (~20 min/page);  transcribe-ms (~45 min/page)
const SRC = {
  Latin: ['la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk)', 'aligned', 'print'],
  Chinese: ['Kanripo / CBETA / ctext (held)', 'aligned', 'print'],
  English: ['en.wikisource / Gutenberg (page-aligned via IA djvu where held)', 'aligned', 'print'],
  German: ['de.wikisource (held, 30 external pages) / Deutsches Textarchiv', 'aligned', 'print'],
  Greek: ['Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns', 'aligned', 'print'],
  French: ['fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan', 'aligned', 'print'],
  Tibetan: ['BDRC/ACIP e-texts (canonical → recitation risk); hand transcription for non-canonical', 'aligned', 'ms'],
  Italian: ['it.wikisource / Biblioteca Italiana (LiberLiber)', 'aligned', 'print'],
  Dutch: ['DBNL (rights vary) / nl.wikisource', 'aligned', 'print'],
  Sanskrit: ['GRETIL / SARIT (canonical → recitation risk); Devanagari print needs fixtures', 'aligned', 'print'],
  Russian: ['ru.wikisource (pre-1918 orthography editions)', 'aligned', 'print'],
  Hebrew: ['Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings', 'aligned', 'print'],
  Korean: ['ITKC 한국고전종합DB (hanja/hangul mixed)', 'aligned', 'print'],
  Arabic: ['OpenITI / Shamela (typeset modern → weak for manuscript); hand transcription for MS', 'aligned', 'ms'],
  Syriac: ['ETCBC Peshitta (CC BY-NC, canonical); Digital Syriac Corpus; Kraken lane already measured (#5093)', 'aligned', 'ms'],
  Armenian: ['Digilib (AUA) / hy.wikisource; pinned refs exist (9)', 'aligned', 'print'],
  Spanish: ['es.wikisource / Biblioteca Virtual Cervantes', 'aligned', 'print'],
  Japanese: ['NDL digital / Aozora (Meiji+); pre-1868 kuzushiji needs hand transcription', 'aligned', 'ms'],
  Persian: ['Ganjoor (canonical poetry → recitation risk); hand transcription', 'aligned', 'ms'],
  "Ge'ez": ['Beta maṣāḥǝft (BM) TEI; hand transcription', 'aligned', 'ms'],
  'Latin-German': ['de.wikisource + la.wikisource', 'aligned', 'print'],
  Pali: ['SuttaCentral / VRI (canonical → recitation risk)', 'aligned', 'print'],
  Sumerian: ['exclude: cuneiform tablets, transliteration not OCR; "1600s" is a museum-number artefact', 'none', 'none'],
  'Egyptian hieroglyphs': ['exclude: not an OCR lane', 'none', 'none'],
  Javanese: ['exclude for now (37 books, 467 pages)', 'none', 'none'],
  Unknown: ['classify the pages first (page-level script class), then route', 'none', 'none'],
  'Middle English': ['en.wikisource (EETS reprints) / Gutenberg', 'aligned', 'print'],
  'Classical Chinese': ['Kanripo / CBETA', 'aligned', 'print'],
  'Greek-Latin': ['Perseus + la.wikisource', 'aligned', 'print'],
  'auto-detect': ['classify the pages first', 'none', 'none'],
};
const MIN = { aligned: 3, print: 20, ms: 45 };
const DIRECTIONAL = 30, DECISION = 50;
// Model spend per referenced page: production lite + flash + 2 specialists ≈ $0.02 (flash dominates; #4925 puts 7 decisions at ≈$10)
const MODEL_PER_PAGE = 0.02;
const rows = strata.strata.filter(r => r.books >= 20).sort((a, b) => b.pages - a.pages);
const out = [];
out.push('| Language | Period (catalogue) | Live books | Live pages | Registry refs (library pages) | Pinned refs (library pages, year unrecorded) | External refs (Wikisource scans) | To directional (30) | To decision-grade (50) | Cheapest reference source | Est. cost to decision-grade |');
out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|');
let totalPagesNeeded = 0, totalHours = 0;
for (const r of rows) {
  const k = `${r.language}||${r.period}`;
  const lib = (libRefs[k] || 0) + (pinnedRefs[k] || 0), pin = pinnedRefs[k] || 0, ext = extRefs[k] || 0;
  const s = SRC[r.language] || ['(unmapped) — classify first', 'aligned', 'print'];
  const excluded = s[1] === 'none';
  // Pages that count toward a decision are LIBRARY pages (one per book); external refs are noted but do not count.
  const need30 = excluded ? '—' : Math.max(0, DIRECTIONAL - lib);
  const need50 = excluded ? '—' : Math.max(0, DECISION - lib);
  let cost = '—';
  if (!excluded) {
    const n = Math.max(0, DECISION - lib);
    // If e-text likely exists (aligned) assume 70% of draws align, 30% need transcription (print or ms)
    const hAligned = n * 0.7 * MIN.aligned / 60, hTranscribe = n * 0.3 * MIN[s[2]] / 60;
    const hours = hAligned + hTranscribe;
    const model = n * MODEL_PER_PAGE;
    totalPagesNeeded += n; totalHours += hours;
    cost = `$${model.toFixed(2)} + ${hours.toFixed(1)} h`;
  }
  out.push(`| ${r.language} | ${r.period} | ${r.books.toLocaleString('en-US')} | ${r.pages.toLocaleString('en-US')} | ${lib - pin} | ${pin} | ${ext} | ${need30} | ${need50} | ${s[0]} | ${cost} |`);
}
out.push('');
out.push(`Totals over the ${rows.length} strata: ${totalPagesNeeded} referenced library pages to bring every non-excluded stratum to decision-grade; ≈ $${(totalPagesNeeded * MODEL_PER_PAGE).toFixed(0)} model spend and ≈ ${totalHours.toFixed(0)} human hours under the cost model above.`);
fs.writeFileSync('./gap-table.md', out.join('\n'));
console.log(out.slice(0, 4).join('\n'));
console.log('rows', rows.length, 'pagesNeeded', totalPagesNeeded, 'hours', totalHours.toFixed(0));
