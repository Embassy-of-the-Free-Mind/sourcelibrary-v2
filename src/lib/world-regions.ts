/**
 * Country code -> world region, for reader geography (#8522, #8541).
 *
 * PRIOR ART: src/app/admin/ReadersMap.tsx held these lists inline; they moved
 * here so the admin map and the public /about/readers page count regions the
 * same way. No other region table exists in src/lib (git grep LATAM, 'Latin America').
 *
 * Latin America includes the Caribbean. Anything not listed below, except
 * 'unknown', is Asia.
 */
const LATAM = 'AR BO BR CL CO CR CU DO EC SV GT HN MX NI PA PY PE PR UY VE HT BZ GY SR JM TT BS BB'.split(' ');
const EUROPE = 'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK'.split(' ');
const NORTH_AMERICA = 'US CA GL BM'.split(' ');
const MIDDLE_EAST = 'AE BH IL IQ IR JO KW LB OM PS QA SA SY TR YE'.split(' ');
const OCEANIA = 'AU NZ FJ PG NC PF WS TO VU SB'.split(' ');
const AFRICA = 'DZ AO BJ BW BF BI CM CV CF TD KM CD CG CI DJ EG GQ ER ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD SZ TZ TG TN UG ZM ZW'.split(' ');

const REGIONS: [string, Set<string>][] = [
  ['North America', new Set(NORTH_AMERICA)],
  ['Latin America', new Set(LATAM)],
  ['Europe', new Set(EUROPE)],
  ['Middle East', new Set(MIDDLE_EAST)],
  ['Africa', new Set(AFRICA)],
  ['Oceania', new Set(OCEANIA)],
];

export const REGION_ORDER = ['North America', 'Europe', 'Latin America', 'Asia', 'Middle East', 'Oceania', 'Africa', 'Unknown'];

export function regionOf(cc: string): string {
  if (!cc || cc === 'unknown') return 'Unknown';
  return REGIONS.find(([, s]) => s.has(cc))?.[0] ?? 'Asia';
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
/** 'MX' -> 'Mexico'; a code Intl does not know is shown as itself. */
export function countryName(cc: string): string {
  try { return REGION_NAMES.of(cc) ?? cc; } catch { return cc; }
}
