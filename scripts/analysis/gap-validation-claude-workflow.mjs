/**
 * WORKFLOW-DSL script (run via the Workflow tool, NOT plain node).
 *
 * Primary instrument for the n≈250 translation-gap validation (#2684): one
 * INDEPENDENT grounded-search Claude agent per blind work. Mirrors the n=30
 * pilot's design at scale. Blind = no pipeline label. Each agent answers two
 * questions (composition era + any prior English translation) under strict rules
 * and returns its queries + sources for the provenance log.
 *
 * args = array of blind works: {k,a,t,y,n}. Returns [{key, ...verdict}].
 */
export const meta = {
  name: 'gap-validation-claude-adjudicate',
  description: 'Independent grounded adjudication of 250 blind early-modern Latin works for the translation-gap validation (#2684)',
  phases: [{ title: 'Adjudicate', detail: 'one grounded web-search agent per work' }],
};

const SCHEMA = {
  type: 'object',
  properties: {
    composition_era: { type: 'string', enum: ['antiquity', 'medieval', 'renaissance_early_modern', 'unknown'] },
    composition_year_est: { type: 'integer' },
    translation_verdict: { type: 'string', enum: ['translated', 'untranslated', 'uncertain'] },
    relationship: { type: 'string', enum: ['same_work', 'different_source_language', 'partial', 'container', 'none'] },
    prior: { type: 'string' },
    evidence_url: { type: 'string' },
    evidence_strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
    queries: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['composition_era', 'translation_verdict', 'relationship', 'evidence_strength', 'reasoning'],
};

const prompt = (w) => `You are a bibliographic adjudicator for a translation-history study. Investigate ONE early-modern Latin work using REAL web search (WebSearch / WebFetch). Search Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies, and tradition-appropriate catalogues. Do NOT answer from memory alone — actually search.

WORK: "${w.t}"
AUTHOR: ${w.a || 'unknown'}
PRINTED: ${w.y}${w.n > 1 ? ` (${w.n} editions known)` : ''}

Answer TWO questions.

(1) COMPOSITION ERA — when was the TEXT composed (not printed)? An early-modern PRINT of an ancient or medieval author (a 1540 Cicero, a 1566 Aquinas, a 1549 Galen) is "antiquity" or "medieval"; a work written by a contemporary 15th–17th-century author is "renaissance_early_modern". Give your best composition-year estimate.

(2) PRIOR ENGLISH TRANSLATION — has THIS specific work EVER been published in an English translation, by anyone, at any date? STRICT RULES:
 - A Latin reprint, a modern critical edition WITHOUT a translation, or a facsimile does NOT count.
 - A translation of a DIFFERENT work by the same author does NOT count (relationship "different_source_language" only if it is the same work via another source language).
 - A partial / excerpt-only English rendering → relationship "partial" (still report it; verdict stays "untranslated" unless a complete one exists).
 - If this is a multi-work container / Opera / anthology where "a translation" is ill-defined → relationship "container".
 - Be skeptical of your own knowledge: only assert a translation exists if a search result actually shows it. Never invent translators/years.

Return the structured verdict. Keep reasoning to <=2 sentences, prior to <=1 sentence. Cap queries and sources to the 5 most informative each (full URLs for sources).`;

let works = args;
if (typeof works === 'string') { try { works = JSON.parse(works); } catch { works = []; } }
if (!Array.isArray(works)) works = [];
phase('Adjudicate');
log(`Adjudicating ${works.length} blind works (args type=${typeof args}) with independent grounded Claude agents`);

const results = await parallel(
  works.map((w) => () =>
    agent(prompt(w), { label: `adj:${w.k}`, phase: 'Adjudicate', schema: SCHEMA, agentType: 'general-purpose' })
      .then((v) => (v ? { key: w.k, ...v } : { key: w.k, translation_verdict: 'FAIL' }))
      .catch(() => ({ key: w.k, translation_verdict: 'FAIL' }))
  )
);

return results.filter(Boolean);
