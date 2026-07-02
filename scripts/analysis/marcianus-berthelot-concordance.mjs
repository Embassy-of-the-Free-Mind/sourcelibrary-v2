#!/usr/bin/env node
/**
 * Folio concordance: Marcianus gr. Z. 299 (the manuscript) <-> Berthelot &
 * Ruelle, "Collection des anciens alchimistes grecs", Greek text volume.
 *
 * Berthelot's edition is transcribed FROM M (Marcianus 299 is his base
 * manuscript), and prints M-folio marks throughout ("f. 93 r.", inline
 * "(f. 171 r.)", headnote "Transcrit sur M, f. 92 v."). The digitization's page
 * labels carry the SAME foliation ("Carta: 93r"), so the two lock together on
 * M's foliation. This builds that join table.
 *
 * CRITICAL — extract M-folio refs ONLY. A naive /f\. NN [rv]/ over-counts badly
 * because Berthelot's apparatus cites OTHER manuscripts ("collated with A, f.85r;
 * with K, f.1r"). We take only base-manuscript signals: inline parentheticals
 * "(f. NNr)" + explicit "M, f. NN" headnotes.
 *
 * See .claude/docs/edition-facsimile-pairing.md for the design rationale.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/marcianus-berthelot-concordance.mjs
 * Output: scripts/output/marcianus-berthelot-concordance.json
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';

const MARC = '6a45298cc6d95bc278fbc8c3';               // Marcianus gr. Z. 299
const BERT = '6994383a6879ff0184cb803a';               // Berthelot Vols 2-3 (Greek text)
const OUT = 'scripts/output/marcianus-berthelot-concordance.json';

// M-only folio extractors (see header):
const RE_M = /(?:sur\s+)?\bM\s*[²2]?\s*,?\s*f\.?\s*([0-9]{1,3})\s*,?\s*([rv])\b/gi; // "M, f. 92 v", "sur M, f. 92v", "M2 f. 115r"
const RE_PAR = /\(\s*f\.?\s*([0-9]{1,3})\s*,?\s*([rv])\.?\s*\)/gi;                        // inline "(f. 171 r.)" = base ms (M)

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await c.connect();
  const db = c.db('bookstore');

  // 1) Marcianus folio ("Carta: NNr") -> page
  const mpages = await db.collection('pages')
    .find({ book_id: MARC }, { projection: { page_number: 1, id: 1, page_label: 1 } }).toArray();
  const folioToMarc = {};
  for (const p of mpages) {
    const m = /Carta:\s*([0-9]+)\s*([rv])/i.exec(p.page_label || '');
    if (m) folioToMarc[m[1] + m[2].toLowerCase()] = { pn: p.page_number, id: p.id };
  }

  // 2) Berthelot page -> M folio refs (M-only)
  const bpages = await db.collection('pages')
    .find({ book_id: BERT, 'ocr.data': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const folioToBert = {};
  let nM = 0, nPar = 0;
  for (const p of bpages) {
    const txt = p.ocr?.data || '';
    const add = (f) => { (folioToBert[f] = folioToBert[f] || new Set()).add(p.page_number); };
    let m;
    RE_M.lastIndex = 0; while ((m = RE_M.exec(txt))) { add(m[1] + m[2].toLowerCase()); nM++; }
    RE_PAR.lastIndex = 0; while ((m = RE_PAR.exec(txt))) { add(m[1] + m[2].toLowerCase()); nPar++; }
  }

  // 3) Join
  const rows = Object.keys(folioToBert).map((f) => {
    const marc = folioToMarc[f];
    return { folio: f, marc_page: marc?.pn ?? null, marc_id: marc?.id ?? null, bert_pages: [...folioToBert[f]].sort((a, b) => a - b) };
  }).sort((a, b) => parseInt(a.folio) - parseInt(b.folio) || a.folio.localeCompare(b.folio));
  const aligned = rows.filter((r) => r.marc_page != null);

  console.log(`M-folio refs: explicit-M=${nM} parenthetical=${nPar} | distinct M folios=${rows.length}`);
  console.log(`aligned to a Marcianus page: ${aligned.length}/${rows.length}`);
  console.log('anchor checks (should be non-null and consistent):');
  for (const f of ['92v', '93r', '170r', '171r']) {
    const r = rows.find((x) => x.folio === f);
    console.log(`  f.${f}: ${r ? `Marc p${r.marc_page} <-> Bert ${r.bert_pages.join(',')}` : 'NOT referenced'}`);
  }

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    note: 'M-folio concordance (M-only refs: explicit-M + inline parentheticals). bert_pages may include multiple contexts; the running-sequence page is the transcription, others are apparatus cross-refs.',
    marcianus_book: MARC, berthelot_book: BERT,
    folios_referenced: rows.length, folios_aligned: aligned.length, rows,
  }, null, 1));
  console.log(`\nsaved -> ${OUT}`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
