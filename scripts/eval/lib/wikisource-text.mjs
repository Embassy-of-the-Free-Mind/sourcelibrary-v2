// PRIOR ART: none — scripts/eval/lib/ has metrics.mjs (scoring), sampling.mjs (Mongo),
// runners.mjs (model APIs), revision-source.mjs (provenance labels). Wikitext cleaning
// lived inline in harvest-wikisource-gt.mjs; extracted here so it can be imported and
// unit-tested WITHOUT executing the harvester (that module is top-level-await script
// code, so importing it ran a whole live harvest — observed 2026-09-04).
/**
 * Wikisource Page: wikitext → the transcribed text of the page.
 */

/**
 * Strip proofread scaffolding to leave the transcribed text.
 *
 * Templates must be stripped ITERATIVELY. One pass of /\{\{[^{}]*\}\}/ removes only the
 * innermost template, so `{{κέντρο|{{μεγάλο|X}}}}` collapses to a surviving
 * `{{κέντρο| }}` — which then sits in the reference and gets scored against the OCR as
 * if the page printed it. Observed on el.wikisource; 25 of 146 harvested references
 * carried residue. This is silent REFERENCE corruption, the worst kind: the resulting
 * mismatch looks like an engine failure, so it is charged to the wrong party.
 */
export function cleanPageText(text) {
  let t = (text || '').replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, ' ');
  t = t.replace(/<\/?includeonly>/gi, '').replace(/<\/?noinclude>/gi, '');
  for (let i = 0; i < 8; i++) {                             // nested templates, innermost-out
    const next = t.replace(/\{\{[^{}]*\}\}/g, ' ');
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\{\{[^}]*?\}\}/g, ' ');                    // unbalanced leftovers
  t = t.replace(/\{\{|\}\}/g, ' ');                         // stray braces from broken markup
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');   // links → label
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/'''?/g, '');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** `<pagequality level="4" …/>` — 4 = validated (two proofreaders), 3 = proofread (one). */
export function pageQuality(text) {
  const m = (text || '').match(/<pagequality\s+level="(\d)"/i);
  return m ? parseInt(m[1], 10) : null;
}
