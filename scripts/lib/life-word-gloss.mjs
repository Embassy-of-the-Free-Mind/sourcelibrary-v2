// PRIOR ART: scripts/analysis/experience-map/ontology/apparatus-share.mjs — places a phrase in OCR / body /
// apparatus for the aliveness ontology, but per ontology node over a random search sample, with no notion of a
// source that licenses the phrase; scripts/maintenance/apply-gloss-corrections.mjs — hand-written span edits on
// named pages, no detection. scripts/lib/page-integrity.mjs holds the other translation rules, but this one is a
// vocabulary rule tied to one prompt line (#7458), so it lives beside it rather than in it.
/**
 * "Life force" in the translator's own apparatus (#7458).
 *
 * The aliveness reading found the model's <gloss>/<note>/<term> calling 氣, prāṇa, āyus, srog, viriditas or the
 * Archeus a "life force" / "vital energy" where the source says breath, vapour, lifespan, greenness. 17,696 pages
 * carried it in 2026-10 (<gloss>vital energy</gloss> alone on 4,550, nearly all 氣). Translation prompt v21 tells the
 * model to keep those words for a source that names such a force itself (vis vitalis, Lebenskraft, force vitale).
 *
 * lifeWordFindings(translation, ocr) finds the phrases INSIDE the apparatus and says whether the source licenses
 * them. A phrase is licensed when the OCR names a vital force in its own words (LICENSING_SOURCE). Flag-only: the
 * rule never decides that a page is wrong, it counts where the vocabulary appears.
 */

/** "life force", "life-force", "lifeforce", "vital energy", "vital force", "life energy", "vital life force"… */
export const LIFE_PHRASE = /\b(?:vital\s+life[\s-]?forces?|life[\s-]?forces?|vital\s+(?:energy|energies|forces?)|life[\s-]energ(?:y|ies))\b/gi;

/** The source names a vital force itself: Latin, German, French, Italian, Dutch, English. */
export const LICENSING_SOURCE = new RegExp([
  String.raw`\bvi(?:s|m|ri)?\s+vital(?:is|em|i|es|ibus)\b`, // vis vitalis, vim vitalem, vi vitali, vires vitales
  String.raw`\bvital(?:is|em|i)\s+vi(?:s|m)?\b`, // vitalis vis
  String.raw`lebens-?\s?kr[aä]ft`, // Lebenskraft, Lebens-Kraft, Lebenskräfte
  String.raw`\bforces?\s+vital(?:e|es)?\b`, // force vitale
  String.raw`\bforz[ae]\s+vital[ei]\b`,
  String.raw`levens-?kracht`,
  String.raw`\bvital\s+forces?\b`, String.raw`\blife[\s-]?forces?\b`, String.raw`\bvital\s+energ`,
].join('|'), 'iu');

const APPARATUS = /<(gloss|note|term)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

/**
 * @returns {{ hits: {tag:string, phrase:string, span:string}[], licensed: boolean, unlicensed: number }}
 *   hits: every life phrase inside a <gloss>, <note> or <term> (a <term> nested in a <note> counts once, as note);
 *   licensed: the OCR itself names a vital force; unlicensed: hits.length when not licensed, else 0.
 */
export function lifeWordFindings(translation, ocr = '') {
  const text = String(translation || '');
  const hits = [];
  for (const m of text.matchAll(APPARATUS)) {
    for (const p of m[2].matchAll(LIFE_PHRASE)) hits.push({ tag: m[1].toLowerCase(), phrase: p[0], span: m[2].slice(0, 160) });
  }
  const licensed = LICENSING_SOURCE.test(String(ocr || ''));
  return { hits, licensed, unlicensed: licensed ? 0 : hits.length };
}

/** The same phrases anywhere in the English a reader reads (body + apparatus), for the control pages. */
export function lifePhraseCount(translation) {
  return (String(translation || '').replace(/<(summary|keywords|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').match(LIFE_PHRASE) || []).length;
}

/** Mongo prefilter for a walk: a superset of LIFE_PHRASE (tests pin it). */
export const LIFE_PHRASE_PREFILTER = /life[\s-]?force|vital\s+(?:energ|force|life)|life[\s-]energ/i;
