#!/usr/bin/env node
/**
 * Generates the bulk Tier-2 adjudication WORKFLOW script with the 462-book
 * worklist embedded (issue #2564). Run, then: Workflow({scriptPath: out}).
 * Embedding via codegen keeps the 70KB worklist out of the orchestrator's
 * context.
 */
import { readFileSync, writeFileSync } from 'fs';

const worklist = JSON.parse(readFileSync('scripts/eval/results/ft-tier2-rerun-worklist.json', 'utf8'));
const OUT = 'scripts/eval/ft-tier2-rerun.workflow.js';

const script = `export const meta = {
  name: 'ft-tier2-rerun',
  description: 'Bulk Tier-2 first-translation adjudication over the 462-book stratified sample (#2564)',
  phases: [{ title: 'Adjudicate', detail: 'one tradition-aware agent per sampled book' }],
};

const WORKLIST = ${JSON.stringify(worklist)};

const SCHEMA = {
  type: 'object',
  required: ['book_id', 'verdict', 'evidence_strength', 'our_completeness', 'match_key', 'confidence', 'reason'],
  properties: {
    book_id: { type: 'string' },
    verdict: { type: 'string', enum: ['first_no_prior','first_from_source','first_complete','first_modern','not_first','not_applicable','unverifiable','needs_review'] },
    prior_relationship: { type: 'string', enum: ['same_text','same_work_diff_edition','different_source_language','related_distinct_work','partial','adaptation','none'] },
    evidence_strength: { type: 'string', enum: ['strong','moderate','weak'] },
    our_completeness: { type: 'string', enum: ['complete','partial','unknown'] },
    match_key: { type: 'string', enum: ['work_id','author_title','transliteration','none'] },
    confidence: { type: 'string', enum: ['high','medium','low'] },
    prior_found: { type: 'boolean' },
    sources_checked: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    reason: { type: 'string' },
  },
};

function sourcesFor(lang) {
  const l = (lang || '').toLowerCase();
  if (l.includes('tibet')) return '84000.co, BDRC/library.bdrc.io, Lotsawa House, treasuryoflives.org, rigpawiki';
  if (l.includes('chin') || l.includes('japan') || l.includes('korea')) return 'CTEXT (ctext.org), CBETA, sinological scholarship, WorldCat';
  if (l.includes('sanskrit') || l.includes('tamil') || l.includes('pali')) return 'GRETIL, SuttaCentral, Clay Sanskrit Library, indological scholarship';
  if (l.includes('hebrew') || l.includes('arab') || l.includes('syriac') || l.includes('aramaic')) return 'Sefaria, Brill, scholarship, WorldCat';
  return 'Google Books, archive.org, HathiTrust, OpenLibrary, OpenAlex, academic scholarship';
}

function buildPrompt(b) {
  return [
    'You are a first-translation adjudicator. Decide whether OUR book is the FIRST English translation of THIS specific text.',
    '',
    'OUR BOOK:',
    '- book_id: ' + b.id,
    '- Title: ' + b.t,
    '- Author: ' + b.a,
    '- Language of our text (the SOURCE-language original we scanned): ' + b.l,
    '',
    'IMPORTANT — SOURCE LIBRARY MODEL: our book record IS the source-language original (its language is ' + b.l + ', e.g. Latin/German/Chinese) AND we have produced an English translation of it. This is a VALID first-translation candidate. Do NOT mark not_applicable merely because our text is in the original language — that is exactly what a first translation translates FROM. The question is: does a PRIOR English translation of THIS text already exist?',
    '',
    'RULES:',
    '1. Identify the work precisely; SEPARATE it from related/parent/sibling works and other editions (related_distinct_work vs same_work_diff_edition).',
    '2. Search TRADITION-APPROPRIATE sources: ' + sourcesFor(b.l) + '. Web-search the title/author + "English translation".',
    '3. SOURCE-LANGUAGE RULE: a prior English translation of the same work from a DIFFERENT source language still counts (-> not_first or first_from_source); a translation of a DIFFERENT work does NOT count.',
    '4. COMPLETE vs PARTIAL: only partial/excerpt English exists -> first_complete. Only pre-1900 English -> first_modern. No prior English at all -> first_no_prior.',
    '5. Use not_applicable ONLY when there is no coherent first-English claim: visual art (maps/charts/engravings, no translatable prose), a scripture-manuscript copy of canonical scripture, a multi-work container/anthology/opera-omnia (claim ill-defined), OR our item is itself a NON-English translation (e.g. a Dutch edition of a Portuguese work). A plain source-language original we translated is NOT one of these.',
    '6. If competent sources are catalog-blind and you cannot bound the search -> unverifiable. If evidence conflicts / identity unresolved -> needs_review.',
    '',
    'evidence_strength: strong = prior positively found OR absence confirmed in competent sources; moderate = well-searched bounded absence; weak = only a blind/uncertain search.',
    'Return the structured verdict. reason <= 280 chars. Set prior_found true if any candidate English translation was located (even if ruled out as a different work).',
  ].join('\\n');
}

const results = await pipeline(
  WORKLIST,
  (b) => agent(buildPrompt(b), { schema: SCHEMA, phase: 'Adjudicate', agentType: 'general-purpose', label: b.l + ':' + b.id.slice(-6) }),
);

const verdicts = results.filter(Boolean);
const tally = {};
for (const v of verdicts) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
log('Adjudicated ' + verdicts.length + '/' + WORKLIST.length + ' — ' + JSON.stringify(tally));
return { count: verdicts.length, total: WORKLIST.length, tally, verdicts };
`;

writeFileSync(OUT, script);
console.log('wrote', OUT, '(' + script.length + ' bytes, ' + worklist.length + ' books)');
