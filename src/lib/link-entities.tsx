import React from 'react';
import Link from 'next/link';

interface Entity {
  term: string;
  type: 'person' | 'place' | 'concept';
}

const TYPE_CLASSES: Record<string, string> = {
  person: 'text-accent-rust hover:underline',
  place: 'text-accent-sage-dark hover:underline',
  concept: 'text-accent-violet hover:underline',
};

/**
 * Auto-link entity names (people, places, concepts) within prose text
 * to their encyclopedia pages. Matches longest terms first to avoid
 * partial matches. Case-insensitive matching, preserves original casing.
 */
export function linkEntities(
  text: string,
  entities: Entity[],
): React.ReactNode {
  if (!entities.length || !text) return text;

  // Sort longest first to avoid partial matches (e.g. "John Dee" before "John")
  const sorted = [...entities].sort((a, b) => b.term.length - a.term.length);

  // Only match terms >= 4 chars to avoid false positives
  const candidates = sorted.filter(e => e.term.length >= 4);
  if (!candidates.length) return text;

  const matches: { start: number; end: number; term: string; type: string }[] = [];
  const usedRanges: [number, number][] = [];

  for (const entity of candidates) {
    // Escape regex special chars
    const escaped = entity.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary matching — match whole words only
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Skip if overlapping with an already-matched range
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, term: match[0], type: entity.type });
        usedRanges.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;

  // Sort by position for sequential rendering
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;

  for (const m of matches) {
    if (m.start > lastIdx) parts.push(text.slice(lastIdx, m.start));
    parts.push(
      <Link
        key={`${m.term}-${m.start}`}
        href={`/encyclopedia/${encodeURIComponent(m.term)}`}
        className={TYPE_CLASSES[m.type] || 'hover:underline'}
      >
        {m.term}
      </Link>
    );
    lastIdx = m.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts}</>;
}

/**
 * Build entity list from a book's index data for use with linkEntities().
 */
export function buildEntityList(index?: {
  people?: Array<{ term: string }>;
  places?: Array<{ term: string }>;
  concepts?: Array<{ term: string }>;
}): Entity[] {
  if (!index) return [];
  const entities: Entity[] = [];
  for (const p of index.people || []) entities.push({ term: p.term, type: 'person' });
  for (const p of index.places || []) entities.push({ term: p.term, type: 'place' });
  for (const c of index.concepts || []) entities.push({ term: c.term, type: 'concept' });
  return entities;
}
