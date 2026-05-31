/**
 * Inline life-dates under the book-page author byline (e.g. "1574–1637").
 *
 * Previously this also showed the full variant-spelling list ("also Robertus de
 * Fluctibus, …") and the VIAF/Wikidata/LC/GND authority links. That was too much
 * weight at the top of the book page — especially after the thesaurus gained many
 * Latin/censor name variants (#2250). The full alias list, authority IDs, and
 * portrait now live on the dedicated /author page, which the byline links to
 * (click the author name). This keeps only the concise dates as context.
 *
 * (Original inline-authority card requested by Paul Dijstelberge / BPH as a
 * scholar confidence signal; that signal is preserved on the /author page.)
 */

interface AuthorEntity {
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

interface Props {
  entity: AuthorEntity;
}

// Wikidata returns ISO dates ("1556-01-01"), year-only ("1556"), or signed-year
// for BCE ("-0470"). Pull the first integer.
function formatYear(date?: string): string {
  if (!date) return '';
  const match = date.match(/-?\d{1,4}/);
  if (!match) return '';
  const negative = match[0].startsWith('-');
  const num = match[0].replace(/^-?0+/, '') || '0';
  return negative ? `${num} BCE` : num;
}

export default function AuthorAuthority({ entity }: Props) {
  const birth = formatYear(entity.wikidata_birth_date);
  const death = formatYear(entity.wikidata_death_date);
  const dates = birth && death ? `${birth}–${death}` : birth ? `b. ${birth}` : death ? `d. ${death}` : '';

  if (!dates) return null;

  return <div className="mt-0.5 text-xs text-stone-400 leading-relaxed">{dates}</div>;
}
