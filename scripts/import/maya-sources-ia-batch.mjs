#!/usr/bin/env node
/**
 * Maya primary sources — standard IA items, imported HIDDEN via /api/import/ia
 * (the route sets hidden:true/visible:false; QA → visible per import-workflow.md).
 *
 * Context: the Spanish-editions push (#4079/#4080) for a Maya-focused reader.
 * Already held (not re-imported): Brasseur 1861 Popol Vuh (K'iche'/French),
 * Gordon 1913 facsimile of the Chilam Balam of Chumayel, Brinton's Annals of
 * the Cakchiquels. The Ximénez manuscript (Ayer MS 1515) is a loose-JPEG IA
 * item and goes through scripts/import/popol-wuj-ximenez-direct.mjs instead.
 *
 *   node --env-file=.env.production.local scripts/import/maya-sources-ia-batch.mjs [--commit]
 */
const COMMIT = process.argv.includes('--commit');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }
const BASE = 'https://sourcelibrary.org/api/import/ia';

const BOOKS = [
  // Scherzer's editio princeps of Ximénez's Spanish Popol Vuh — the first printed Popol Vuh (Vienna 1857). LoC scan.
  { id: 'lashistoriasdelo00sche', title: 'Las historias del origen de los indios de esta provincia de Guatemala', author: 'Francisco Ximénez; ed. Carl Scherzer', year: 1857, lang: 'Spanish' },
  // Chilam Balam de Kaua — Yucatec Maya manuscript book, 1824 copy.
  { id: 'libro-de-chilam-balam-de-kaua', title: 'Libro de Chilam Balam de Kaua', author: 'Anonymous Yucatec Maya scribes', year: 1824, lang: 'Yucatec Maya' },
  // Brinton's 1882 essay introducing the Chilam Balam books to scholarship.
  { id: 'booksofchilanbal00brin', title: 'The Books of Chilan Balam: the prophetic and historic records of the Mayas of Yucatan', author: 'Daniel G. Brinton', year: 1882, lang: 'English' },
];

async function importOne(b, attempt = 1) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ ia_identifier: b.id, title: b.title, author: b.author, year: b.year, original_language: b.lang }),
      signal: AbortSignal.timeout(150000),
    });
    const data = await res.json();
    if (res.ok && data.success) return { id: b.id, ok: true, pages: data.pagesCreated, bookId: data.bookId };
    if (attempt < 3 && /timed out|MongoNetwork|ECONN/i.test(JSON.stringify(data))) {
      await new Promise((r) => setTimeout(r, 4000));
      return importOne(b, attempt + 1);
    }
    return { id: b.id, ok: false, status: res.status, err: data.error || data.details || JSON.stringify(data).slice(0, 160) };
  } catch (e) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 4000)); return importOne(b, attempt + 1); }
    return { id: b.id, ok: false, err: e.message };
  }
}

console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${BOOKS.length} Maya sources`);
if (!COMMIT) { BOOKS.forEach((b) => console.log(`  · ${b.id.padEnd(34)} ${b.title.slice(0, 60)}`)); process.exit(0); }
for (const b of BOOKS) {
  const r = await importOne(b);
  console.log(r.ok ? `  ✓ ${b.id} → book ${r.bookId} (${r.pages} pages) https://sourcelibrary.org/book/${r.bookId}` : `  ✗ ${b.id} ${r.status || ''} ${r.err}`);
}
