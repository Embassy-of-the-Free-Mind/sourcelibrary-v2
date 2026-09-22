// PRIOR ART: src/lib/jsonld.ts (Schema.org JSON-LD for entities/books — different vocabulary,
// no SKOS, no provenance); src/lib/concept-aliases.ts (reads the same data for SEARCH expansion,
// emits nothing); scripts/lib/ has no RDF/Turtle writer of any kind (checked 2026-09-12).
// None publishes the concept vocabulary as linked data, which is what a thesaurus is for.
/**
 * The curated concept vocabulary (#4725, `src/data/concept-aliases.json`) as SKOS + PROV-O.
 *
 * Why publish it at all: the vocabulary is the only machine-readable statement anyone outside this
 * codebase can use of what "dhikr" and "remembrance of God" have to do with each other, and on what
 * evidence. As JSON it is ours; as SKOS it joins the thesauri libraries already federate.
 *
 * The three tiers map onto SKOS honestly, and the mapping is the whole design:
 *   variant    → skos:altLabel on the concept        (same word, other script/spelling/inflection)
 *   equivalent → skos:closeMatch to a term resource  (a TRANSLATOR'S rendering — close, not same)
 *   related    → skos:related to a term resource     (adjacent; never an expansion)
 * Flattening equivalents into altLabel would assert that "remembrance of God" IS dhikr, which is
 * exactly the claim the tiering exists to avoid.
 *
 * Language tags: a non-Latin term gets `und-<Script>` (BCP-47: undetermined language, known
 * script) rather than a guessed language — ذكر in a Persian-tradition concept may be Arabic or
 * Persian, and inventing `@fa` would be a fabrication in a file whose point is provenance. Latin
 * script terms are romanisations of many languages, so they carry no tag.
 *
 * Every alias row is also emitted as a PROV-O entity carrying its confidence (prov:value), the
 * judge run that produced it (prov:wasGeneratedBy) and its one-line reason; a row that carries an
 * `evidence` URL (none do yet — the verdicts log keeps the quoted gloss, not the page) additionally
 * gets prov:hadPrimarySource.
 */

export const NS = {
  base: 'https://sourcelibrary.org/concept/',
  scheme: 'https://sourcelibrary.org/concept/scheme/concept-aliases',
  sl: 'https://sourcelibrary.org/ns/concept#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  prov: 'http://www.w3.org/ns/prov#',
  dct: 'http://purl.org/dc/terms/',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};

/** Stable, readable slug for a term or concept; non-Latin terms keep their characters percent-encoded. */
export function slug(term) {
  const s = String(term).normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');
  return encodeURIComponent(s).replace(/%2F/gi, '-');
}

const SCRIPTS = [
  ['Arab', /\p{Script=Arabic}/u], ['Hebr', /\p{Script=Hebrew}/u], ['Grek', /\p{Script=Greek}/u],
  ['Cyrl', /\p{Script=Cyrillic}/u], ['Deva', /\p{Script=Devanagari}/u], ['Tibt', /\p{Script=Tibetan}/u],
  ['Hani', /\p{Script=Han}/u], ['Jpan', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['Hang', /\p{Script=Hangul}/u],
  ['Sinh', /\p{Script=Sinhala}/u], ['Thai', /\p{Script=Thai}/u], ['Copt', /\p{Script=Coptic}/u],
  ['Syrc', /\p{Script=Syriac}/u], ['Armn', /\p{Script=Armenian}/u], ['Geor', /\p{Script=Georgian}/u],
  ['Ethi', /\p{Script=Ethiopic}/u], ['Egyp', /\p{Script=Egyptian_Hieroglyphs}/u], ['Xsux', /\p{Script=Cuneiform}/u],
];
/** BCP-47 tag for a term, or null when it is Latin script (a romanisation of who knows what). */
export function langTag(term) {
  for (const [code, re] of SCRIPTS) if (re.test(term)) return `und-${code}`;
  return null;
}

const TIER_PREDICATE = { variant: 'skos:altLabel', equivalent: 'skos:closeMatch', related: 'skos:related' };

/**
 * Build the graph as plain objects: { concepts, terms, assertions, activity } — the shape both
 * serialisers walk, and the shape `fromJsonLd` reconstructs, so the round trip is testable.
 */
export function buildGraph(vocab, { minConfidence = 0 } = {}) {
  const meta = vocab._meta || {};
  const activity = {
    id: `${NS.base}prov/judge-run-${(meta.built || 'undated').replace(/[^0-9a-z-]/gi, '')}`,
    label: meta.source || 'concept-alias judge run',
    endedAtTime: meta.built || null,
  };
  const headForms = new Map(); // folded head form / variant → concept URI, so a related term that IS a concept links to it
  for (const c of vocab.concepts) {
    headForms.set(c.concept.toLowerCase(), NS.base + slug(c.concept));
    for (const v of c.variants || []) headForms.set(String(v.term).toLowerCase(), NS.base + slug(c.concept));
  }
  const terms = new Map(); const concepts = []; const assertions = [];
  const termUri = (t) => headForms.get(String(t).toLowerCase()) || `${NS.base}term/${slug(t)}`;

  for (const c of vocab.concepts) {
    const uri = NS.base + slug(c.concept);
    const entry = { id: uri, prefLabel: c.concept, lang: langTag(c.concept), theme: c.theme || null, tradition: c.tradition || null, altLabels: [], closeMatch: [], related: [] };
    for (const tier of ['variants', 'equivalents', 'related']) {
      for (const row of c[tier] || []) {
        if ((row.confidence ?? 0) < minConfidence) continue;
        const t = String(row.term);
        const kind = tier === 'variants' ? 'variant' : tier === 'equivalents' ? 'equivalent' : 'related';
        if (kind === 'variant') { if (t.toLowerCase() !== c.concept.toLowerCase()) entry.altLabels.push({ term: t, lang: langTag(t) }); }
        else {
          const tu = termUri(t);
          if (tu !== uri) {
            (kind === 'equivalent' ? entry.closeMatch : entry.related).push(tu);
            if (!tu.startsWith(NS.base + 'term/')) { /* an existing concept: nothing to mint */ }
            else if (!terms.has(tu)) terms.set(tu, { id: tu, prefLabel: t, lang: langTag(t) });
          }
        }
        assertions.push({ id: `${uri}/alias/${slug(t)}`, concept: uri, term: t, tier: kind, confidence: row.confidence ?? null, reason: row.reason || null, note: row.note || null, evidence: row.evidence || null, predicate: TIER_PREDICATE[kind] });
      }
    }
    concepts.push(entry);
  }
  return { activity, concepts, terms: [...terms.values()], assertions, meta };
}

// ---------------------------------------------------------------- JSON-LD
export function toJsonLd(vocab, opts = {}) {
  const g = buildGraph(vocab, opts);
  const lit = (term, lang) => (lang ? { '@value': term, '@language': lang } : term);
  const graph = [
    { '@id': NS.scheme, '@type': 'skos:ConceptScheme', 'dct:title': 'Source Library concept aliases',
      'dct:description': g.meta.source || undefined, ...(g.meta.built ? { 'dct:created': { '@value': g.meta.built, '@type': 'xsd:date' } } : {}), 'prov:wasGeneratedBy': { '@id': g.activity.id } },
    { '@id': g.activity.id, '@type': 'prov:Activity', 'rdfs:label': g.activity.label, ...(g.activity.endedAtTime ? { 'prov:endedAtTime': { '@value': g.activity.endedAtTime, '@type': 'xsd:date' } } : {}) },
  ];
  for (const c of g.concepts) graph.push({
    '@id': c.id, '@type': 'skos:Concept', 'skos:inScheme': { '@id': NS.scheme },
    'skos:prefLabel': lit(c.prefLabel, c.lang),
    ...(c.altLabels.length ? { 'skos:altLabel': c.altLabels.map((a) => lit(a.term, a.lang)) } : {}),
    ...(c.closeMatch.length ? { 'skos:closeMatch': c.closeMatch.map((id) => ({ '@id': id })) } : {}),
    ...(c.related.length ? { 'skos:related': c.related.map((id) => ({ '@id': id })) } : {}),
    ...(c.theme ? { 'sl:theme': c.theme } : {}), ...(c.tradition ? { 'sl:tradition': c.tradition } : {}),
  });
  for (const t of g.terms) graph.push({ '@id': t.id, '@type': 'skos:Concept', 'skos:inScheme': { '@id': NS.scheme }, 'skos:prefLabel': lit(t.prefLabel, t.lang) });
  for (const a of g.assertions) graph.push({
    '@id': a.id, '@type': ['prov:Entity', 'sl:AliasAssertion'], 'sl:aboutConcept': { '@id': a.concept }, 'sl:term': a.term, 'sl:tier': a.tier,
    ...(a.confidence != null ? { 'prov:value': { '@value': String(a.confidence), '@type': 'xsd:decimal' } } : {}),
    ...(a.reason ? { 'rdfs:comment': a.reason } : {}), ...(a.note ? { 'skos:editorialNote': a.note } : {}),
    ...(a.evidence ? { 'prov:hadPrimarySource': { '@id': a.evidence } } : {}),
    'prov:wasGeneratedBy': { '@id': g.activity.id },
  });
  return { '@context': { skos: NS.skos, prov: NS.prov, dct: NS.dct, rdfs: NS.rdfs, xsd: NS.xsd, sl: NS.sl }, '@graph': graph };
}

/** Inverse of toJsonLd, back to the alias-JSON shape — the round trip the unit test asserts. */
export function fromJsonLd(doc) {
  const byId = new Map();
  for (const n of doc['@graph']) byId.set(n['@id'], n);
  const val = (v) => (v && typeof v === 'object' && '@value' in v ? v['@value'] : v);
  const concepts = new Map();
  for (const n of doc['@graph']) {
    if (n['@type'] !== 'skos:Concept' || !n['@id'].startsWith(NS.base) || n['@id'].startsWith(NS.base + 'term/')) continue;
    concepts.set(n['@id'], { concept: val(n['skos:prefLabel']), theme: n['sl:theme'] ?? undefined, tradition: n['sl:tradition'] ?? undefined, variants: [], equivalents: [], related: [] });
  }
  const meta = byId.get(NS.scheme) || {};
  for (const n of doc['@graph']) {
    const types = [].concat(n['@type'] || []);
    if (!types.includes('sl:AliasAssertion')) continue;
    const c = concepts.get(n['sl:aboutConcept']['@id']); if (!c) continue;
    const row = { term: n['sl:term'], confidence: n['prov:value'] ? Number(val(n['prov:value'])) : null, reason: n['rdfs:comment'] || '' };
    if (n['skos:editorialNote']) row.note = n['skos:editorialNote'];
    (n['sl:tier'] === 'variant' ? c.variants : n['sl:tier'] === 'equivalent' ? c.equivalents : c.related).push(row);
  }
  return { _meta: { built: val(meta['dct:created']) || undefined, source: meta['dct:description'] || undefined }, concepts: [...concepts.values()] };
}

// ---------------------------------------------------------------- Turtle
const ttlString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
const ttlLit = (s, lang) => ttlString(s) + (lang ? `@${lang}` : '');
export function toTurtle(vocab, opts = {}) {
  const g = buildGraph(vocab, opts);
  const L = [];
  for (const [pfx, iri] of Object.entries({ skos: NS.skos, prov: NS.prov, dct: NS.dct, rdfs: NS.rdfs, xsd: NS.xsd, sl: NS.sl })) L.push(`@prefix ${pfx}: <${iri}> .`);
  L.push('');
  L.push(`<${NS.scheme}> a skos:ConceptScheme ;`);
  L.push(`  dct:title ${ttlString('Source Library concept aliases')} ;`);
  if (g.meta.source) L.push(`  dct:description ${ttlString(g.meta.source)} ;`);
  if (g.meta.built) L.push(`  dct:created "${g.meta.built}"^^xsd:date ;`);
  L.push(`  prov:wasGeneratedBy <${g.activity.id}> .`);
  L.push('');
  L.push(`<${g.activity.id}> a prov:Activity ;`);
  L.push(`  rdfs:label ${ttlString(g.activity.label)}${g.activity.endedAtTime ? ' ;' : ' .'}`);
  if (g.activity.endedAtTime) L.push(`  prov:endedAtTime "${g.activity.endedAtTime}"^^xsd:date .`);
  L.push('');
  for (const c of g.concepts) {
    const parts = [`a skos:Concept`, `skos:inScheme <${NS.scheme}>`, `skos:prefLabel ${ttlLit(c.prefLabel, c.lang)}`];
    if (c.altLabels.length) parts.push(`skos:altLabel ${c.altLabels.map((a) => ttlLit(a.term, a.lang)).join(', ')}`);
    if (c.closeMatch.length) parts.push(`skos:closeMatch ${c.closeMatch.map((u) => `<${u}>`).join(', ')}`);
    if (c.related.length) parts.push(`skos:related ${c.related.map((u) => `<${u}>`).join(', ')}`);
    if (c.theme) parts.push(`sl:theme ${ttlString(c.theme)}`);
    if (c.tradition) parts.push(`sl:tradition ${ttlString(c.tradition)}`);
    L.push(`<${c.id}>\n  ` + parts.join(' ;\n  ') + ' .', '');
  }
  for (const t of g.terms) L.push(`<${t.id}>\n  a skos:Concept ;\n  skos:inScheme <${NS.scheme}> ;\n  skos:prefLabel ${ttlLit(t.prefLabel, t.lang)} .`, '');
  for (const a of g.assertions) {
    const parts = [`a prov:Entity, sl:AliasAssertion`, `sl:aboutConcept <${a.concept}>`, `sl:term ${ttlString(a.term)}`, `sl:tier ${ttlString(a.tier)}`];
    if (a.confidence != null) parts.push(`prov:value "${a.confidence}"^^xsd:decimal`);
    if (a.reason) parts.push(`rdfs:comment ${ttlString(a.reason)}`);
    if (a.note) parts.push(`skos:editorialNote ${ttlString(a.note)}`);
    if (a.evidence) parts.push(`prov:hadPrimarySource <${a.evidence}>`);
    parts.push(`prov:wasGeneratedBy <${g.activity.id}>`);
    L.push(`<${a.id}>\n  ` + parts.join(' ;\n  ') + ' .', '');
  }
  return L.join('\n');
}

/** Counts a consumer (or a test) can assert without a full parser. */
export function graphStats(vocab, opts = {}) {
  const g = buildGraph(vocab, opts);
  return { concepts: g.concepts.length, minted_terms: g.terms.length, assertions: g.assertions.length,
    altLabels: g.concepts.reduce((s, c) => s + c.altLabels.length, 0),
    closeMatch: g.concepts.reduce((s, c) => s + c.closeMatch.length, 0),
    related: g.concepts.reduce((s, c) => s + c.related.length, 0),
    with_evidence: g.assertions.filter((a) => a.evidence).length };
}

// CLI: node scripts/lib/concept-aliases-skos.mjs [--format ttl|jsonld] [--min-confidence 0.7] > out
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const fs = await import('node:fs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const vocab = JSON.parse(fs.readFileSync(new URL('../../src/data/concept-aliases.json', import.meta.url), 'utf8'));
  const opts = { minConfidence: +arg('--min-confidence', 0) };
  process.stdout.write(arg('--format', 'ttl') === 'jsonld' ? JSON.stringify(toJsonLd(vocab, opts), null, 1) : toTurtle(vocab, opts));
  console.error(JSON.stringify(graphStats(vocab, opts)));
}
