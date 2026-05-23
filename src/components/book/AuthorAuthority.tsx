'use client';

import { useState } from 'react';

/**
 * Surfaces the author authority record (birth/death dates, variant spellings,
 * VIAF/Wikidata/LCNAF/Wikipedia links) below the author byline. Renders only
 * when the book has an `author_entity_id` AND the linked entity has at least
 * one of dates / aliases / authority IDs.
 *
 * Requested by Paul Dijstelberge (BPH) — scholars want to see that the
 * system actually knows "Tr. Bokkalini" and "Trajano Boccalini" are the
 * same person, not just take it on faith. The full alias list (incl. non-
 * Latin scripts) lives on the dedicated /author page; this component is the
 * inline confidence signal.
 */

interface AuthorEntity {
  name?: string;
  canonical_name?: string;
  aliases?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  lcnaf_id?: string;
  gnd_id?: string;
  wikipedia_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

interface Props {
  entity: AuthorEntity;
  /** book.author — used to dedupe out the form already visible in the byline. */
  bookAuthor?: string;
}

// Skip non-Latin variants in the inline expand so the line stays readable
// for European-language scholars (the primary BPH audience). The dedicated
// /author page surfaces the full multi-script alias list.
function isLatinScript(s: string): boolean {
  return !/[֐-׿؀-ۿऀ-ॿ一-鿿぀-ヿ㐀-䶿Ͱ-ϿЀ-ӿ]/.test(s);
}

// Wikidata returns ISO dates ("1556-01-01") or year-only ("1556") or
// signed-year for BCE ("-0470"). Pull the first integer.
function formatYear(date?: string): string {
  if (!date) return '';
  const match = date.match(/-?\d{1,4}/);
  if (!match) return '';
  // Strip leading zeros but keep the sign for BCE
  const negative = match[0].startsWith('-');
  const num = match[0].replace(/^-?0+/, '') || '0';
  return negative ? `${num} BCE` : num;
}

const INLINE_ALIAS_LIMIT = 5;

export default function AuthorAuthority({ entity, bookAuthor }: Props) {
  const [expanded, setExpanded] = useState(false);

  const canonical = entity.canonical_name || entity.name;
  const birth = formatYear(entity.wikidata_birth_date);
  const death = formatYear(entity.wikidata_death_date);
  const dates = birth && death ? `${birth}–${death}` : birth ? `b. ${birth}` : death ? `d. ${death}` : '';

  // Dedupe aliases against the byline (book.author) and the entity's
  // canonical form so we don't show variants identical to what's already
  // visible. Comparison is case- and punctuation-insensitive.
  const norm = (s: string) => s.toLowerCase().replace(/[\s,.\-_'"]+/g, '');
  const seen = new Set([bookAuthor, canonical].filter(Boolean).map(s => norm(s as string)));
  const filteredAliases = (entity.aliases || [])
    .filter(a => a && isLatinScript(a))
    .filter(a => {
      const key = norm(a);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const inlineAliases = filteredAliases.slice(0, INLINE_ALIAS_LIMIT);
  const extraAliases = filteredAliases.slice(INLINE_ALIAS_LIMIT);
  const hasMore = extraAliases.length > 0;

  const authorityLinks = [
    entity.viaf_id && { label: 'VIAF', href: `https://viaf.org/viaf/${entity.viaf_id}` },
    entity.wikidata_id && { label: 'Wikidata', href: `https://www.wikidata.org/wiki/${entity.wikidata_id}` },
    entity.wikipedia_url && { label: 'Wikipedia', href: entity.wikipedia_url },
    entity.lcnaf_id && { label: 'LC', href: `https://id.loc.gov/authorities/names/${entity.lcnaf_id}.html` },
    entity.gnd_id && { label: 'GND', href: `https://d-nb.info/gnd/${entity.gnd_id}` },
  ].filter(Boolean) as { label: string; href: string }[];

  if (!dates && inlineAliases.length === 0 && authorityLinks.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 text-xs text-stone-400 leading-relaxed">
      {dates && <span>{dates}</span>}
      {dates && inlineAliases.length > 0 && <span> · </span>}
      {inlineAliases.length > 0 && (
        <>
          <span className="text-stone-500">also </span>
          {inlineAliases.map((a, i) => (
            <span key={a}>
              {i > 0 && <span className="text-stone-500">, </span>}
              {a}
            </span>
          ))}
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="ml-1 underline decoration-stone-600 underline-offset-2 hover:text-stone-200"
            >
              {expanded ? 'show less' : `+${extraAliases.length} more`}
            </button>
          )}
        </>
      )}
      {expanded && hasMore && (
        <div className="mt-1">
          {extraAliases.map((a, i) => (
            <span key={a}>
              {i > 0 && <span className="text-stone-500">, </span>}
              {a}
            </span>
          ))}
        </div>
      )}
      {authorityLinks.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {authorityLinks.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-stone-200 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
