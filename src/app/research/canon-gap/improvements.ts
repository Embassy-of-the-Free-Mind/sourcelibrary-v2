// PRIOR ART: was inline in src/app/research/canon-gap/page.tsx; moved so /research/canon-quality can chart it too.
import type { Improvement } from './diagrams';

// Before/after on the same pages and reference. Every figure is copied from the write-up in `source`:
// an experiment file pinned to the commit it was read at, or, where the write-up is not on main yet,
// the issue comment that reports the run. inUse = adopted in a production lane.
const EXP = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/88b09e0084cbd9dc9c025cecec53e2a2430c8973/scripts/eval/experiments/';
export const IMPROVEMENTS: Improvement[] = [
  {
    change: 'Sanskrit, Pali, Chinese: Flash-Lite → Flash', measure: 'reversed statements per 100 pages', before: 15.4, after: 5.9, lowerBetter: true,
    inUse: true, status: 'in use for new translations since 4 Oct 2026',
    basis: '68 pages from 68 books, against published translations (SuttaCentral, CC0; public-domain translators); two blind Claude Opus judges; 3 Oct 2026',
    source: `${EXP}2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md`,
  },
  {
    change: 'Tengyur: 8-page blocks → one page at a time', measure: 'pages whose English belongs to another page, per 100', before: 13.3, after: 0.9, lowerBetter: true,
    inUse: true, status: 'in use for the Tengyur draft',
    basis: '113 pages (15 vs 1), against 84000’s published translations; two blind Claude Opus judges; 3 Oct 2026',
    source: `${EXP}2026-10-03-tengyur-84000-reference-ab-5497.md`,
  },
  {
    change: 'Syriac: Gemini → Kraken (Sophro Mhiro)', measure: 'line error rate, %', before: 74, after: 19, lowerBetter: true,
    inUse: true, status: 'in use for Syriac',
    basis: '40 manuscript pages with published transcriptions (Jerusalem SMMJ 36, ÖNB Cod. Syr. 1); Gemini arms 74–79%, lower shown; 16 Sep 2026',
    source: `${EXP}2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md`,
  },
  {
    change: 'Blank and show-through leaves: OCR prompt v16 → v19.1', measure: 'leaves given invented text, %', before: 75, after: 30, lowerBetter: true,
    inUse: true, status: 'in use for new OCR since 2 Oct 2026',
    basis: '69 white and show-through leaves labelled by eye before any run, three reads each, v16 run alongside as control; 2 Oct 2026',
    source: `${EXP}2026-10-02-ocr-v19-1-stamps-4195.md`,
  },
  {
    change: 'Sentences across a page turn: Flash-Lite → Flash', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 16, lowerBetter: true,
    inUse: true, status: 'in use for new translations in seven languages since 4 Oct 2026',
    basis: '100 mid-sentence page breaks from 100 books, screened by eye; a defect counts only when both of two blind Claude Opus judges flag it; 3–4 Oct 2026',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5678#issuecomment-5974324959',
  },
  {
    change: 'Sentences across a page turn: Flash with page markers', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 11, lowerBetter: true,
    inUse: false, status: 'tested; markers added too little beyond Flash to adopt',
    basis: 'same 100 breaks and judges as the row above; 3–4 Oct 2026',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5678#issuecomment-5974324959',
  },
  {
    change: 'Persian manuscripts: Flash-Lite → Flash reading', measure: 'characters matching Ganjoor’s typed text, median %', before: 41, after: 70, lowerBetter: false,
    inUse: false, status: 'tested; still below the 90% needed to translate',
    basis: 'manuscript pages of classical poetry located in Ganjoor (9 and 13 pages); 1 Oct 2026; a small sample',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5525#issuecomment-5936907070',
  },
];
