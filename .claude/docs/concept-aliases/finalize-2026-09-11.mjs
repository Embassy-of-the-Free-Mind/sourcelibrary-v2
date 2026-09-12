// Second-pass curation over the eight judges' verdicts (main session, 2026-09-11):
// mechanical guards + hand overrides from reading all 592 accepted rows, then the curated
// concept-alias vocabulary.  node finalize.mjs
import fs from 'node:fs';
const all = fs.readFileSync('verdicts-all.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const seeds = JSON.parse(fs.readFileSync('/Users/dereklomas/sourcelibrary/scratchpad/concepts/seeds.json', 'utf8'));
const seedByPref = new Map(seeds.map((s) => [s.pref, s]));

const fold = (s) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const nonLatin = (s) => /[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(s);
const FLOOR = 0.7; // raised from the rubric's 0.6 after reading the accepted set: every row at 0.6–0.69 was a case I would demote

// Hand overrides: term_keys to demote to `related`, with the reason. Read from the full expansion set.
const DEMOTE = {
  'initiation': { keys: ['mysteries', 'mysteria', 'μυστήρια', 'Μυστήρια', 'mysteriis', 'mysteres', 'misteres', 'misteria', 'mysterien', 'mysterion', 'mysteriorum', 'mysterijs', 'mysteriois', 'raze', 'arze', 'araze', 'razze', 'ܐܪ̈ܙܐ', 'ܪ̈ܙܐ'], why: 'the mystery family in Christian/Gnostic texts means sacraments or doctrinal mysteries, not initiation rites; would swamp the search' },
  'mind': { keys: ['xin', 'thugs'], why: 'homograph noise in evidence (xin = new; Thuggee)' },
  'intellect': { keys: ['mens', 'mente', 'mentem'], why: 'mens is mind, not intellect; the scholastic distinction is the point of this concept' },
  'dhikr': { keys: ['zekr'], why: 'judge notes an unrelated sense (zakar) in the evidence' },
  'masonic ritual': { keys: ['franc-maconnerie', 'maconnique', 'masonic'], why: 'Freemasonry / masonic in general is not the ritual; expansion would match every masonic book' },
};
const MALFORMED = (k) => /[()（）]/.test(k) || /^[-–—]\s/.test(k) || /\s[—–]\s/.test(k) || /[:;]/.test(k);

const out = [];
const stats = { variant: 0, equivalent: 0, related: 0, reject: 0, floorDemoted: 0, stemRetagged: 0, handDemoted: 0, malformed: 0 };
for (const c of all) {
  const seed = seedByPref.get(c.concept) || {};
  const stem = fold(c.concept).replace(/[^a-z]/g, '').slice(0, 4);
  const entry = { concept: c.concept, theme: seed.theme, tradition: seed.tradition, variants: [], equivalents: [], related: [], rejected: 0 };
  for (const v of c.verdicts) {
    let tier = v.tier, note = null;
    if (tier !== 'reject' && MALFORMED(v.term_key)) { tier = 'reject'; note = 'malformed key'; stats.malformed++; }
    else if ((tier === 'variant' || tier === 'equivalent') && v.confidence < FLOOR) { tier = 'related'; note = `below ${FLOOR} floor`; stats.floorDemoted++; }
    else if (DEMOTE[c.concept]?.keys.includes(v.term_key) && (tier === 'variant' || tier === 'equivalent')) { tier = 'related'; note = 'override: ' + DEMOTE[c.concept].why; stats.handDemoted++; }
    else if (tier === 'variant' && !nonLatin(v.term_key) && stem.length >= 3 && !fold(v.term_key).replace(/[^a-z]/g, '').includes(stem)) { tier = 'equivalent'; note = 'retagged: different-language rendering, expand with label'; stats.stemRetagged++; }
    stats[tier]++;
    const row = { term: v.term_key, confidence: v.confidence, reason: v.reason, ...(note ? { note } : {}) };
    if (tier === 'variant') entry.variants.push(row);
    else if (tier === 'equivalent') entry.equivalents.push(row);
    else if (tier === 'related') entry.related.push(row);
    else entry.rejected++;
  }
  out.push(entry);
}
fs.writeFileSync('concept-aliases.json', JSON.stringify({
  _meta: {
    built: '2026-09-11', source: 'page_terms harvest (#4695) over 38,287 books; 62 seed concepts from the theme maps; 8 Claude judges (opus) per JUDGE-RUBRIC.md + second pass by the main session',
    tiers: { variant: 'same word (script/spelling/inflection) — expand silently', equivalent: 'a translator\'s rendering in another language — expand, label the hit', related: 'adjacent concept or cross-tradition analogue — graph only, never expansion' },
    caveat: 'single CJK characters (占, 卜, 德, 夢) need word-boundary handling on the search side; never substring-match them',
  },
  concepts: out,
}, null, 1));
console.log(stats);
console.log('concepts', out.length, 'expansion terms', out.reduce((a, e) => a + e.variants.length + e.equivalents.length, 0));
