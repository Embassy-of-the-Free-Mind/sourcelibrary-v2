// PRIOR ART: was inline in src/app/research/canon-gap/page.tsx; moved so /research/canon-quality can chart it too.
import type { Improvement } from './diagrams';
import { experiment, type ExperimentRecord } from '@/lib/experiments-index';

// Before/after on the same pages and reference. Every figure is copied from the write-up named in
// `file` (scripts/eval/experiments/); which rows appear, and whether a change is in use, come from that
// write-up's header in the experiment index (#5939): a superseded write-up drops its row, and a row is
// in use when its write-up's status is `adopted`. `inUseVia` overrides that for a row whose change was
// adopted by a different decision than the write-up the numbers come from. `inUseNote` / `testedNote`
// are the row's status line in each case.
export type Measured = Omit<Improvement, 'inUse' | 'status' | 'source'> & {
  file: string;
  inUseNote: string;
  testedNote: string;
  inUseVia?: { inUse: boolean; why: string };
};

const MEASURED: Measured[] = [
  {
    change: 'Sanskrit, Pali, Chinese: Flash-Lite → Flash', measure: 'reversed statements per 100 pages', before: 15.4, after: 5.9, lowerBetter: true,
    inUseNote: 'in use for new translations since 4 Oct 2026', testedNote: 'tested; not adopted',
    basis: '68 pages from 68 books, against published translations (SuttaCentral, CC0; public-domain translators); two blind Claude Opus judges; 3 Oct 2026',
    file: '2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md',
  },
  {
    change: 'Tengyur: 8-page blocks → one page at a time', measure: 'pages whose English belongs to another page, per 100', before: 13.3, after: 0.9, lowerBetter: true,
    inUseNote: 'in use for the Tengyur draft', testedNote: 'tested; not adopted',
    basis: '113 pages (15 vs 1), against 84000’s published translations; two blind Claude Opus judges; 3 Oct 2026',
    file: '2026-10-03-tengyur-84000-reference-ab-5497.md',
  },
  {
    change: 'Syriac: Gemini → Kraken (Sophro Mhiro)', measure: 'line error rate, %', before: 74, after: 19, lowerBetter: true,
    inUseNote: 'in use for Syriac', testedNote: 'tested; not adopted',
    basis: '40 manuscript pages with published transcriptions (Jerusalem SMMJ 36, ÖNB Cod. Syr. 1); Gemini arms 74–79%, lower shown; 16 Sep 2026',
    file: '2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md',
  },
  {
    change: 'Blank and show-through leaves: OCR prompt v16 → v19.1', measure: 'leaves given invented text, %', before: 75, after: 30, lowerBetter: true,
    inUseNote: 'in use for new OCR since 2 Oct 2026', testedNote: 'tested; not adopted',
    basis: '69 white and show-through leaves labelled by eye before any run, three reads each, v16 run alongside as control; 2 Oct 2026',
    file: '2026-10-02-ocr-v19-1-stamps-4195.md',
  },
  {
    change: 'Sentences across a page turn: Flash-Lite → Flash', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 16, lowerBetter: true,
    inUseNote: 'in use for new translations in seven languages since 4 Oct 2026', testedNote: 'tested; not adopted',
    // The write-up's own question was the page markers (not adopted); its Flash arm is the change #5740 adopted.
    inUseVia: { inUse: true, why: 'Flash translation routing, #5740' },
    basis: '100 mid-sentence page breaks from 100 books, screened by eye; a defect counts only when both of two blind Claude Opus judges flag it; 3–4 Oct 2026',
    file: '2026-10-04-seam-markers-confirm-5678.md',
  },
  {
    change: 'Sentences across a page turn: Flash with page markers', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 11, lowerBetter: true,
    inUseNote: 'in use', testedNote: 'tested; markers added too little beyond Flash to adopt',
    inUseVia: { inUse: false, why: 'markers not adopted; Flash alone was' },
    basis: 'same 100 breaks and judges as the row above; 3–4 Oct 2026',
    file: '2026-10-04-seam-markers-confirm-5678.md',
  },
  {
    change: 'Persian manuscripts: Flash-Lite → Flash reading', measure: 'characters matching Ganjoor’s typed text, median %', before: 41, after: 70, lowerBetter: false,
    inUseNote: 'in use for Persian since 4 Oct 2026; still below the 90% needed to translate these manuscripts',
    testedNote: 'tested; still below the 90% needed to translate',
    basis: 'manuscript pages of classical poetry located in Ganjoor (9 and 13 pages); 1 Oct 2026; a small sample',
    file: '2026-10-01-persian-manuscript-ocr-flash-vs-kraken-5525.md',
  },
];

/** The chart rows: MEASURED filtered and labelled by the index. Exported for tests. */
export function improvementsFrom(rows: Measured[], lookup: (file: string) => ExperimentRecord): Improvement[] {
  return rows.flatMap((r) => {
    const e = lookup(r.file);
    if (e.status === 'superseded') return [];
    const inUse = r.inUseVia ? r.inUseVia.inUse : e.status === 'adopted';
    return [{
      change: r.change, measure: r.measure, before: r.before, after: r.after, lowerBetter: r.lowerBetter, basis: r.basis,
      inUse, status: inUse ? r.inUseNote : r.testedNote, source: e.href,
    }];
  });
}

export const IMPROVEMENTS: Improvement[] = improvementsFrom(MEASURED, (f) => experiment(f));
