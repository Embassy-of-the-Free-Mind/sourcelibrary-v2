#!/usr/bin/env node
/**
 * Geocode place_of_publication strings to lat/lng coordinates.
 *
 * 1. Collect all distinct place strings from place_of_publication AND place_published
 * 2. Query Wikidata for coordinates (batch via SPARQL)
 * 3. Build city→coords lookup and cache in system_config
 * 4. Write locations[] array to books
 *
 * 5. (#6022) For books still without a publication dot: the `publisher` field,
 *    and opt-in lanes for USTC, Internet Archive imprints and title-page OCR.
 *    See the "#6022" section below.
 *
 * Usage:
 *   node scripts/enrichment/geocode-publication-places.mjs [--dry-run] [--rebuild-cache]
 *        [--ustc] [--ia] [--title-pages]      add lanes to the default run
 *        [--only=ustc,publisher,ia,title-pages]  run just these (skip the field lane)
 *        [--limit=N] [--dump=matches.jsonl] [--ia-cache=path] [--verbose]
 *
 * GitHub issues: #724, #6022
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD_CACHE = process.argv.includes('--rebuild-cache');
const FIX_OVERRIDES = process.argv.includes('--fix-overrides');

/**
 * Manual overrides for cities where Wikidata disambiguation fails.
 * Wikidata often returns small US/Canadian towns instead of the historical cities.
 */
const MANUAL_OVERRIDES = {
  'Calcutta':     { city: 'Calcutta', lat: 22.5726, lng: 88.3639, country: 'India', wikidata_id: 'Q1348' },
  'Bombay':       { city: 'Bombay', lat: 19.0760, lng: 72.8777, country: 'India', wikidata_id: 'Q1156' },
  'Cambridge':    { city: 'Cambridge', lat: 52.2053, lng: 0.1218, country: 'United Kingdom', wikidata_id: 'Q350' },
  'Breslau':      { city: 'Breslau', lat: 51.1079, lng: 17.0385, country: 'Poland', wikidata_id: 'Q1799' },
  'Cracow':       { city: 'Cracow', lat: 50.0647, lng: 19.9450, country: 'Poland', wikidata_id: 'Q31487' },
  'Krakow':       { city: 'Krakow', lat: 50.0647, lng: 19.9450, country: 'Poland', wikidata_id: 'Q31487' },
  'Louvain':      { city: 'Louvain', lat: 50.8798, lng: 4.7005, country: 'Belgium', wikidata_id: 'Q118958' },
  'Palmyra':      { city: 'Palmyra', lat: 34.5520, lng: 38.2668, country: 'Syria', wikidata_id: 'Q39454' },
  'New York':     { city: 'New York', lat: 40.7128, lng: -74.0060, country: 'United States', wikidata_id: 'Q60' },
  // Cambridge, Massachusetts is actually correct for modern academic publishers
  'Cambridge, Massachusetts': { city: 'Cambridge, MA', lat: 42.3736, lng: -71.1097, country: 'United States', wikidata_id: 'Q49111' },
  'Rheims':       { city: 'Rheims', lat: 49.2583, lng: 3.5752, country: 'France', wikidata_id: 'Q41876' },
  'Königsberg':   { city: 'Königsberg', lat: 54.7104, lng: 20.4522, country: 'Russia', wikidata_id: 'Q1773' },
  'Girard':       null, // Small US town, not a historical publishing center — skip
  // 2026-10-06 map review: early imprints resolved to small namesakes. "Strassburg"
  // landed on Straßburg in Carinthia (48 books of 1500s Strasbourg imprints).
  'Strassburg':   { city: 'Strasbourg', lat: 48.5734, lng: 7.7521, country: 'France', wikidata_id: 'Q6602' },
  'Straßburg':    { city: 'Strasbourg', lat: 48.5734, lng: 7.7521, country: 'France', wikidata_id: 'Q6602' },
  'Strasburg':    { city: 'Strasbourg', lat: 48.5734, lng: 7.7521, country: 'France', wikidata_id: 'Q6602' },
  'Dresden':      { city: 'Dresden', lat: 51.0504, lng: 13.7373, country: 'Germany', wikidata_id: 'Q1731' },
  'Gera':         { city: 'Gera', lat: 50.8776, lng: 12.0821, country: 'Germany', wikidata_id: 'Q3150' },
  'Lübeck':       { city: 'Lübeck', lat: 53.8655, lng: 10.6866, country: 'Germany', wikidata_id: 'Q2843' },
  'Lubeck':       { city: 'Lübeck', lat: 53.8655, lng: 10.6866, country: 'Germany', wikidata_id: 'Q2843' },
  'Palermo':      { city: 'Palermo', lat: 38.1157, lng: 13.3615, country: 'Italy', wikidata_id: 'Q2656' },
  'Salamanca':    { city: 'Salamanca', lat: 40.9701, lng: -5.6635, country: 'Spain', wikidata_id: 'Q15695' },
  'Valencia':     { city: 'Valencia', lat: 39.4699, lng: -0.3763, country: 'Spain', wikidata_id: 'Q8818' },
  'Toledo':       { city: 'Toledo', lat: 39.8628, lng: -4.0273, country: 'Spain', wikidata_id: 'Q5836' },
  'Petersburg':   { city: 'Saint Petersburg', lat: 59.9311, lng: 30.3609, country: 'Russia', wikidata_id: 'Q656' },
  // The cache held Washington State's centroid (47.5, -120.5) for imprints that mean D.C.
  'Washington':   { city: 'Washington', lat: 38.9072, lng: -77.0369, country: 'United States', wikidata_id: 'Q61' },
  // #6022 USTC places Wikidata's label search put on a namesake.
  'Gent':         { city: 'Ghent', lat: 51.0543, lng: 3.7174, country: 'Belgium', wikidata_id: 'Q1296' },
  'Ghent':        { city: 'Ghent', lat: 51.0543, lng: 3.7174, country: 'Belgium', wikidata_id: 'Q1296' },
  'Brugge':       { city: 'Bruges', lat: 51.2093, lng: 3.2247, country: 'Belgium', wikidata_id: 'Q12994' },
  'Bruges':       { city: 'Bruges', lat: 51.2093, lng: 3.2247, country: 'Belgium', wikidata_id: 'Q12994' },
  'Westminster':  { city: 'Westminster', lat: 51.4975, lng: -0.1357, country: 'United Kingdom', wikidata_id: 'Q179351' },
  // Saur's Germantown (Pennsylvania); the cache held Germantown, Maryland.
  'Germantown':   { city: 'Germantown', lat: 40.0359, lng: -75.1716, country: 'United States', wikidata_id: 'Q3374424' },
  'Den Bosch':    { city: "'s-Hertogenbosch", lat: 51.6978, lng: 5.3037, country: 'Netherlands', wikidata_id: 'Q30985' },
  'Burgdorf':     { city: 'Burgdorf', lat: 47.0567, lng: 7.6276, country: 'Switzerland', wikidata_id: 'Q68118' },
};

/**
 * Old-spelling / variant → modern label that Wikidata's English label index
 * knows. Only for forms that fail to resolve as written (verified empirically).
 */
const ARCHAIC_NORMALIZE = {
  leyden: 'Leiden', leiden: 'Leiden',
  haerlem: 'Haarlem',
  neuremberg: 'Nuremberg', nuremberg: 'Nuremberg', nurnberg: 'Nuremberg', nürnberg: 'Nuremberg',
  wittemberg: 'Wittenberg',
  francfort: 'Frankfurt', franckfurt: 'Frankfurt', franckfort: 'Frankfurt',
  coln: 'Cologne', colln: 'Cologne', cölln: 'Cologne', cöln: 'Cologne', keulen: 'Cologne',
  edimbourg: 'Edinburgh', edimburgh: 'Edinburgh',
  liegnitz: 'Legnica', brieg: 'Brzeg', breslau: 'Wrocław', wroclaw: 'Wrocław',
  wittemberga: 'Wittenberg', argentorati: 'Strasbourg', argentina: 'Strasbourg',
  lugduni: 'Lyon', lutetiae: 'Paris', basileae: 'Basel', venetiis: 'Venice',
  köln: 'Cologne', munchen: 'Munich', münchen: 'Munich',
  strassbourg: 'Strasbourg', strassburg: 'Strasbourg', straßburg: 'Strasbourg',
  stpetersburg: 'Saint Petersburg', sintpetersburg: 'Saint Petersburg', leningrad: 'Saint Petersburg',
  pressburg: 'Bratislava', dantzig: 'Gdańsk', gdansk: 'Gdańsk',
  parijs: 'Paris', londen: 'London', weenen: 'Vienna', wien: 'Vienna',
  freyberg: 'Freiberg', buedingen: 'Büdingen', antwerpen: 'Antwerp',
  // #6022: vernacular forms (USTC records, Italian/French imprints) → the label
  // most existing publication dots already use, so the map groups them on one pin.
  venezia: 'Venice', venetia: 'Venice', venetie: 'Venice', vinegia: 'Venice', venise: 'Venice', venedig: 'Venice',
  roma: 'Rome', rom: 'Rome', firenze: 'Florence', fiorenza: 'Florence', florenz: 'Florence',
  genève: 'Geneva', geneve: 'Geneva', genf: 'Geneva', milano: 'Milan', mailand: 'Milan',
  napoli: 'Naples', neapel: 'Naples', padova: 'Padua', denhaag: 'The Hague', lahaye: 'The Hague', sgravenhage: 'The Hague',
  frankfurtammain: 'Frankfurt', frankfurtam: 'Frankfurt', franckfurtammayn: 'Frankfurt',
  lyons: 'Lyon', louvain: 'Leuven', leide: 'Leiden', frankfort: 'Frankfurt', hongkong: 'Hong Kong', torino: 'Turin', prag: 'Prague', praha: 'Prague',
  kobenhavn: 'Copenhagen', københavn: 'Copenhagen', kiøbenhavn: 'Copenhagen', kjøbenhavn: 'Copenhagen',
  lisboa: 'Lisbon', sevilla: 'Seville', bruxelles: 'Brussels', brussel: 'Brussels', mantova: 'Mantua',
  genova: 'Genoa', zurich: 'Zurich', zürich: 'Zurich', tubingen: 'Tübingen', tuebingen: 'Tübingen',
  gottingen: 'Göttingen', goettingen: 'Göttingen', amsteldam: 'Amsterdam', berlijn: 'Berlin',
  // #6022: Latin locatives, the form every early-modern imprint uses. Leiden is
  // "Lugduni Batavorum"; bare "Lugduni" stays Lyon (above).
  lipsiae: 'Leipzig', lipsiæ: 'Leipzig', jenae: 'Jena', ienae: 'Jena', jenæ: 'Jena', ienæ: 'Jena',
  helmstadii: 'Helmstedt', helmaestadii: 'Helmstedt', helmestadii: 'Helmstedt', helmstadi: 'Helmstedt',
  wittebergae: 'Wittenberg', witebergae: 'Wittenberg', vitebergae: 'Wittenberg', wittebergæ: 'Wittenberg', witebergæ: 'Wittenberg', vitebergæ: 'Wittenberg', wittenbergae: 'Wittenberg',
  lugdunibatavorum: 'Leiden', lugdbatavorum: 'Leiden', lugdbat: 'Leiden', lvgdvnibatavorvm: 'Leiden', lugdunumbatavorum: 'Leiden',
  lugdunum: 'Lyon', parisiis: 'Paris', lutetiaeparisiorum: 'Paris', lutetiæ: 'Paris', lutetiæparisiorum: 'Paris', lutetia: 'Paris',
  londini: 'London', oxonii: 'Oxford', oxoniae: 'Oxford', cantabrigiae: 'Cambridge', cantabrigiæ: 'Cambridge',
  amstelodami: 'Amsterdam', amstelaedami: 'Amsterdam', amstelædami: 'Amsterdam', amsterodami: 'Amsterdam', amsterdami: 'Amsterdam',
  francofurti: 'Frankfurt', francofurtiadmoenum: 'Frankfurt', francofurtiadmoenvm: 'Frankfurt', francofvrti: 'Frankfurt',
  francofurtiadviadrum: 'Frankfurt an der Oder', francofurtiadoderam: 'Frankfurt an der Oder',
  norimbergae: 'Nuremberg', norimbergæ: 'Nuremberg', noribergae: 'Nuremberg', noribergæ: 'Nuremberg', norimberg: 'Nuremberg', neurenberg: 'Nuremberg',
  augustaevindelicorum: 'Augsburg', augustævindelicorum: 'Augsburg', tubingae: 'Tübingen', tubingæ: 'Tübingen',
  altdorfii: 'Altdorf', altorfii: 'Altdorf', altdorphii: 'Altdorf', regiomonti: 'Königsberg', gedani: 'Gdańsk',
  hafniae: 'Copenhagen', hafniæ: 'Copenhagen', holmiae: 'Stockholm', holmiæ: 'Stockholm', upsaliae: 'Uppsala', upsaliæ: 'Uppsala',
  ultrajecti: 'Utrecht', trajectiadrhenum: 'Utrecht', franequerae: 'Franeker', franekerae: 'Franeker', groningae: 'Groningen',
  marpurgi: 'Marburg', giessae: 'Giessen', gissae: 'Giessen', rostochii: 'Rostock', gryphiswaldiae: 'Greifswald', kiliae: 'Kiel',
  halae: 'Halle', halæ: 'Halle', halaesaxonum: 'Halle', halaemagdeburgicae: 'Halle', halaemagdeburgicæ: 'Halle', halamagdeburgicae: 'Halle',
  erfordiae: 'Erfurt', erfurti: 'Erfurt', moguntiae: 'Mainz', moguntiæ: 'Mainz', ingolstadii: 'Ingolstadt', dilingae: 'Dillingen',
  viennae: 'Vienna', viennæ: 'Vienna', viennaeaustriae: 'Vienna', viennæaustriæ: 'Vienna', pragae: 'Prague', pragæ: 'Prague',
  cracoviae: 'Kraków', cracoviæ: 'Kraków', antverpiae: 'Antwerp', antverpiæ: 'Antwerp', bruxellis: 'Brussels', duaci: 'Douai', lovanii: 'Leuven',
  coloniae: 'Cologne', coloniæ: 'Cologne', coloniaeagrippinae: 'Cologne', coloniæagrippinæ: 'Cologne', coloniaeubiorum: 'Cologne',
  coloniaeallobrogum: 'Geneva', coloniæallobrogum: 'Geneva', genevae: 'Geneva', genevæ: 'Geneva', tiguri: 'Zurich', bernae: 'Bern',
  romae: 'Rome', romæ: 'Rome', florentiae: 'Florence', florentiæ: 'Florence', mediolani: 'Milan', neapoli: 'Naples', bononiae: 'Bologna', bononiæ: 'Bologna',
  patavii: 'Padua', taurini: 'Turin', ticini: 'Pavia', matriti: 'Madrid', hispali: 'Seville', salmanticae: 'Salamanca', olisipone: 'Lisbon', ulyssipone: 'Lisbon',
  rothomagi: 'Rouen', tolosae: 'Toulouse', spirae: 'Speyer', heidelbergae: 'Heidelberg', herbornae: 'Herborn', hanoviae: 'Hanau',
  lubecae: 'Lübeck', hamburgi: 'Hamburg', bremae: 'Bremen', brunsvigae: 'Braunschweig', gottingae: 'Göttingen', lemgoviae: 'Lemgo',
  rintelii: 'Rinteln', dresdae: 'Dresden', vratislaviae: 'Wrocław', rigae: 'Riga', lundae: 'Lund', edinburgi: 'Edinburgh',
  mantuae: 'Mantua', ferrariae: 'Ferrara', parmae: 'Parma', brixiae: 'Brescia', veronae: 'Verona', tarvisii: 'Treviso',
  monachii: 'Munich', ratisbonae: 'Regensburg', ulmae: 'Ulm', basileæ: 'Basel', lipsia: 'Leipzig',
  herbipoli: 'Würzburg', bambergae: 'Bamberg', erlangae: 'Erlangen', stutgardiae: 'Stuttgart', magdeburgi: 'Magdeburg',
  gothae: 'Gotha', vinariae: 'Weimar', hannoverae: 'Hannover', torgae: 'Torgau', servestae: 'Zerbst', islebii: 'Eisleben',
  dordraci: 'Dordrecht', harlemi: 'Haarlem', roterodami: 'Rotterdam', hagaecomitis: 'The Hague', hagaecomitum: 'The Hague', delphis: 'Delft',
};

/** Placeless / non-geographic imprint markers — return null (no dot). */
const PLACELESS = [
  /^n\.?\s*p\.?$/i, /^s\.?\s*l\.?$/i, /^z\.?\s*p\.?$/i, /^s\.?\s*n\.?$/i,
  /^s\.?\s*l\.?\s*\(/i, /^sine loco/i, /^sans lieu$/i, /^unknown$/i, /^onbekend$/i, /^that year$/i, /^by\b/i, /^\?+$/,
];

/**
 * Normalize a raw imprint string to a single geocodable city, or null to skip.
 * Handles bracketed editorial places, false imprints (real city in brackets,
 * fictitious city quoted), Dutch/Latin prepositions, multi-city lists, and
 * archaic spellings. See scope notes — recovers ~250 books the naive cleaner
 * left unmapped.
 */
function cleanPlaceName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();

  // 1. Prefer a bracketed editorial place: "Fake" [Real], [=Real], X [Real].
  //    Not a bracket inside a word: "J[ames] C[ottrell]" expands a printer's name.
  const br = s.match(/(?:^|[^\p{L}])\[\s*=?\s*([^\][?]+?)\s*\??\s*\]/u);
  if (br && br[1].trim().length > 1) s = br[1].trim();
  else s = s.replace(/[[\]]/g, ' ');

  // 2. Dutch contraction t'/'t (before quote-stripping eats the apostrophe).
  s = s.replace(/^\s*'?t'\s*/i, ' ').replace(/^\s*'t\s+/i, ' ');

  // 3. Strip quotes, question marks, colons, semicolons.
  s = s.replace(/["'`?:;]/g, ' ');

  // 4. Strip leading place-prepositions (Dutch te/tot, Latin ad/apud, à/a/in/zu).
  s = s.replace(/^\s*(te|tot|in|ad|apud|à|a|zu|zur|au)\s+/i, ' ');

  // 5. "Oldname = Modernname" → modern; then multi-city lists → first city.
  s = s.split('=').pop().split('|')[0]
       .split(/\s+en\s+/i)[0].split(/\s+and\s+/i)[0].split(/\s+et\s+/i)[0]
       .split('/')[0].split('&')[0].split(',')[0]
       .split(/\s{2,}/)[0]           // double-space-separated multi-imprint
       .trim();

  if (!s || s.length < 2) return null;
  if (PLACELESS.some((p) => p.test(s))) return null;

  // ß-ÿ, not à-ÿ: ß (U+00DF) sits just below à, and dropping it turned
  // "Straßburg" into "straburg", which matched no normalisation (2026-10-06).
  const key = s.toLowerCase().replace(/[^a-zß-ÿ]/g, '');
  return ARCHAIC_NORMALIZE[key] || s;
}

/** Query Wikidata SPARQL for city coordinates — prefer large cities */
async function geocodeViaWikidata(cityName) {
  // Prefer cities/towns (P31 = Q515 city, Q3957 town, Q1549591 big city) with largest population
  const sparql = `
    SELECT ?item ?itemLabel ?lat ?lon ?countryLabel ?pop WHERE {
      ?item rdfs:label "${cityName.replace(/"/g, '\\"')}"@en .
      ?item wdt:P625 ?coord .
      ?item wdt:P17 ?country .
      OPTIONAL { ?item wdt:P1082 ?pop }
      BIND(geof:latitude(?coord) AS ?lat)
      BIND(geof:longitude(?coord) AS ?lon)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY DESC(?pop)
    LIMIT 1
  `;

  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.bindings?.[0];
    if (!result) return null;

    return {
      lat: parseFloat(result.lat.value),
      lng: parseFloat(result.lon.value),
      country: result.countryLabel?.value || null,
      wikidata_id: result.item?.value?.split('/').pop() || null,
    };
  } catch {
    return null;
  }
}

/** Fallback: search Wikidata API for fuzzy matches */
async function geocodeViaSearch(cityName) {
  try {
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cityName)}&language=en&limit=3&format=json`
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    for (const result of searchData.search || []) {
      // Get entity details with coordinates
      const entityRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${result.id}&props=claims&format=json`
      );
      if (!entityRes.ok) continue;
      const entityData = await entityRes.json();
      const claims = entityData.entities?.[result.id]?.claims;

      // Check P625 (coordinate location)
      const coordClaim = claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (!coordClaim) continue;

      // Check P17 (country)
      const countryClaim = claims?.P17?.[0]?.mainsnak?.datavalue?.value?.id;

      let country = null;
      if (countryClaim) {
        const countryRes = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${countryClaim}&props=labels&languages=en&format=json`
        );
        if (countryRes.ok) {
          const countryData = await countryRes.json();
          country = countryData.entities?.[countryClaim]?.labels?.en?.value || null;
        }
      }

      return {
        lat: coordClaim.latitude,
        lng: coordClaim.longitude,
        country,
        wikidata_id: result.id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── #6022: more inputs for books with no publication dot ─────────────────────
//
// Lanes, in order of trust. Each writes `locations[]` with its own `source` tag
// and only touches books that have no `type: 'publication'` entry yet, so a later
// (less trusted) lane never overrides an earlier one and every lane is reversible
// by `$pull: { locations: { source } }`.
//
//   ustc        books.ustc_id → catalog_coverage.place (our USTC dump)    high
//   publisher   books.publisher → leading place ("Lipsiae : Sumptibus…")    medium
//   ia          archive.org imprint/publisher for books.ia_identifier      medium
//   title-pages strict imprint line on an OCR'd title page (pages 1–6)     medium
//
// Only `publisher` runs by default (it is the third imprint field after
// place_of_publication / place_published). The others are opt-in flags.

const argVal = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const ONLY = argVal('only');
const LANES = ONLY ? ONLY.split(',') : [
  'fields', 'publisher',
  ...(process.argv.includes('--ustc') ? ['ustc'] : []),
  ...(process.argv.includes('--ia') ? ['ia'] : []),
  ...(process.argv.includes('--title-pages') ? ['title-pages'] : []),
];
const LIMIT = parseInt(argVal('limit') || '0', 10);
const DUMP = argVal('dump'); // JSONL of every title-page match + context (precision check)
const IA_CACHE = argVal('ia-cache') || `${process.env.HOME}/.cache/sourcelibrary/ia-imprint.json`;

const LANE_SOURCE = { ustc: 'ustc', publisher: 'publisher-field', ia: 'ia-metadata', 'title-pages': 'title-page-imprint' };
const LANE_CONFIDENCE = { ustc: 'high', publisher: 'medium', ia: 'medium', 'title-pages': 'medium' };

/** Target books for a lane: visible, no publication dot yet. */
const UNPLACED = {
  visible: true,
  'locations.type': { $ne: 'publication' },
  title: { $not: /^Mongolian Kanjur/ }, // held hidden pending #5664 — never touch
};

/** Cache entries that are not places (countries, regions, parse debris). */
const NOT_A_CITY = new Set([
  'in', 'st', 'nc', 'null', 'netherlands', 'france', 'germany', 'holland', 'spain',
  'bengal', 'ethiopia', 'iran', 'yemen', 'bhutan', 'kashmir', 'menassehbenisrael',
  'cosmopoli', 'kosmopolis', 'eleutheropoli', 'rotenburgad',
]);

/** Leading words that are names more often than imprint cities. */
const SURNAME_LIKE = new Set(['hamilton', 'reading', 'bath', 'hof', 'essen', 'chester', 'durham', 'monroe', 'wheaton', 'albany', 'memphis', 'athens', 'alexandria', 'palmyra', 'girard', 'oceanside', 'anamosa', 'savannah', 'elkhart']);

const placeKey = (s) => String(s).toLowerCase().replace(/[^a-zß-ÿ]/g, '');
const CURATED_NAMES = new Set(Object.values(ARCHAIC_NORMALIZE).map(placeKey));

/**
 * Resolve a CITY NAME (already cleaned) to a cached geo, by its label. Unlike the
 * field lane this never geocodes free text: a publisher string like "Macmillan"
 * must not become a dot. Wikidata is asked only for curated names (the
 * normalisation table's targets) or when the caller vouches for the input (USTC).
 */
function makeResolver(cache) {
  const byLabel = new Map();
  for (const [raw, geo] of Object.entries(cache)) {
    if (!geo || typeof geo.lat !== 'number') continue;
    const k = placeKey(geo.city);
    if (!k || NOT_A_CITY.has(k)) continue;
    // Prefer the entry whose raw key IS the label (the plain-city lookup).
    if (!byLabel.has(k) || raw === geo.city) byLabel.set(k, geo);
  }
  const wikidataMemo = new Map();
  const added = [];

  async function resolve(name, { allowWikidata = false } = {}) {
    if (!name) return null;
    const k = placeKey(name);
    if (!k || NOT_A_CITY.has(k) || k.length < 3) return null;
    if (name in MANUAL_OVERRIDES) return MANUAL_OVERRIDES[name] ? { ...MANUAL_OVERRIDES[name] } : null;
    if (byLabel.has(k)) return byLabel.get(k);
    if (!(allowWikidata || CURATED_NAMES.has(k))) return null;
    if (!wikidataMemo.has(k)) {
      const r = await geocodeViaWikidata(name);
      await new Promise((res) => setTimeout(res, 250));
      const geo = r ? { city: name, ...r } : null;
      wikidataMemo.set(k, geo);
      if (geo) { cache[name] = geo; byLabel.set(k, geo); added.push(geo); }
    }
    return wikidataMemo.get(k);
  }
  return { resolve, added };
}

/**
 * The leading place of an imprint/publisher string: "Lipsiae : Sumptibus…",
 * "London, Printed by…", "Prag J.G. Calve". Returns a cleaned city name to try,
 * shortest-first fallbacks included.
 */
function imprintPlaceCandidates(raw) {
  if (!raw || typeof raw !== 'string') return [];
  // Text before the first ':' or ';' is the place in ISBD imprints. A bracketed
  // editorial place inside it wins ("Lugduni Batavorum [Leiden] :"); a bracket
  // after it is a printer's name ("Excudit J[ames] C[ottrell]"), never a place.
  const head = raw.split(/[:;]/)[0];
  // A personal-name heading ("Avignon, Antoine d', -1483") sometimes sits in `publisher`.
  if (!/[:;]/.test(raw) && /,\s*-?\d{3,4}(-\d{0,4})?\.?\s*$/.test(raw)) return [];
  if (/^\W*Cambridge\b/.test(head) && /\bHarvard\b|Cambridge,?\s*(Mass\b|Massachusetts|MA\b)/.test(raw)) return ['Cambridge, Massachusetts'];
  const out = [];
  const whole = cleanPlaceName(head);
  if (whole) out.push(whole);
  const words = head.replace(/[[\]()"'`?]/g, ' ').split(/[\s,.]+/).filter(Boolean);
  // Strip leading prepositions/imprint verbs ("Gedruckt zu Leipzig", "A Paris", "In Venetia").
  while (words.length && /^(te|tot|in|ad|apud|à|a|zu|zur|au|gedruckt|impressum|excusum|printed|imprimé|at)$/i.test(words[0])) words.shift();
  if (words[0] && SURNAME_LIKE.has(placeKey(words[0]))) return [];
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const cand = cleanPlaceName(words.slice(0, n).join(' '));
    if (cand && !out.includes(cand)) out.push(cand);
  }
  return out;
}

/** "Canterbury, N.H.", "Frankfort, Ky.": an American imprint, whatever the name says. */
const US_STATE = /,\s*(N\.\s?[HYJC]|Mass|Conn|Pa|Penn|Mo|Ky|Ill|Ind|Ohio|Mich|Wis|Minn|Ia|Calif|Cal|Va|Md|Me|Vt|R\.\s?I|Ga|Tenn|Tex|La|Colo|Wash|Or|Ore|D\.\s?C|U\.\s?S\.\s?A?)\b/;

async function resolveImprint(raw, resolver, opts) {
  const american = US_STATE.test(String(raw ?? '').split(/[:;]/)[0]);
  for (const cand of imprintPlaceCandidates(raw)) {
    const geo = await resolver.resolve(cand, opts);
    if (geo) return american && geo.country !== 'United States' ? null : geo;
  }
  return null;
}

// ── title-page imprint (strict) ──────────────────────────────────────────────

/** Imprint keywords from #6022 (+ their vernacular equivalents). */
const IMPRINT_KW = /\b(typis|typ\.|apud|excud\w*|impensis|ex\s+officina|officina|sumptibus|sumtibus|gedruckt|gedr\.|druckts?|bey|bei|chez|typograph\w*|printed|imprim\w+|appresso|presso|stampat\w*|verlegt|verlag\w*|prostant)\b/i;
/** Lines that mention a city for some other reason than printing it. */
const NOT_AN_IMPRINT = /\b(usage|use\s+of|usum|fecit|sculp\w*|delin\w*|pinx\w*|incidit|invenit)\b/i;
/** …and, on the city's own line only, a city named as a see, a school, a birthplace. */
const CITY_NOT_PRINTED = /\b(natus|born|bishop|episcop\w*|archiepiscop\w*|ecclesi\w*|universit\w*|gymnas\w*|collegi\w*|scientiarum)\b/i;
/** Never a printing place on a title page, whatever the table says. */
const TITLE_EXCLUDE = new Set(['argentina', 'rom', 'hof', 'halle', 'bath', 'lutetia', 'lipsia', 'venetie']);

/** Every name the title-page rule may match → canonical city label. */
const TITLE_CITY = new Map();
for (const [k, v] of Object.entries(ARCHAIC_NORMALIZE)) if (!TITLE_EXCLUDE.has(k)) TITLE_CITY.set(k, v);
for (const v of ['London', 'Paris', 'Amsterdam', 'Leipzig', 'Leiden', 'Venice', 'Basel', 'Frankfurt', 'Augsburg', 'Strasbourg', 'Lyon', 'Cologne', 'Antwerp', 'Wittenberg', 'Jena', 'Hamburg', 'Berlin', 'Vienna', 'Prague', 'Rome', 'Florence', 'Milan', 'Naples', 'Bologna', 'Padua', 'Oxford', 'Cambridge', 'Edinburgh', 'Dublin', 'Utrecht', 'Rotterdam', 'Haarlem', 'Delft', 'Dresden', 'Göttingen', 'Tübingen', 'Helmstedt', 'Marburg', 'Giessen', 'Rostock', 'Copenhagen', 'Stockholm', 'Uppsala', 'Altdorf', 'Ingolstadt', 'Dillingen', 'Mainz', 'Heidelberg', 'Erfurt', 'Breslau', 'Danzig', 'Königsberg', 'Riga', 'Madrid', 'Salamanca', 'Brussels', 'Leuven', 'Douai', 'Rouen', 'Toulouse', 'Bordeaux', 'Geneva', 'Zurich', 'Bern', 'Lausanne', 'Ulm', 'Regensburg', 'Magdeburg', 'Braunschweig', 'Lübeck', 'Bremen', 'Hannover', 'Gotha', 'Weimar', 'Stuttgart', 'Munich', 'Würzburg', 'Nuremberg', 'Franeker', 'Groningen', 'Kiel', 'Greifswald', 'Ferrara', 'Mantua', 'Parma', 'Brescia', 'Verona', 'Turin', 'Lisbon', 'Seville', 'Lyon', 'Middelburg', 'Leeuwarden', 'Deventer', 'Zwolle', 'Kampen', 'Harderwijk', 'Dordrecht', 'Herborn', 'Hanau', 'Speyer', 'Rinteln', 'Lemgo', 'Zerbst', 'Torgau', 'Görlitz', 'Zittau', 'Bautzen', 'Altona', 'Wolfenbüttel', 'Celle', 'Coburg', 'Bayreuth', 'Erlangen', 'Bamberg', 'Freiburg', 'Konstanz', 'Schaffhausen', 'Kraków', 'Warsaw', 'Moscow', 'Saint Petersburg']) {
  TITLE_CITY.set(placeKey(v), v);
}
TITLE_CITY.set('leipzig', 'Leipzig'); TITLE_CITY.set('nürnberg', 'Nuremberg'); TITLE_CITY.set('nurnberg', 'Nuremberg');
TITLE_CITY.set('köln', 'Cologne'); TITLE_CITY.set('wien', 'Vienna'); TITLE_CITY.set('straßburg', 'Strasbourg'); TITLE_CITY.set('strassburg', 'Strasbourg');

const STRIP_BLOCKS = /<(image-desc|vocab|meta|note|warning|insert|header|footer|marginalia|gloss|footnote|scan-quality|language|script|page-type|page-num|sig|translator-note|annotation)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The strict #6022 rule. Returns { city, line, context } for the LAST imprint-like
 * centred line on a title page, or null. A line qualifies when it is centred
 * (`->…<-`), names a city from TITLE_CITY as one of its words, and has an imprint
 * keyword on the same or an adjacent centred line within 120 characters.
 */
function titlePageImprint(ocr) {
  if (!ocr || !/<page-type>\s*title-page\s*<\/page-type>/i.test(ocr)) return null;
  const lines = ocr.replace(STRIP_BLOCKS, '\n').split('\n');
  const centred = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*->(.*)<-\s*$/);
    if (m) centred.push({ i, text: m[1].replace(/<\/?[a-z-]+[^>]*>/gi, '').replace(/[*_#]/g, '').trim() });
  }
  let best = null;
  for (let c = 0; c < centred.length; c++) {
    const { i, text } = centred[c];
    if (NOT_AN_IMPRINT.test(text) || CITY_NOT_PRINTED.test(text)) continue;
    const words = [...text.matchAll(/[\p{L}]+/gu)];
    let hit = null;
    for (let w = 0; w < words.length && !hit; w++) {
      for (let n = Math.min(3, words.length - w); n >= 1 && !hit; n--) {
        const seq = words.slice(w, w + n);
        if (!/^\p{Lu}/u.test(seq[0][0])) continue; // a proper noun, capitalised
        const label = TITLE_CITY.get(placeKey(seq.map((x) => x[0]).join('')));
        if (label) hit = { label, at: seq[0].index, word: seq.map((x) => x[0]).join(' ') };
      }
    }
    if (!hit) continue;
    // Keyword on this line, or the adjacent centred line (blank lines allowed).
    const near = [centred[c - 1], centred[c + 1]].filter((x) => x && Math.abs(x.i - i) <= 2);
    const sameLine = IMPRINT_KW.exec(text);
    let ok = sameLine && Math.abs(sameLine.index - hit.at) <= 120;
    if (!ok) ok = near.some((x) => !NOT_AN_IMPRINT.test(x.text) && IMPRINT_KW.test(x.text) && x.text.length + text.length <= 240);
    if (!ok) continue;
    best = {
      city: hit.label, word: hit.word, line: text,
      context: centred.slice(Math.max(0, c - 2), c + 3).map((x) => x.text).join(' / '),
      multi: false,
    };
  }
  if (best) {
    const cities = new Set();
    for (const { text } of centred) for (const w of text.matchAll(/[\p{L}]+/gu)) {
      const l = TITLE_CITY.get(placeKey(w[0])); if (l && /^\p{Lu}/u.test(w[0])) cities.add(l);
    }
    best.multi = cities.size > 1;
  }
  return best;
}

async function writeLane(db, lane, byGeo, placedInDryRun) {
  let n = 0;
  for (const { geo, ids } of byGeo.values()) {
    const location = {
      type: 'publication', city: geo.city, country: geo.country ?? null, lat: geo.lat, lng: geo.lng,
      source: LANE_SOURCE[lane], confidence: LANE_CONFIDENCE[lane],
    };
    if (DRY_RUN) { ids.forEach((id) => placedInDryRun.add(id)); n += ids.length; continue; }
    for (let i = 0; i < ids.length; i += 500) {
      const r = await db.collection('books').updateMany(
        { ...UNPLACED, id: { $in: ids.slice(i, i + 500) } },
        { $push: { locations: location } },
      );
      n += r.modifiedCount;
    }
  }
  return n;
}

function summarize(lane, byGeo, n) {
  const top = [...byGeo.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, 10)
    .map(({ geo, ids }) => `${geo.city} ${ids.length}`).join(', ');
  console.log(`\n[${lane}] ${DRY_RUN ? 'would write' : 'wrote'} ${n} books. Top: ${top}`);
}

function addTo(byGeo, geo, id) {
  const key = `${geo.city}|${geo.lat.toFixed(3)}|${geo.lng.toFixed(3)}`;
  if (!byGeo.has(key)) byGeo.set(key, { geo, ids: [] });
  byGeo.get(key).ids.push(id);
}

async function laneUstc(db, resolver, placed) {
  const books = await db.collection('books').find(
    { ...UNPLACED, ustc_id: { $exists: true, $nin: [null, ''] } }, { projection: { id: 1, ustc_id: 1 } },
  ).toArray();
  const todo = books.filter((b) => !placed.has(b.id)).slice(0, LIMIT || undefined);
  const rows = await db.collection('catalog_coverage').find(
    { ustc_id: { $in: todo.map((b) => Number(b.ustc_id)).filter(Number.isFinite) } }, { projection: { ustc_id: 1, place: 1 } },
  ).toArray();
  const placeBy = new Map(rows.map((r) => [r.ustc_id, r.place]));
  const byGeo = new Map(); const misses = {};
  for (const b of todo) {
    const raw = placeBy.get(Number(b.ustc_id));
    const name = cleanPlaceName(raw);
    const geo = name ? await resolver.resolve(name, { allowWikidata: true }) : null;
    if (geo) addTo(byGeo, geo, b.id); else if (raw) misses[raw] = (misses[raw] || 0) + 1;
  }
  console.log(`[ustc] ${todo.length} candidates, ${rows.length} USTC rows; unresolved:`, Object.entries(misses).sort((a, b) => b[1] - a[1]).slice(0, 15));
  return byGeo;
}

async function lanePublisher(db, resolver, placed) {
  const books = await db.collection('books').find(
    { ...UNPLACED, publisher: { $type: 'string', $ne: '' } }, { projection: { id: 1, publisher: 1 } },
  ).toArray();
  const todo = books.filter((b) => !placed.has(b.id)).slice(0, LIMIT || undefined);
  const byGeo = new Map(); const seen = new Map();
  for (const b of todo) {
    if (!seen.has(b.publisher)) seen.set(b.publisher, await resolveImprint(b.publisher, resolver));
    const geo = seen.get(b.publisher);
    if (geo) addTo(byGeo, geo, b.id);
  }
  if (process.argv.includes('--verbose')) {
    for (const [raw, geo] of seen) if (geo) console.log(`  ${geo.city.padEnd(18)} ← ${raw.slice(0, 90)}`);
  }
  console.log(`[publisher] ${todo.length} candidates, ${seen.size} distinct strings`);
  return byGeo;
}

async function laneIa(db, resolver, placed) {
  const fs = await import('fs');
  const path = await import('path');
  let iaCache = {};
  try { iaCache = JSON.parse(fs.readFileSync(IA_CACHE, 'utf8')); } catch { /* first run */ }
  const books = await db.collection('books').find(
    { ...UNPLACED, ia_identifier: { $type: 'string', $ne: '' } }, { projection: { id: 1, ia_identifier: 1 } },
  ).toArray();
  const todo = books.filter((b) => !placed.has(b.id)).slice(0, LIMIT || undefined);
  const need = [...new Set(todo.map((b) => b.ia_identifier).filter((id) => !(id in iaCache) && /^[\w.-]+$/.test(id)))];
  console.log(`[ia] ${todo.length} candidates, ${need.length} identifiers to fetch (cache ${Object.keys(iaCache).length})`);
  // Batch through advancedsearch (100 ids per call, ~2 req/s) rather than one
  // /metadata call per item; ids it does not return are recorded as {} so the
  // next run does not ask again.
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100);
    const q = `identifier:(${batch.join(' OR ')})`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=imprint&fl[]=publisher&rows=200&output=json`;
    let docs = null;
    for (let attempt = 0; attempt < 3 && !docs; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' } });
        if (r.ok) docs = (await r.json()).response?.docs || [];
        else await new Promise((res) => setTimeout(res, 5000));
      } catch { await new Promise((res) => setTimeout(res, 5000)); }
    }
    if (!docs) { console.log(`  batch ${i} failed; will retry next run`); continue; }
    const got = new Map(docs.map((d) => [d.identifier, d]));
    for (const id of batch) {
      const d = got.get(id);
      iaCache[id] = d ? { imprint: [d.imprint].flat()[0] || null, publisher: [d.publisher].flat()[0] || null } : {};
    }
    if ((i / 100) % 20 === 19) { fs.mkdirSync(path.dirname(IA_CACHE), { recursive: true }); fs.writeFileSync(IA_CACHE, JSON.stringify(iaCache)); console.log(`  ${i + 100}/${need.length}`); }
    await new Promise((res) => setTimeout(res, 500));
  }
  fs.mkdirSync(path.dirname(IA_CACHE), { recursive: true });
  fs.writeFileSync(IA_CACHE, JSON.stringify(iaCache));
  const byGeo = new Map();
  for (const b of todo) {
    const rec = iaCache[b.ia_identifier];
    if (!rec) continue;
    const geo = (await resolveImprint(rec.imprint, resolver)) || (await resolveImprint(rec.publisher, resolver));
    if (geo) addTo(byGeo, geo, b.id);
  }
  return byGeo;
}

async function laneTitlePages(db, resolver, placed) {
  const fs = await import('fs');
  const books = await db.collection('books').find(
    { ...UNPLACED, pages_count: { $gt: 0 } }, { projection: { id: 1 } },
  ).toArray();
  const todo = books.filter((b) => !placed.has(b.id)).slice(0, LIMIT || undefined);
  console.log(`[title-pages] ${todo.length} candidates`);
  const byGeo = new Map();
  const dump = DUMP ? fs.createWriteStream(DUMP) : null;
  let matched = 0;
  for (let i = 0; i < todo.length; i += 200) {
    const ids = todo.slice(i, i + 200).map((b) => b.id);
    const pages = await db.collection('pages').find(
      { book_id: { $in: ids }, page_number: { $gte: 1, $lte: 6 } },
      { projection: { book_id: 1, page_number: 1, 'ocr.data': 1 } },
    ).toArray();
    const byBook = new Map();
    for (const p of pages) { if (!byBook.has(p.book_id)) byBook.set(p.book_id, []); byBook.get(p.book_id).push(p); }
    for (const [bookId, ps] of byBook) {
      ps.sort((a, b) => a.page_number - b.page_number);
      // The first title page that yields an imprint wins (later "title pages" in
      // pages 1–6 are usually a second work bound in, or a half-title).
      for (const p of ps) {
        const m = titlePageImprint(p.ocr?.data);
        if (!m) continue;
        const geo = await resolver.resolve(m.city);
        if (!geo) break;
        matched++;
        addTo(byGeo, geo, bookId);
        dump?.write(JSON.stringify({ book_id: bookId, page: p.page_number, ...m }) + '\n');
        break;
      }
    }
    if ((i / 200) % 25 === 24) console.log(`  ${i + 200}/${todo.length} — ${matched} matched`);
  }
  dump?.end();
  return byGeo;
}

const LANE_FNS = { ustc: laneUstc, publisher: lanePublisher, ia: laneIa, 'title-pages': laneTitlePages };

async function runNewLanes(db, cache) {
  const resolver = makeResolver(cache);
  const placed = new Set(); // dry-run only: books an earlier lane would have placed
  for (const lane of ['ustc', 'publisher', 'ia', 'title-pages']) {
    if (!LANES.includes(lane)) continue;
    const byGeo = await LANE_FNS[lane](db, resolver, placed);
    const n = await writeLane(db, lane, byGeo, placed);
    summarize(lane, byGeo, n);
  }
  if (resolver.added.length) {
    console.log(`\nNew Wikidata geocodes (check these): ${resolver.added.map((g) => `${g.city} (${g.lat.toFixed(2)},${g.lng.toFixed(2)} ${g.country})`).join('; ')}`);
    if (!DRY_RUN) {
      await db.collection('system_config').updateOne(
        { _id: 'geocode_cache' },
        { $set: { cities: cache, updated_at: new Date(), count: Object.keys(cache).length } },
      );
    }
  }
}

async function main() {
  console.log(`Geocode Publication Places — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — lanes: ${LANES.join(', ')}`);
  if (!LANES.includes('fields')) {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('bookstore');
    const cache = (await db.collection('system_config').findOne({ _id: 'geocode_cache' }))?.cities || {};
    await runNewLanes(db, cache);
    await client.close();
    return;
  }
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Step 1: Load or build geocode cache
  let cache = {};
  if (!REBUILD_CACHE) {
    const existing = await db.collection('system_config').findOne({ _id: 'geocode_cache' });
    cache = existing?.cities || {};
    console.log(`Loaded ${Object.keys(cache).length} cached cities`);
  }

  // Step 2: Get all distinct place strings. Books record their imprint city in
  // EITHER `place_of_publication` OR the legacy `place_published` field; geocode
  // the union of both so neither set of books is silently left off the map.
  const [placesA, placesB] = await Promise.all([
    db.collection('books').distinct('place_of_publication', {
      visible: true, place_of_publication: { $exists: true, $ne: null, $ne: '' },
    }),
    db.collection('books').distinct('place_published', {
      visible: true, place_published: { $exists: true, $ne: null, $ne: '' },
    }),
  ]);
  const places = [...new Set([...placesA, ...placesB])];

  // Filter out non-place values
  const skipPatterns = [/^n\.p\.?$/i, /^s\.l\.?$/i, /^\?$/, /^unknown$/i, /^—$/];
  const validPlaces = places.filter(p => p && typeof p === 'string' && p.length > 1 && !skipPatterns.some(pat => pat.test(p)));

  console.log(`${validPlaces.length} distinct places (${Object.keys(cache).length} already cached)`);

  // Step 2b: Apply manual overrides to fix wrong entries in cache
  if (FIX_OVERRIDES) {
    let fixed = 0;
    for (const [place, geo] of Object.entries(cache)) {
      if (!geo) continue;
      // Check place string first (more specific), then city name
      const override = MANUAL_OVERRIDES[place] || MANUAL_OVERRIDES[geo.city];
      if (override === null) {
        // Explicitly null = remove this entry
        console.log(`  REMOVE: ${place} — ${geo.city}`);
        cache[place] = null;
        fixed++;
      } else if (override && (Math.abs(geo.lat - override.lat) > 1 || Math.abs(geo.lng - override.lng) > 1)) {
        console.log(`  FIX: ${place} — ${geo.city} (${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)} ${geo.country}) → (${override.lat.toFixed(2)}, ${override.lng.toFixed(2)} ${override.country})`);
        cache[place] = { city: override.city, ...override };
        fixed++;
      }
    }
    console.log(`Fixed ${fixed} override entries\n`);
  }

  // Step 3: Geocode uncached places
  const uncached = validPlaces.filter(p => !cache[p]);
  console.log(`${uncached.length} to geocode\n`);

  for (let i = 0; i < uncached.length; i++) {
    const place = uncached[i];
    if (i > 0 && i % 10 === 0) console.log(`  ${i}/${uncached.length}...`);

    // Normalize the raw imprint string to a single geocodable city (handles
    // brackets, false imprints, Dutch/Latin prepositions, archaic spellings).
    const primaryPlace = cleanPlaceName(place);
    if (!primaryPlace) { cache[place] = null; continue; }

    // Check manual overrides first, then SPARQL, then search API
    let result = null;
    if (primaryPlace in MANUAL_OVERRIDES) {
      const ov = MANUAL_OVERRIDES[primaryPlace];
      if (ov === null) { cache[place] = null; continue; }
      result = { ...ov };
    } else if (place in MANUAL_OVERRIDES) {
      const ov = MANUAL_OVERRIDES[place];
      if (ov === null) { cache[place] = null; continue; }
      result = { ...ov };
    } else {
      result = await geocodeViaWikidata(primaryPlace);
      if (!result) result = await geocodeViaSearch(primaryPlace);
    }

    if (result) {
      cache[place] = { city: primaryPlace, ...result };
      console.log(`  ✓ ${place} → ${result.lat.toFixed(2)}, ${result.lng.toFixed(2)} (${result.country || '?'})`);
    } else {
      cache[place] = null; // Mark as unresolvable
      console.log(`  ✗ ${place}`);
    }

    // Rate limit Wikidata
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 1000));
  }

  // Step 4: Save cache
  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'geocode_cache' },
      { $set: { cities: cache, updated_at: new Date(), count: Object.keys(cache).length } },
      { upsert: true }
    );
    console.log(`\nCached ${Object.keys(cache).length} cities`);
  }

  // Step 5: Write locations to books
  const resolved = Object.entries(cache).filter(([_, v]) => v !== null);
  console.log(`\nWriting locations to books (${resolved.length} resolvable places)...`);

  let updated = 0;
  for (const [place, geo] of resolved) {
    const location = {
      type: 'publication',
      city: geo.city,
      country: geo.country,
      lat: geo.lat,
      lng: geo.lng,
      source: 'wikidata',
      confidence: 'high',
    };

    if (DRY_RUN) continue;

    // A book matches this place via either imprint field.
    const placeMatch = { $or: [{ place_of_publication: place }, { place_published: place }] };

    if (FIX_OVERRIDES) {
      // When fixing overrides: replace existing publication location
      const result = await db.collection('books').updateMany(
        { visible: true, ...placeMatch, 'locations.type': 'publication' },
        { $set: { 'locations.$[elem]': location } },
        { arrayFilters: [{ 'elem.type': 'publication' }] }
      );
      // Also add to books that don't have one yet
      const result2 = await db.collection('books').updateMany(
        { visible: true, ...placeMatch, 'locations.type': { $ne: 'publication' } },
        { $push: { locations: location } }
      );
      updated += result.modifiedCount + result2.modifiedCount;
    } else {
      // Normal mode: add to locations array (don't duplicate)
      const result = await db.collection('books').updateMany(
        {
          visible: true,
          ...placeMatch,
          'locations.type': { $ne: 'publication' }, // don't add if already has one
        },
        {
          $push: { locations: location },
        }
      );
      updated += result.modifiedCount;
    }
  }

  console.log(`Updated ${updated} books with publication coordinates`);

  // #6022 lanes run after the imprint fields, each on what is still unplaced.
  await runNewLanes(db, cache);
  console.log('\n' + '─'.repeat(60));
  console.log('Done.');

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
