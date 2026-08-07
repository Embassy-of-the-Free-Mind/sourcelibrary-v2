/**
 * Which editions carry canonical loci, and on what evidence.
 *
 * This registry is deliberately a CURATED LIST rather than a detector.
 *
 * #3661 measured the alternative: across all 276 live Aristotle and Plato books,
 * a linear scan-page→printed-number fit classified only ~22% as usable, and it
 * scored the most valuable books WORST — a book printing Bekker numbers in the
 * margin fits at 0.009 precisely because canonical numbers do not advance at the
 * rate of pages. Any detector built on that signal would reject the best sources
 * and accept a book's own pagination as though it were a citation standard.
 *
 * Getting that wrong does not produce a missing feature. It produces a confident
 * wrong citation, which is the failure family
 * `.claude/docs/invariants/entity-page-attribution.md` exists to prevent. So a
 * book appears here only when someone has looked at its pages and can say which
 * of the two mechanisms is printing the number.
 *
 * ## Growing this list
 *
 * `scripts/maintenance/extract-locus-anchors.mjs --survey` reports candidates:
 * books whose `<page-num>` values parse as loci at a high rate. That output is a
 * SHORTLIST FOR A HUMAN, not an auto-promotion path. Read a few pages, confirm
 * the number is what you think it is, then add a row with its evidence.
 *
 * ## Fields
 *
 *   system    'bekker' | 'stephanus'
 *   kind      'pagination' — the edition's own paging IS the standard (root
 *                            editions only)
 *             'marginal'   — canonical refs printed beside the text
 *   evidence  why we believe it, in a sentence. Not decoration: this is what a
 *             later reader checks the row against.
 */

export const LOCUS_EDITIONS = [
  {
    book_id: '69937973b0a84a5763964d43',
    title: 'Aristotelis Opera, Vol. 2 (Bekker, Reimer 1831)',
    system: 'bekker',
    kind: 'pagination',
    evidence:
      'The root edition — Bekker numbers ARE this book\'s page numbers. Scan p.320 carries <page-num>1104</page-num>, p.321 1105, advancing 1:1. This is the reference frame every Aristotle citation resolves against.',
  },
  {
    book_id: '69b21d42ddb4fa7c305b4693',
    title: 'Platonis Opera Quae Extant, Vol. 2 (Stephanus 1578)',
    system: 'stephanus',
    kind: 'pagination',
    evidence:
      'The root edition — Stephanus numbers are named after this printing and are its page numbers. Scan pp.15,16,17 carry 3,4,5.',
  },
  {
    book_id: '699376d2b0a84a5763961a97',
    title: 'Platonis Opera (Burnet OCT 1902) — Republic, Timaeus, Critias',
    system: 'stephanus',
    kind: 'marginal',
    evidence:
      'Burnet prints Stephanus refs in the margin and the OCR captures them as ranges: p.122 reads "393 e - 394 d", p.123 "394 d - 395 b". Section letters run a-e, which only Stephanus does.',
  },
  {
    book_id: '69937734b0a84a57639630fa',
    title: 'Platonis Opera (Burnet OCT 1907) — Laws, Definitions',
    system: 'stephanus',
    kind: 'marginal',
    evidence: 'Same Burnet OCT convention as the 1902 volume above.',
  },
  {
    book_id: '69ae6681b3b0e7bf712d6201',
    title: 'Works of Aristotle, Vol. 2 (Oxford 1908) — Physics, De Caelo',
    system: 'bekker',
    kind: 'marginal',
    evidence:
      'The Oxford translation prints Bekker page+column in the margin: p.60 "198a", p.62 "198b, 199a". Columns are a/b only, as Bekker requires.',
  },
  {
    book_id: '69ae668db3b0e7bf712d66a9',
    title: 'Meteorologica (Oxford 1923)',
    system: 'bekker',
    kind: 'marginal',
    evidence: 'Same Oxford marginal-Bekker convention.',
  },
  {
    book_id: '69ae6694b3b0e7bf712d6885',
    title: 'Historia Animalium (Oxford 1910)',
    system: 'bekker',
    kind: 'marginal',
    evidence:
      'Same Oxford convention. Cited in #3661 as the case that proves the point: it scores fit=0.009 on a linear test and is one of the best sources in the corpus.',
  },
];

export const LOCUS_EDITION_BY_ID = new Map(LOCUS_EDITIONS.map((e) => [e.book_id, e]));
