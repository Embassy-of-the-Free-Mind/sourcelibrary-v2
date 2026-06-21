/**
 * WORKFLOW-DSL tie-break for the 10 Claude/Gemini disagreements (#2684).
 * A third independent grounded Claude agent per disputed work, with the STRICT
 * completeness rule made explicit (a partial/excerpt English rendering does NOT
 * make a work "translated"). args = [{k,a,t,y,n}]. Returns [{key, ...verdict}].
 */
export const meta = {
  name: 'gap-validation-tiebreak',
  description: 'Third independent grounded adjudication of the 10 dual-adjudicator disagreements (#2684)',
  phases: [{ title: 'Tiebreak', detail: 'strict-completeness grounded re-check' }],
};

const SCHEMA = {
  type: 'object',
  properties: {
    translation_verdict: { type: 'string', enum: ['translated', 'untranslated', 'uncertain'] },
    relationship: { type: 'string', enum: ['same_work', 'different_source_language', 'partial', 'container', 'none'] },
    complete_prior_exists: { type: 'boolean' },
    prior: { type: 'string' },
    evidence_url: { type: 'string' },
    evidence_strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
    queries: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['translation_verdict', 'relationship', 'complete_prior_exists', 'evidence_strength', 'reasoning'],
};

const prompt = (w) => `You are the deciding third adjudicator for a translation-history study; two prior models DISAGREED on this work. Settle it with REAL web search (WebSearch/WebFetch): Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies.

WORK: "${w.t}"
AUTHOR: ${w.a || 'unknown'}
PRINTED: ${w.y}${w.n > 1 ? ` (${w.n} editions known)` : ''}

QUESTION: Does a COMPLETE published English translation of THIS specific work exist, by anyone, at any date?
STRICT COMPLETENESS RULE (this is the crux of the disagreement):
 - "translated" requires a COMPLETE English translation of this work. Set complete_prior_exists=true and give it.
 - A partial/excerpt/anthology-selection English rendering does NOT qualify → relationship "partial", verdict "untranslated", complete_prior_exists=false.
 - A Latin reprint / critical edition without translation / a translation of a DIFFERENT work does NOT qualify.
 - A multi-work container/Opera where the claim is ill-defined → relationship "container".
 - Only assert a complete translation if search actually shows it; never invent one.

Return the structured verdict. Reasoning <=2 sentences; cap queries/sources to 5 each.`;

let works = args;
if (typeof works === 'string') { try { works = JSON.parse(works); } catch { works = []; } }
if (!Array.isArray(works)) works = [];
phase('Tiebreak');
log(`Tie-breaking ${works.length} disputed works`);

const results = await parallel(
  works.map((w) => () =>
    agent(prompt(w), { label: `tie:${w.k}`, phase: 'Tiebreak', schema: SCHEMA, agentType: 'general-purpose' })
      .then((v) => (v ? { key: w.k, ...v } : { key: w.k, translation_verdict: 'FAIL' }))
      .catch(() => ({ key: w.k, translation_verdict: 'FAIL' }))
  )
);
return results.filter(Boolean);
