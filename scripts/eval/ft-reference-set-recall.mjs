#!/usr/bin/env node
/**
 * ft-reference-set-recall.mjs — how much is a `none_found` actually worth? (#3459)
 *
 * The whole design rests on asserting absence against a stated reference set. That
 * is only honest if we know the set's RECALL — how often it finds a translation
 * that genuinely exists. Until this script there was no such measurement, and
 * every `none_found` was being reported as though the set were complete.
 *
 * `translation_classification` (9,908 rows, built Feb-Jul 2026) is an independent
 * answer to the same question, with NAMED translators — Peterson's *Arbatel*,
 * Goold's Loeb *Astronomica*, Bram's *Ancient Astrology*, Rayudu's Sanskrit
 * editions. Books it marks `previously_translated` are known positives, so they
 * are a ready-made recall test set.
 *
 * MEASURED 2026-07-31, and it is the most important number in this project:
 *
 *     known previously-translated books the search examined : 607
 *     search surfaced a candidate                           : 132
 *     search reported none_found                            : 469
 *     RECALL                                                : 22.0%
 *
 * Four out of five known prior translations are invisible to the reference set.
 * The causes are already declared on it — 35.2% of LoC rows carry no MARC 240 and
 * cannot produce a confirmed match; scholarly editions printing a text with its
 * translation often carry no 041 and are excluded at extraction; Loeb, Kessinger
 * and small scholarly presses are thinly covered.
 *
 * CONSEQUENCES, stated plainly:
 *   - `none_found` is weak evidence, not strong. Any count built on it — including
 *     the inverse search's "works we translated and never claimed" — is inflated
 *     several-fold and must not be quoted.
 *   - The 42 verified demotes are UNAFFECTED. They are positive findings, each
 *     re-fetched live from LoC; poor recall cannot manufacture a false positive.
 *   - `translation_classification` should be a SOURCE in the reference set, not
 *     merely a yardstick. It already holds 2,231 known priors with attribution.
 *
 * PROCESS NOTE: this dataset existed in the database the whole time and was not
 * checked before a reference set was built from scratch. Look for prior work
 * first.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-reference-set-recall.mjs
 */
import { withMongo } from '/Users/dereklomas/sourcelibrary/.claude/worktrees/feat-bib-records/scripts/lib/mongo.mjs';
const load=f=>JSON.parse(fs.readFileSync(f,'utf8')).efforts;
const eff=[...load('/Users/dereklomas/sourcelibrary/.claude/worktrees/feat-bib-records/scripts/output/ft-reference-set-search-inverse-2026-07-31.json'),
           ...load('/Users/dereklomas/sourcelibrary/.claude/worktrees/feat-bib-records/scripts/output/ft-reference-set-search-badged-2026-07-31.json')];
const verdict=new Map(eff.map(e=>[e.book_id,e.verdict]));
await withMongo(async db=>{
  const tc=db.collection('translation_classification');
  const known=await tc.find({classification:'previously_translated'},{projection:{book_id:1,title:1,known_translation:1}}).toArray();
  console.log('books INDEPENDENTLY classified previously_translated: '+known.length);
  const checked=known.filter(k=>verdict.has(k.book_id));
  console.log('  ...that my search also examined: '+checked.length);
  const t={}; for(const k of checked) t[verdict.get(k.book_id)]=(t[verdict.get(k.book_id)]||0)+1;
  console.log('  my verdicts on them:', JSON.stringify(t));
  const found=(t.prior_found||0)+(t.only_partial_found||0)+(t.inconclusive||0);
  const missed=t.none_found||0;
  console.log('\n  RECALL of the reference set on known prior translations:');
  console.log('    surfaced a candidate : '+found);
  console.log('    reported none_found  : '+missed+'   <- FALSE NEGATIVES');
  if(found+missed) console.log('    recall               : '+((found/(found+missed))*100).toFixed(1)+'%');
}, { noTimeout: true });
