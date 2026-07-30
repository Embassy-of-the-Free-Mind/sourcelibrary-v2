/**
 * bib-record.mjs — parse, classify and project raw bibliographic records. (#3455)
 *
 * WHY THIS EXISTS
 * ---------------
 * We already fetch rich records (loc.gov, Open Library, Google Books,
 * archive.org, OpenAlex) and keep sixteen flat fields. Everything else — MARC
 * fields, subject headings, identifiers, the raw payload — is discarded at
 * ingest. Two failures follow directly:
 *
 *   1. Godwin's *Athanasius Kircher's Theatre of the World* (Inner Traditions,
 *      2009) is an illustrated STUDY. It sits in `translation_catalogs` as a
 *      translation with Godwin as `translator`. Its LoC record carries
 *      `600 10 $x Criticism and interpretation` and NO `041` field at all, so it
 *      is machine-distinguishable from a translation. We had that at fetch time
 *      and dropped it.
 *   2. No row on any of 24,061 carries an identifier, so nothing can be
 *      re-fetched, re-checked or deduplicated. "Backfill the missing fields" is
 *      impossible because there is no key to look a row up by.
 *
 * The rule this module encodes: **keep the whole record, project what you need.**
 * `bib_records` stores the payload as fetched; `translation_catalogs` becomes a
 * derived view. Adding a newly-relevant field is then a re-projection, not a
 * re-fetch — which matters because nobody thought `041$h` mattered until a study
 * got typed as a translation.
 *
 * WHAT THE MARC ACTUALLY LOOKS LIKE (both fetched from LoC 2026-07-29)
 * --------------------------------------------------------------------
 *   Copenhaver, *Hermetica* (CUP 1992) — a translation:
 *     010 $a 91025703 · 020 $a 0521361443
 *     041 1  $a eng $h grc $h lat        ← ind1=1 "is/includes a translation",
 *                                          $h = language(s) of the original
 *     245 00 $a Hermetica : $b … in a new English translation …
 *     300 $a lxxxiii, 320 p.
 *     700 1  $a Copenhaver, Brian P.
 *
 *   Godwin, *Theatre of the World* (2009) — a study:
 *     010 $a 2009011796 · 020 $a 9781594773297 · 035 $a (OCoLC)317361757
 *     (no 041 at all)
 *     100 1  $a Godwin, Joscelyn.        ← main entry AUTHOR, not a translator
 *     600 10 $a Kircher, Athanasius, $d 1602-1680 $x Criticism and interpretation.
 *     650  0 $a Scholars … $v Biography.
 *
 * Parsing goes through xml2js rather than regex: MARC-XML arrives from an
 * external host, and a regex parser over untrusted input is both a correctness
 * and a ReDoS hazard.
 */

import { parseStringPromise } from 'xml2js';

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a MARC-XML document (a bare `<record>`, a `<collection>`, or an SRU
 * `searchRetrieveResponse`) into plain record objects.
 *
 * @param {string} xml
 * @returns {Promise<Array<{leader: string, controlfields: Record<string,string>, datafields: Array<{tag:string,ind1:string,ind2:string,subfields:Array<{code:string,value:string}>}>}>>}
 */
/**
 * LoC rate-limits by serving an HTML interstitial with HTTP **200**, so a status
 * check passes while the body contains no MARC at all. Silently parsing that to
 * zero records reads as "this work has no prior translation" — a false negative
 * manufactured by throttling. Detect it and fail loudly instead.
 */
export function assertNotBlockPage(xml) {
  if (typeof xml !== 'string') return;
  const head = xml.slice(0, 400).toLowerCase();
  if (head.includes('<!doctype html') || head.includes('<html')) {
    const blocked = /ip access request|access request form|rate limit|too many requests/i.test(xml.slice(0, 4000));
    throw new Error(
      blocked
        ? 'LoC served an IP access-request page (HTTP 200, HTML body) — the request was throttled, not answered. Back off and retry; do NOT treat this as "no records".'
        : 'expected MARC-XML but received an HTML document',
    );
  }
}

export async function parseMarcXmlRecords(xml) {
  if (!xml || typeof xml !== 'string') return [];
  assertNotBlockPage(xml);
  // Namespace prefixes vary by endpoint (`zs:`, `marc:`, none) — strip them so
  // one code path handles lccn.loc.gov, the SRU gateway and HathiTrust alike.
  const opts = {
    explicitArray: true,
    tagNameProcessors: [(name) => name.replace(/^.*:/, '')],
    attrNameProcessors: [(name) => name.replace(/^.*:/, '')],
  };

  let parsed;
  try {
    parsed = await parseStringPromise(xml, opts);
  } catch (strictError) {
    // Real LoC records occasionally contain markup that strict SAX rejects
    // outright ("Unexpected close tag" — hit on the live record for LCCN
    // 96218515 while spot-checking). Losing a whole record to one stray tag is a
    // silent false negative in a system whose entire job is avoiding those, so
    // retry leniently. We only ever read a fixed set of fields from the result.
    try {
      parsed = await parseStringPromise(xml, { ...opts, strict: false });
    } catch {
      throw strictError;
    }
  }

  const records = [];
  collectRecords(parsed, records);
  return records.map(normalizeRecord);
}

/**
 * Depth-first walk collecting every MARC `<record>` node, wherever it is nested.
 *
 * An SRU response nests the MARC record inside its own `<zs:record>` wrapper.
 * Once namespace prefixes are stripped BOTH are named `record`, so matching on
 * the name alone grabs the wrapper — which carries `recordSchema` /
 * `recordPacking` / `recordData` children and no MARC at all. Identify a real
 * record by its CONTENT (it has controlfields or datafields), and keep
 * descending regardless so the nested one is still found.
 */
function collectRecords(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.controlfield) || Array.isArray(node.datafield)) out.push(node);
  for (const value of Object.values(node)) {
    for (const child of [].concat(value)) collectRecords(child, out);
  }
}

function normalizeRecord(raw) {
  const controlfields = {};
  for (const cf of raw.controlfield ?? []) {
    const tag = cf?.$?.tag;
    if (tag) controlfields[tag] = typeof cf._ === 'string' ? cf._ : '';
  }

  const datafields = [];
  for (const df of raw.datafield ?? []) {
    const tag = df?.$?.tag;
    if (!tag) continue;
    datafields.push({
      tag,
      ind1: df.$.ind1 ?? ' ',
      ind2: df.$.ind2 ?? ' ',
      subfields: (df.subfield ?? [])
        .map((sf) => ({
          code: sf?.$?.code ?? '',
          value: (typeof sf._ === 'string' ? sf._ : '').trim(),
        }))
        .filter((sf) => sf.code),
    });
  }

  return {
    leader: [].concat(raw.leader ?? [])[0] ?? '',
    controlfields,
    datafields,
  };
}

// ── Field accessors ──────────────────────────────────────────────────────────

/** All datafields with the given tag. */
export function fields(rec, tag) {
  return (rec?.datafields ?? []).filter((f) => f.tag === tag);
}

/** All subfield values for tag/code, in document order. */
export function subfields(rec, tag, code) {
  const out = [];
  for (const f of fields(rec, tag)) {
    for (const sf of f.subfields) if (sf.code === code) out.push(sf.value);
  }
  return out;
}

/** First subfield value for tag/code, or ''. */
export function subfield(rec, tag, code) {
  return subfields(rec, tag, code)[0] ?? '';
}

/**
 * Concatenate every subfield of the first instance of `tag` (display form).
 *
 * Trailing ISBD punctuation is stripped. MARC title fields conventionally end
 * in a period ("De voluptate."), which is pure noise for the work-identity join
 * this feeds — but a period after a single initial ("Smith, J.") is part of the
 * name, so that case is left alone.
 */
export function fieldText(rec, tag, codes = null) {
  const f = fields(rec, tag)[0];
  if (!f) return '';
  return f.subfields
    .filter((sf) => !codes || codes.includes(sf.code))
    .map((sf) => sf.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[\/:;,]\s*$/, '')
    .replace(/(?<![A-Z])\.\s*$/, '')
    .trim();
}

// ── Identifiers ──────────────────────────────────────────────────────────────

/**
 * Extract external identifiers. These are what make a row re-checkable — the
 * single thing every one of the 24,061 existing rows lacks.
 */
export function extractIdentifiers(rec) {
  const ids = {};

  const lccn = subfield(rec, '010', 'a').replace(/\s+/g, '');
  if (lccn) ids.lccn = lccn;

  const isbns = subfields(rec, '020', 'a')
    .map((v) => v.replace(/[^0-9Xx]/g, '').toUpperCase())
    .filter((v) => v.length === 10 || v.length === 13);
  if (isbns.length) ids.isbn = [...new Set(isbns)];

  // OCLC numbers arrive as `(OCoLC)317361757`; bare 035 $a values are the
  // cataloguing agency's own control number, not an OCLC number — don't claim
  // one where none exists.
  const oclc = subfields(rec, '035', 'a')
    .map((v) => v.match(/\(OCoLC\)\s*(?:oc[mn])?0*(\d+)/i)?.[1])
    .filter(Boolean);
  if (oclc.length) ids.oclc = [...new Set(oclc)];

  const lcControl = rec?.controlfields?.['001'];
  if (lcControl) ids.lc_control_number = lcControl.trim();

  return ids;
}

// ── Work type ────────────────────────────────────────────────────────────────

/** Relator codes / terms that mark a translator contribution. */
const TRANSLATOR_RELATORS = /\btrl\b|translat/i;

/**
 * Subject subdivisions ($x/$v) that mark a work ABOUT a text rather than a
 * rendering OF it. This is the signal that catches Godwin.
 */
const STUDY_SUBDIVISIONS = [
  /criticism and interpretation/i,
  /history and criticism/i,
  /^biography$/i,
  /\bbiography\b/i,
  /appreciation/i,
  /influence/i,
];

const COMMENTARY_TITLE_RE = /\b(a )?(commentary|commentaries|companion to|guide to|introduction to|reader'?s guide|handbook)\b/i;
const FACSIMILE_RE = /\bfacsimile\b/i;
const CRITICAL_EDITION_RE = /\bcritical edition\b|\bedited from the manuscripts?\b/i;

/**
 * Classify what kind of work a record describes.
 *
 * Precedence is deliberate: a positive `041$h` (language of the original) is a
 * cataloguer's explicit assertion that a translation is present, and outranks
 * subject headings — a translation published WITH scholarly apparatus often
 * carries criticism headings too. Absence of `041` plus criticism headings is
 * the study signature.
 *
 * @returns {{work_type: string, evidence: string[]}}
 */
export function classifyWorkType(rec) {
  const evidence = [];

  const f041 = fields(rec, '041')[0];
  const originalLangs = subfields(rec, '041', 'h');
  const translationIndicator = f041?.ind1 === '1';
  if (originalLangs.length) evidence.push(`041$h=${originalLangs.join(',')}`);
  if (translationIndicator) evidence.push('041 ind1=1 (translation)');

  const relators = [
    ...subfields(rec, '100', 'e'), ...subfields(rec, '100', '4'),
    ...subfields(rec, '700', 'e'), ...subfields(rec, '700', '4'),
    ...subfields(rec, '110', 'e'), ...subfields(rec, '710', 'e'),
  ];
  const hasTranslatorRelator = relators.some((r) => TRANSLATOR_RELATORS.test(r));
  if (hasTranslatorRelator) evidence.push('relator trl');

  const title = [fieldText(rec, '245'), fieldText(rec, '240')].join(' ');
  const titleSaysTranslation = /\btranslat(ed|ion)\b|\benglished\b|\bdone into english\b/i.test(title);
  if (titleSaysTranslation) evidence.push('245/240 states a translation');

  // Study signature: subject subdivisions about the text/person.
  const subdivisions = [];
  for (const tag of ['600', '610', '630', '650', '651']) {
    for (const f of fields(rec, tag)) {
      for (const sf of f.subfields) if (sf.code === 'x' || sf.code === 'v') subdivisions.push(sf.value);
    }
  }
  const studyHit = subdivisions.find((s) => STUDY_SUBDIVISIONS.some((re) => re.test(s)));

  if (originalLangs.length || translationIndicator || hasTranslatorRelator) {
    return { work_type: 'translation', evidence };
  }
  if (titleSaysTranslation) {
    return { work_type: 'translation', evidence };
  }
  if (studyHit) {
    evidence.push(`subject subdivision "${studyHit}" with no 041`);
    return { work_type: 'study', evidence };
  }
  if (COMMENTARY_TITLE_RE.test(title)) {
    evidence.push('245/240 reads as commentary/companion');
    return { work_type: 'commentary', evidence };
  }
  if (FACSIMILE_RE.test(title) || FACSIMILE_RE.test(fieldText(rec, '250'))) {
    evidence.push('facsimile in 245/250');
    return { work_type: 'facsimile', evidence };
  }
  if (CRITICAL_EDITION_RE.test(title) || CRITICAL_EDITION_RE.test(fieldText(rec, '250'))) {
    evidence.push('critical edition in 245/250');
    return { work_type: 'critical_edition', evidence };
  }

  // A record in the original language with no translation signal at all.
  evidence.push('no 041$h, no translator relator, no study subdivision');
  return { work_type: 'unknown', evidence };
}

// ── Completeness ─────────────────────────────────────────────────────────────

const PARTIAL_MARKERS = [
  /\bselections?\b/i, /\bexcerpts?\b/i, /\bextracts?\b/i, /\babridg(ed|ment)\b/i,
  /\bpassages\b/i, /\banthology\b/i, /\bsampler\b/i, /\bchrestomathy\b/i,
  /\ba selection\b/i, /\bpartial\b/i,
];
const COMPLETE_MARKERS = [/\bcomplete\b/i, /\bentire\b/i, /\bunabridged\b/i, /\bin full\b/i];

/** Parse a leading page/leaf count out of a MARC 300 $a extent statement. */
export function extentPages(rec) {
  const raw = subfields(rec, '300', 'a').join(' ');
  if (!raw) return null;
  // "lxxxiii, 320 p." → 320 ; "304 p." → 304 ; "2 v." → null (volumes, not pages)
  const matches = [...raw.matchAll(/(\d[\d,]*)\s*(?:p\.|pages|leaves)/gi)]
    .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(Number.isFinite);
  if (!matches.length) return null;
  return Math.max(...matches);
}

/**
 * Decide whether the record describes a COMPLETE rendering of the work.
 *
 * `completeness` is the field that makes the registry usable: the Tier-0 matcher
 * requires `completeness === 'complete'` to defeat a first-translation claim, and
 * it is `'unknown'` on 22,005 of 24,061 rows — so the catalogue is ~98% inert.
 *
 * The rule stays conservative in the direction that matters. A wrong `complete`
 * demotes a real first-translation badge (the historical #1 failure); a wrong
 * `unknown` merely leaves a claim standing. So an explicit partial marker always
 * wins, and `complete` requires a translation with a real extent and no partial
 * marker anywhere.
 *
 * @returns {{completeness: string, evidence: string[]}}
 */
export function classifyCompleteness(rec, workType) {
  const evidence = [];
  const haystack = [
    fieldText(rec, '245'),
    fieldText(rec, '240'),
    fieldText(rec, '250'),
    subfields(rec, '500', 'a').join(' '),
    subfields(rec, '504', 'a').join(' '),
    // 240 $k "Selections" is the cataloguer's explicit partial marker.
    subfields(rec, '240', 'k').join(' '),
    subfields(rec, '240', 's').join(' '),
  ].join(' ');

  const partial = PARTIAL_MARKERS.find((re) => re.test(haystack));
  if (partial) {
    evidence.push(`partial marker ${partial} in 240/245/250/500`);
    return { completeness: 'partial', evidence };
  }

  const complete = COMPLETE_MARKERS.find((re) => re.test(haystack));
  if (complete) {
    evidence.push(`explicit completeness marker ${complete}`);
    return { completeness: 'complete', evidence };
  }

  if (workType !== 'translation') {
    evidence.push(`work_type=${workType} — completeness not asserted for non-translations`);
    return { completeness: 'unknown', evidence };
  }

  const pages = extentPages(rec);
  if (pages == null) {
    evidence.push('no page extent in 300$a');
    return { completeness: 'unknown', evidence };
  }
  // A monograph-length translation with no partial marker anywhere. Below this
  // an "extent" is as likely to be a pamphlet excerpt as a full rendering.
  if (pages >= 80) {
    evidence.push(`300$a extent ${pages}pp, no partial marker`);
    return { completeness: 'complete', evidence };
  }
  evidence.push(`300$a extent only ${pages}pp — too short to assert complete`);
  return { completeness: 'unknown', evidence };
}

// ── Other projections ────────────────────────────────────────────────────────

/** ISO 639-2 codes of the original language(s), from 041$h. */
export function originalLanguages(rec) {
  return [...new Set(subfields(rec, '041', 'h').map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

/** Language of THIS item, from 041$a or the 008 language position (35-37). */
export function itemLanguage(rec) {
  const from041 = subfield(rec, '041', 'a').trim().toLowerCase();
  if (from041) return from041;
  const f008 = rec?.controlfields?.['008'] ?? '';
  return f008.slice(35, 38).trim().toLowerCase() || '';
}

/** Contributors with their relator roles. */
export function contributors(rec) {
  const out = [];
  for (const [tag, defaultRole] of [['100', 'author'], ['110', 'author'], ['700', 'contributor'], ['710', 'contributor']]) {
    for (const f of fields(rec, tag)) {
      const name = f.subfields.filter((s) => ['a', 'b', 'c', 'q'].includes(s.code)).map((s) => s.value).join(' ').replace(/[,;:]\s*$/, '').trim();
      if (!name) continue;
      const relator = f.subfields.filter((s) => s.code === 'e' || s.code === '4').map((s) => s.value).join(' ');
      let role = defaultRole;
      if (TRANSLATOR_RELATORS.test(relator)) role = 'translator';
      else if (/\bedt\b|editor/i.test(relator)) role = 'editor';
      out.push({ name, role, relator: relator || undefined, marc_tag: tag });
    }
  }
  return out;
}

/** MARC 240 uniform title (work identity — feeds #3258 / #2453). */
export function uniformTitle(rec) {
  return fieldText(rec, '240', ['a', 'n', 'p']) || '';
}

export function mainTitle(rec) {
  return fieldText(rec, '245', ['a', 'b']);
}

export function statementOfResponsibility(rec) {
  return subfield(rec, '245', 'c');
}

export function publicationYear(rec) {
  for (const tag of ['264', '260']) {
    const raw = subfield(rec, tag, 'c');
    const m = raw.match(/(\d{4})/);
    if (m) return parseInt(m[1], 10);
  }
  const f008 = rec?.controlfields?.['008'] ?? '';
  const y = parseInt(f008.slice(7, 11), 10);
  return Number.isFinite(y) ? y : null;
}

export function publisher(rec) {
  return subfield(rec, '264', 'b') || subfield(rec, '260', 'b') || '';
}

export function subjectHeadings(rec) {
  const out = [];
  for (const tag of ['600', '610', '630', '650', '651']) {
    for (const f of fields(rec, tag)) {
      const text = f.subfields.filter((s) => /[avxyz]/.test(s.code)).map((s) => s.value).join(' — ').replace(/\.$/, '');
      if (text) out.push(text);
    }
  }
  return out;
}

// ── bib_records document ─────────────────────────────────────────────────────

/**
 * Build a `bib_records` document: the raw payload plus everything projected
 * from it. Keyed on `source` + `identifier` so a re-fetch is idempotent and a
 * row is always re-checkable against its authority.
 */
export function buildBibRecord({ rec, source, rawXml, query, fetchedAt = new Date() }) {
  if (!source) throw new Error('buildBibRecord: missing source');
  const identifiers = extractIdentifiers(rec);
  const { work_type, evidence: workTypeEvidence } = classifyWorkType(rec);
  const { completeness, evidence: completenessEvidence } = classifyCompleteness(rec, work_type);

  const identifier = identifiers.lccn
    ?? identifiers.oclc?.[0]
    ?? identifiers.isbn?.[0]
    ?? identifiers.lc_control_number;
  if (!identifier) throw new Error('buildBibRecord: record carries no external identifier');

  return {
    _key: `${source}:${identifier}`,
    source,
    identifier,
    identifiers,

    title: mainTitle(rec),
    uniform_title: uniformTitle(rec) || undefined,
    statement_of_responsibility: statementOfResponsibility(rec) || undefined,
    contributors: contributors(rec),
    pub_year: publicationYear(rec),
    publisher: publisher(rec) || undefined,

    work_type,
    work_type_evidence: workTypeEvidence,
    completeness,
    completeness_evidence: completenessEvidence,

    item_language: itemLanguage(rec) || undefined,
    original_languages: originalLanguages(rec),
    subject_headings: subjectHeadings(rec),
    extent_pages: extentPages(rec),

    // The point of the collection: keep the payload so a field nobody thought
    // mattered is a re-projection away rather than an impossible re-fetch.
    raw_marcxml: rawXml,
    raw_format: 'marcxml',
    query: query || undefined,
    fetched_at: fetchedAt,
  };
}

/**
 * Project a `bib_records` document into a `translation_catalogs` row shape.
 * Returns null for records that are not translations — a study must never enter
 * the registry as a prior translation (the Godwin defect).
 */
export function projectToCatalogRow(bib, { sourceLanguageIso } = {}) {
  if (bib.work_type !== 'translation') return null;

  const translator = bib.contributors.find((c) => c.role === 'translator')
    ?? bib.contributors.find((c) => c.marc_tag === '700')
    ?? null;
  const author = bib.contributors.find((c) => c.marc_tag === '100' || c.marc_tag === '110') ?? null;

  return {
    source: `bib_records:${bib.source}`,
    bib_record_key: bib._key,
    lccn: bib.identifiers.lccn,
    isbn: bib.identifiers.isbn,
    oclc: bib.identifiers.oclc,
    author: author?.name ?? '',
    english_title: bib.title,
    original_title: bib.uniform_title,
    translator: translator?.name ?? '',
    pub_year: bib.pub_year != null ? String(bib.pub_year) : '',
    publisher: bib.publisher ?? '',
    completeness: bib.completeness,
    source_language: sourceLanguageIso ?? bib.original_languages[0] ?? '',
    work_type: bib.work_type,
  };
}
