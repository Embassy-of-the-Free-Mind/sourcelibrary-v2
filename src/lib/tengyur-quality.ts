/**
 * What we measured about each Derge Tengyur section, for the reader's draft line and
 * /research/canon-quality (#6120).
 *
 * PRIOR ART: src/lib/text-provenance.ts `isUnreviewedMachineTranslation` says THAT a page is an
 * unreviewed draft; this says how good its section measured and what goes wrong there. The numbers
 * live in src/data/tengyur-section-quality.json, generated from the #5829 results by
 * scripts/eval/tengyur-characterize/build-disclosure.mjs — never type a rate here.
 *
 * The section comes from the book's title ("བསྟན་འགྱུར། སྡེ་དགེ། <section>། <letter> (Derge Tengyur,
 * vol. N)"), read with the same Tibetan-word table the #5829 sampler used, carried in the data file.
 */
import data from '@/data/tengyur-section-quality.json';
import type { ReaderStrings } from '@/lib/reader-strings';

export type TengyurErrorKind = 'reversal' | 'agent' | 'term' | 'omission' | 'addition' | 'structure' | 'gloss';

export interface TengyurSectionQuality {
  corpus_pages: number;
  volumes: number;
  /** Sample pages the reviewers read in this section. */
  n: number;
  /** n ≥ min_pages: the section has a rate of its own. */
  rated: boolean;
  light?: number;
  work?: number;
  specialist?: number;
  light_ci?: number[];
  /** Reversal + wrong speaker/agent findings per 100 pages, either reviewer, unadjusted. */
  rev_agent_per100?: number;
  rev_agent_ci?: number[];
  term_per100?: number;
  /** Most frequent error kinds first. */
  top_kinds?: string[];
  /** Pages using a Pali offence-class name (corpus-wide detector). */
  pali_pages: number;
}

export const TENGYUR_QUALITY = data as Omit<typeof data, 'sections' | 'section_words'> & {
  sections: Record<string, TengyurSectionQuality>;
  section_words: Record<string, string>;
};

export const TENGYUR_METHOD_HREF = '/research/canon-quality#tengyur-sections';

/** The Derge Tengyur section a book belongs to, or null for any other book (the Kangyur included). */
export function tengyurSection(book: { title?: string | null } | null | undefined): string | null {
  const parts = (book?.title || '').split('།').map((s) => s.trim());
  if (parts[0] !== 'བསྟན་འགྱུར' || parts[1] !== 'སྡེ་དགེ') return null;
  const seg = parts[2] || '';
  for (const [word, section] of Object.entries(TENGYUR_QUALITY.section_words)) {
    if (seg.startsWith(word)) return section;
  }
  return null;
}

export function tengyurSectionQuality(section: string): TengyurSectionQuality | null {
  return TENGYUR_QUALITY.sections[section] ?? null;
}

/**
 * The two kinds named in a section's note: the commonest, leaving out reversal and agent, which the
 * note already counts.
 */
export function namedKinds(q: TengyurSectionQuality): TengyurErrorKind[] {
  return (q.top_kinds ?? [])
    .filter((k) => k !== 'reversal' && k !== 'agent')
    .slice(0, 2) as TengyurErrorKind[];
}

/** "4 Oct 2026" from the data file's ISO date, in the reader's locale. */
function measuredLabel(locale: string): string {
  return new Date(`${TENGYUR_QUALITY.measured}T12:00:00Z`).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * The one- or two-sentence note for a Tengyur book's draft line, or null for any other book.
 * `t` is the reader's `tengyurNote` strings for the current locale.
 */
export function tengyurNoteSentences(
  book: { title?: string | null } | null | undefined,
  t: ReaderStrings['tengyurNote'],
  locale: string,
): string[] | null {
  const section = tengyurSection(book);
  if (!section) return null;
  const q = tengyurSectionQuality(section);
  const name = t.sectionNames[section] ?? section;
  const date = measuredLabel(locale);
  const r = Math.round;
  if (!q || !q.rated || q.light == null || q.rev_agent_per100 == null) {
    const s = TENGYUR_QUALITY.sample;
    return [t.tooFew({ section: name, n: q?.n ?? 0, of: s.n, date, light: r(s.light), revAgent: r(s.rev_agent_per100_adjusted) })];
  }
  const kinds = namedKinds(q).map((k) =>
    k === 'term' && section === 'Vinaya' ? t.vinayaTerms(r(TENGYUR_QUALITY.defects.vinaya_pali_pct)) : t.kinds[k]);
  return [
    t.rated({ section: name, n: q.n, date, light: r(q.light), work: r(q.work ?? 0), specialist: r(q.specialist ?? 0) }),
    // Pramāṇa: the opponent-voice error the reviewers and the spot check named (#5829 Results 2, 5).
    t.faults({ kinds, revAgent: r(q.rev_agent_per100), voice: section === 'Pramāṇa' }),
  ];
}
