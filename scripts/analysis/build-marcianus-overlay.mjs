#!/usr/bin/env node
/**
 * Build the app-consumable Marcianus 299 <-> Berthelot reading-overlay table.
 *
 * Merges the two analysis artifacts into a single static JSON the Next.js reader
 * imports at build time (no runtime DB round-trip for the join itself; only the
 * aligned Berthelot page TEXT is fetched from Mongo per request):
 *   - scripts/output/marcianus-berthelot-concordance.json  (folio -> marc/bert pages)
 *   - scripts/output/marcianus-ocr-confidence.json          (self-agreement + coverage)
 *
 * The "primary transcription page" for a folio is taken from the confidence
 * artifact's `bert` field — the best-coverage candidate among the folio's
 * referenced Berthelot pages, which self-selects the running-sequence
 * transcription page over apparatus/intro cross-refs (see the doc's "multi-page
 * rows" gotcha). Output is keyed by Marcianus page_number, with marc_id echoed
 * so the reader can index by either.
 *
 * This is a NON-DESTRUCTIVE overlay: it never touches pages.ocr.data /
 * pages.translation.data. See .claude/docs/edition-facsimile-pairing.md.
 *
 * Usage:
 *   node scripts/analysis/marcianus-berthelot-concordance.mjs   # run first
 *   node scripts/analysis/marcianus-ocr-confidence.mjs          # then this
 *   node scripts/analysis/build-marcianus-overlay.mjs
 * Output: src/data/marcianus-berthelot-overlay.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CONC = 'scripts/output/marcianus-berthelot-concordance.json';
const CONF = 'scripts/output/marcianus-ocr-confidence.json';
const OUT = 'src/data/marcianus-berthelot-overlay.json';

const conc = JSON.parse(readFileSync(CONC, 'utf8'));
const conf = JSON.parse(readFileSync(CONF, 'utf8'));

const confByPn = new Map(conf.ocr_vs_berthelot.map((r) => [r.pn, r]));
const selfByPn = new Map(conf.self_agreement.map((r) => [r.pn, r.dice]));

const byMarcPage = {};
let aligned = 0;
for (const row of conc.rows) {
  if (row.marc_page == null) continue;
  const cf = confByPn.get(row.marc_page);
  // primary transcription page: confidence's best-coverage candidate, else the
  // lowest referenced Berthelot page as a fallback.
  const bertPrimary = cf?.bert ?? row.bert_pages[0] ?? null;
  if (bertPrimary == null) continue;
  aligned++;
  byMarcPage[row.marc_page] = {
    folio: row.folio,
    marc_id: row.marc_id,
    bert_page: bertPrimary,
    bert_pages: row.bert_pages,
    self: cf?.self ?? selfByPn.get(row.marc_page) ?? null,   // pass1-vs-pass2 Dice (0..1)
    cover: cf?.cover ?? null,                                 // OCR-in-Berthelot coverage (0..1) — LOWER BOUND
  };
}

mkdirSync('src/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({
  note: 'Non-destructive reading overlay: Marcianus gr. Z. 299 folios paired to Berthelot & Ruelle (Greek text vol) page-for-page. by_marc_page keyed by Marcianus page_number. bert_page = primary transcription page (best-coverage candidate). self = pass1-vs-pass2 OCR Dice (stability). cover = OCR-in-Berthelot token coverage — a NOISY LOWER BOUND, never an accuracy rate. See .claude/docs/edition-facsimile-pairing.md.',
  marcianus_book: conc.marcianus_book,
  berthelot_book: conc.berthelot_book,
  berthelot_citation: 'Berthelot & Ruelle, Collection des anciens alchimistes grecs (1887–88)',
  work_id: 'local:corpus-alchemicorum-graecorum',
  stats: {
    folios_aligned: aligned,
    self_agreement_mean: conf.self_agreement.length
      ? conf.self_agreement.reduce((s, r) => s + r.dice, 0) / conf.self_agreement.length : null,
    pearson_self_vs_coverage: conf.pearson_self_vs_coverage ?? null,
  },
  by_marc_page: byMarcPage,
}, null, 1));

console.log(`overlay: ${aligned} aligned folios -> ${OUT}`);
