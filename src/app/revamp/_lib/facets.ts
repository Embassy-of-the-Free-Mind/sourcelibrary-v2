/**
 * Type and period, the two kinds that combine with subject, language and each other (the FAST way:
 * separate facets, each chosen on its own, a work must match every one chosen).
 * Text types are the site's existing form tags; picture types are the gallery's image types.
 * Periods are the site's existing eras, given fixed dates. Plain file: shared by server and client.
 */
export const TEXT_TYPES: Record<string, string> = {
  treatise: 'Treatise', encyclopedia: 'Encyclopaedia or compendium', commentary: 'Commentary', manual: 'Manual or recipe book',
  letters: 'Letters', poetry: 'Poetry and literature', dialogue: 'Dialogue', anthology: 'Anthology', polemic: 'Polemic',
  scripture: 'Sacred text', biography: 'Life', history: 'History or chronicle', catalog: 'Catalogue',
};
export const PICTURE_TYPES: Record<string, string> = {
  engraving: 'Engraving', woodcut: 'Woodcut', diagram: 'Diagram', emblem: 'Emblem', portrait: 'Portrait',
  frontispiece: 'Frontispiece', map: 'Map', decorative: 'Decoration', symbol: 'Symbol',
};
/** Eras with fixed dates. `to` is the first year of the next era. */
export const PERIODS: { id: string; label: string; from: number; to: number }[] = [
  { id: 'ancient', label: 'Ancient', from: -5000, to: 200 },
  { id: 'late-antique', label: 'Late Antique', from: 200, to: 700 },
  { id: 'medieval', label: 'Medieval', from: 700, to: 1400 },
  { id: 'renaissance', label: 'Renaissance', from: 1400, to: 1600 },
  { id: 'early-modern', label: 'Early modern', from: 1600, to: 1750 },
  { id: 'enlightenment', label: 'Enlightenment', from: 1750, to: 1850 },
  { id: 'modern', label: 'Modern', from: 1850, to: 3000 },
];
const yr = (y: number) => (y < 0 ? `${-y} BCE` : `${y}`);
export const periodLabel = (id: string) => {
  const p = PERIODS.find((x) => x.id === id);
  if (!p) return 'Date not recorded';
  return p.id === 'ancient' ? `${p.label}, before ${p.to} CE` : p.id === 'modern' ? `${p.label}, from ${p.from}` : `${p.label}, ${yr(p.from)} to ${yr(p.to)}`;
};
export const periodOfYear = (y?: number | null) => (typeof y === 'number' && y !== 0 ? PERIODS.find((p) => y >= p.from && y < p.to)?.id : undefined);
/** A work's periods: when it was written (its era tags), else when this copy was printed. */
export const periodsOf = (b: { era?: string[]; year?: number | null }) => (b.era?.length ? b.era : [periodOfYear(b.year)].filter(Boolean) as string[]);
