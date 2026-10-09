/**
 * One place on /explore/map = one pin, whatever the geodata called it.
 *
 * PRIOR ART: src/app/explore/map/page.tsx slimLocations() and
 * src/app/api/explore/map/city/route.ts both keyed a pin by `${city}|${country}`;
 * this replaces that key in both, so the page and the city list cannot drift.
 *
 * Why not city|country: the geocoders return whatever label Wikidata holds, so
 * the same coordinates arrived as several pins — Beijing as "China" and
 * "People's Republic of China", Königsberg as "Nazi Germany", "German Empire"
 * and "Russia", Venice as "Venice" and "Venezia" (measured 2026-10-06: 21 extra
 * pins, ~300 books split off their city). A ~10 km grid cell groups them.
 */

/** Grid key for a coordinate: 0.1° (~11 km), enough to merge spellings, not cities. */
export function mapPlaceKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

// Historical or official state names the geodata returns → the name a reader
// expects to see beside a city today.
const MODERN_COUNTRY: Record<string, string> = {
  "People's Republic of China": 'China',
  'Republic of China': 'China',
  'Nazi Germany': 'Germany',
  'German Empire': 'Germany',
  'German Democratic Republic': 'Germany',
  'West Germany': 'Germany',
  'Kingdom of Prussia': 'Germany',
  'Holy Roman Empire': 'Germany',
  'Kingdom of England': 'United Kingdom',
  'Kingdom of Great Britain': 'United Kingdom',
  'Kingdom of Scotland': 'United Kingdom',
  'Russian Empire': 'Russia',
  'Soviet Union': 'Russia',
  'Austria-Hungary': 'Austria',
  'Ottoman Empire': 'Turkey',
  'Czechoslovakia': 'Czech Republic',
  'Kingdom of the Netherlands': 'Netherlands',
  'Dutch Republic': 'Netherlands',
};

/** A country label fit to show, or null when the label names no modern country. */
export function modernCountry(label: string | null | undefined): string | null {
  if (!label) return null;
  if (MODERN_COUNTRY[label]) return MODERN_COUNTRY[label];
  // "Ancient Rome", "Qi (Huang Chao)", "Jin dynasty", a city repeated as its
  // own country ("Syracuse"): not a country a reader can place.
  if (/^ancient |dynasty|\(|^syracuse$/i.test(label)) return null;
  return label;
}
