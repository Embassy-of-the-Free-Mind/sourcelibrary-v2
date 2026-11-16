// PRIOR ART: ingest.mjs's ENGLISH test reads books.language / original_language only, so it misses a book catalogued
// as Dutch or Ge'ez whose work was written in English; scripts/lib/english-original-text.mjs decides which TEXT a
// page serves, not whether a work has an English original. Neither reads what the search itself said.
//
// Does the fresh search's own answer say the work was written in English? (v3#32)
//
// A "first English translation" badge is false when the work was English to begin with: the book is a translation
// FROM English (a 1688 Dutch Isaac Ambrose, a 1706 Dutch Purchas voyage), or is itself an English book under a
// non-English language tag (Mercer's The Ethiopic Liturgy, catalogued Ge'ez). The search usually says so in plain
// words ("first published in English", "this is an English-language work", "the English is the original") and
// still answers none_found, because it was asked for a PRIOR translation and found none. On 2026-11-13 a spot check of
// 20 new badges found 2 such, and a screen of every ingested nightly found 19 more still badged (all retracted).
//
// The pattern is deliberately narrow: a false hit only withholds a badge (the attempt row is still written and the
// book can be searched again), but a loose "English" would fire on "English original writs" (a Register of Writs)
// or "English and Italian manuscripts". Those two are pinned in the test as must-not-match.

const ENGLISH_ORIGIN = new RegExp([
  String.raw`(first|originally) (written|published|printed) in English`,
  String.raw`(written|composed) (the work )?in English`,
  String.raw`translat\w* (made )?(from|of) (the|an|his|her|their) English (original|text|letters?|pamphlet|essays|work|narratives?|account)`,
  // Not "its commentary was translated from English into French": that is a modern apparatus, not the work.
  String.raw`translat\w* (made )?from English\b(?! into)`,
  // "a Dutch translation, published in 1706 by ..., of the English letters": same sentence, no full stop between.
  String.raw`\btranslation\b[^.]{0,100}\bof the English (original|text|letters?|pamphlet|essays|work|narratives?|account)`,
  // Not "which claimed an English original" (a pamphlet's false attribution) or "English original writs" (a legal form).
  String.raw`(?<!claimed an )\bEnglish original\b(?! and judicial| writs)`,
  String.raw`\bthe English (text )?is the (original|source)`,
  String.raw`\b(is|was) (itself )?an? (original )?English(-language)? (work|book|text|paper|study|treatise)`,
  String.raw`first printed in English`,
].join('|'), 'i');

/** The phrase that shows the work was written in English, or null. Reads `work_identified` and `card`. */
export function englishOriginEvidence(r) {
  const text = `${r?.work_identified ?? ''} ${r?.card ?? ''}`;
  const m = ENGLISH_ORIGIN.exec(text);
  return m ? m[0] : null;
}
