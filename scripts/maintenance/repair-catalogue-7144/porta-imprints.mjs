/**
 * #7144 batch 2 (#7268 lines 46–47): two Della Porta translations catalogued 1607 by `year_source: regex`, each
 * corrected from its own title page, read on the image. Input to ../repair-catalogue-7144.mjs (--plan=this file).
 *
 * PRIOR ART: scripts/maintenance/repair-catalogue-7144.mjs — the writer (backup, --revert, field_provenance,
 * sweep_log, books_catalog mirror, revalidate); this file is only its input, so a second writer is not needed.
 *
 * Checked and left alone: the two Latin copies, 1a8485e5-5331-41df-bfc1-6efd65238f55 (_id 694fe5f9f844de8615417df4)
 * and 6a26bf8b0e247ebad6ded274. Both title pages (p. 3) read "FRANCOFVRTI / Excudebat Samuel Hempelius, / Sumptibus
 * Claudij Marnij, & hæredum Ioann. Aubrij. / M. DC. VII.", so 1607 stands.
 */
export const RUN = 'repair-catalogue-7144-porta-imprints';
export const BY = 'Claude (job catalogue-followup-7144), default taken from the #7268 DECISION triage';

const ENGLISH_EV = {
  pages: [7, 9],
  as_read: 'p. 9 (letterpress title): "NATURAL MAGICK BY John Baptista Porta, A NEAPOLITANE: IN TWENTY BOOKS … LONDON, Printed for Thomas Young, and Samuel Speed; and are to be sold at the three Pigeons, and at the Angel in St. Paul\'s Church-yard. 1658."; p. 7 (engraved title): "R Gaywood fecit Lond: 1658"',
  source_record: 'https://archive.org/details/naturalmagick00port (Boston Public Library copy); the Frankfurt place and Aubry printer came from USTC 394723, a match to a Latin edition',
};
const FRENCH_EV = {
  pages: [5],
  as_read: 'p. 5: "LA MAGIE NATVRELLE, QVI EST, Les secrets & miracles de Nature, mise en quatre Liures, par Iean Baptiste Porta, Neapolitain. … Nouuellement traduitte de Latin en François. A ROVEN. Chez IEAN BERTHELIN, dans la court du Palais. M. DC. XXXI."',
  source_record: 'USTC 6812954 "Rouen, Jean Berthelin, 1631" (the imprint as printed). The stored USTC 3143570 is "Rouen, Thomas Daré, 1606", picked as the closest year to the regex 1607',
};

export const PLAN = [
  {
    id: '6953ea371479a63c11086267', evidence: ENGLISH_EV,
    set: {},
    // The edition entry in source_work_dates already reads 1658 from the engraved title; only the note about the
    // catalogue disagreeing goes stale.
    raw: { 'source_work_dates_meta.catalogue_note': '' },
    imprint: {
      published: '1658', year: 1658, year_source: 'titlepage',
      place_published: 'London', publication_place: 'London', printer: null,
    },
  },
  {
    id: '695937043b43cb6630c91c0c', evidence: FRENCH_EV,
    set: { ustc_id: 6812954 },
    raw: {
      ustc_match: {
        ustc_sn: 6812954, ustc_year: 1631, confidence: 'high', match_method: 'hand-adjudicated',
        reasoning: 'Title page p. 5: "A ROVEN. Chez IEAN BERTHELIN … M. DC. XXXI." = USTC imprint "Rouen, Jean Berthelin, 1631".',
        previous_ustc_sn: 3143570, matched_at: new Date().toISOString(), issue: '#7144',
      },
      edition_external_ids: { ustc: '6812954', ustc_scope: 'edition', ustc_reason: 'USTC year 1631 and printer agree with the title page (p. 5)' },
      source_work_dates: 'EDITION',
      'source_work_dates_meta.catalogue_note': '',
    },
    imprint: { published: '1631', year: 1631, year_source: 'titlepage', place_published: 'Rouen' },
    edition: { year: 1631, from: 1631, to: 1631, display: '1631', precision: 'exact', basis: 'titlepage', evidence: 'p. 5: "A ROVEN. Chez IEAN BERTHELIN, dans la court du Palais. M. DC. XXXI."' },
  },
];
