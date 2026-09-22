// The SKOS/PROV-O exporter must round-trip the alias vocabulary and keep the tier semantics apart:
// a variant is an altLabel, an equivalent is a closeMatch, a related term is skos:related — never
// flattened into one synonym ring. Also pins the concept URI scheme, which a downstream graph
// (knowledge-graph synthesis) consumes as-is.
import { describe, it, expect } from 'vitest';
import vocab from '../../src/data/concept-aliases.json';
import { NS, slug, langTag, buildGraph, toJsonLd, fromJsonLd, toTurtle, graphStats } from '../../scripts/lib/concept-aliases-skos.mjs';

type Row = { term: string; confidence: number; reason: string; note?: string };
type Concept = { concept: string; theme?: string; tradition?: string; variants: Row[]; equivalents: Row[]; related: Row[] };
const V = vocab as unknown as { _meta: { built: string; source: string }; concepts: Concept[] };

const strip = (c: Concept) => ({
  concept: c.concept, theme: c.theme, tradition: c.tradition,
  variants: c.variants.map((r) => [r.term, r.confidence, r.reason, r.note ?? undefined]),
  equivalents: c.equivalents.map((r) => [r.term, r.confidence, r.reason, r.note ?? undefined]),
  related: c.related.map((r) => [r.term, r.confidence, r.reason, r.note ?? undefined]),
});

describe('concept-aliases SKOS export', () => {
  it('round-trips every concept, tier and row through JSON-LD', () => {
    const back = fromJsonLd(toJsonLd(V));
    expect(back.concepts.length).toBe(V.concepts.length);
    expect(back._meta.built).toBe(V._meta.built);
    for (let i = 0; i < V.concepts.length; i++) expect(strip(back.concepts[i] as Concept)).toEqual(strip(V.concepts[i]));
  });

  it('keeps the three tiers on three different predicates', () => {
    const g = buildGraph(V);
    const byTier = { variant: new Set<string>(), equivalent: new Set<string>(), related: new Set<string>() };
    for (const a of g.assertions) byTier[a.tier as keyof typeof byTier].add(a.predicate);
    expect([...byTier.variant]).toEqual(['skos:altLabel']);
    expect([...byTier.equivalent]).toEqual(['skos:closeMatch']);
    expect([...byTier.related]).toEqual(['skos:related']);
    // an equivalent is never asserted as a label of the concept
    for (const c of g.concepts) for (const e of V.concepts.find((x) => x.concept === c.prefLabel)!.equivalents) {
      expect(c.altLabels.map((a) => a.term)).not.toContain(e.term);
    }
  });

  it('pins the concept URI scheme consumers depend on', () => {
    expect(NS.base).toBe('https://sourcelibrary.org/concept/');
    expect(slug('dhikr')).toBe('dhikr');
    expect(slug('remembrance of God')).toBe('remembrance-of-god');
    expect(slug('坐忘')).toBe(encodeURIComponent('坐忘'));
    const g = buildGraph(V);
    for (const c of g.concepts) expect(c.id).toBe(NS.base + slug(c.prefLabel));
  });

  it('tags non-Latin labels by script only, never by a guessed language', () => {
    expect(langTag('ذكر')).toBe('und-Arab');
    expect(langTag('ἡσυχία')).toBe('und-Grek');
    expect(langTag('坐忘')).toBe('und-Hani');
    expect(langTag('བསམ་གཏན་')).toBe('und-Tibt');
    expect(langTag('samādhi')).toBeNull();
    const ttl = toTurtle(V);
    expect(ttl).not.toMatch(/"@(ar|fa|el|zh|bo|he)\b/);
  });

  it('carries provenance on every assertion and evidence only when a row has it', () => {
    const first = V.concepts[0];
    const patched = { ...V, concepts: [{ ...first, variants: [{ ...first.variants[0], evidence: 'https://sourcelibrary.org/book/000000000000000000000000?page=1' }] }] };
    const doc = toJsonLd(patched as never) as { '@graph': Array<Record<string, unknown>> };
    const asserts = doc['@graph'].filter((n) => ([] as string[]).concat(n['@type'] as string | string[]).includes('sl:AliasAssertion'));
    expect(asserts.length).toBeGreaterThan(0);
    for (const a of asserts) expect((a['prov:wasGeneratedBy'] as { '@id': string })['@id']).toMatch(/judge-run-/);
    expect(asserts.filter((a) => a['prov:hadPrimarySource']).length).toBe(1);
    // the real vocabulary carries no evidence URLs yet — assert that honestly, so the day it does this is the line that changes
    expect(graphStats(V).with_evidence).toBe(0);
  });

  it('emits Turtle whose subject count matches the graph, with prefixes declared', () => {
    const g = buildGraph(V);
    const ttl = toTurtle(V);
    const subjects = ttl.split('\n').filter((l) => /^<https:\/\/sourcelibrary\.org\/concept\//.test(l)).length;
    // scheme + activity + concepts + minted terms + assertions
    expect(subjects).toBe(2 + g.concepts.length + g.terms.length + g.assertions.length);
    expect(ttl).toMatch(/^@prefix skos: <http:\/\/www\.w3\.org\/2004\/02\/skos\/core#> \.$/m);
    expect(ttl).toMatch(/^@prefix prov: <http:\/\/www\.w3\.org\/ns\/prov#> \.$/m);
    // a reason containing a double quote must be escaped, not close the literal
    const reasonWithQuote = g.assertions.find((a) => a.reason && a.reason.includes('"'));
    if (reasonWithQuote) expect(ttl).toContain(reasonWithQuote.reason.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 40));
  });
});
