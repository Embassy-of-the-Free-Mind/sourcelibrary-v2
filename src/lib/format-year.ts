/**
 * Display helper for the numeric years produced by `editionYear`.
 *
 * The corpus runs from Egyptian stelae in the third millennium BCE to modern
 * critical editions, so a raw number is not safe to print: `-1550` has to read
 * as "1550 BCE". Kept separate from `editionYear` (which parses) so callers can
 * sort on the number and format only at the edge.
 */
export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
}

/**
 * Inclusive span for a set of years, collapsing a single-year range to one
 * label. Returns null when there is nothing datable to show — callers should
 * omit the element rather than render an empty dash.
 */
export function formatYearSpan(earliest: number | null, latest: number | null): string | null {
  if (earliest === null || latest === null) return null;
  if (earliest === latest) return formatYear(earliest);
  return `${formatYear(earliest)} – ${formatYear(latest)}`;
}
