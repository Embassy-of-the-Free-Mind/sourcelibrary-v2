// PRIOR ART: none — the claim-id rule shared by analyze.mjs and build-second.mjs (#7947), so the second reader's
// verdicts key back onto the first reader's calls. Looked in scripts/eval/spot-check/ (score.mjs keys by page, not claim).
export const classOf = (e) => String(e.class ?? '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? (e.class ? `other:${e.class}` : 'none');
export const WRONG_TEXT_T = /^T(1|9|10|17)$/;

/** Plain-words kind of one error, from its class first, then its own words. */
export function kindOf(e, lane) {
  const c = classOf(e);
  const t = `${e.problem ?? ''} ${e.note ?? ''} ${e.ocr ?? ''} ${e.image ?? ''} ${e.source ?? ''}`;
  if (/^I[57]$/.test(c) || c === 'O14' || /microfilm|contact[- ]?strip|strip of (five|six|\d) openings|openings in one strip/i.test(t)) return 'strip of several openings: described or invented, not read';
  if (/^I[12]$/.test(c) || /wrong leaf|another leaf|different leaf|printed pages away|next leaf/i.test(t)) return 'wrong leaf';
  if (/^I[34]$/.test(c) || /facing (page|leaf)|neighbou?r(ing)? (page|leaf)|unsplit spread|full opening/i.test(t)) return 'facing page read into this one';
  if (lane === 'tr') {
    if (/OCR|transcri|misread in the source|from the source error|garbled source|follows the (bad|wrong)/i.test(t) || c === 'T7') return 'translation error carried from the OCR';
    if (WRONG_TEXT_T.test(c) || /omit|dropped|missing|skipp|not translated|untranslated/i.test(t)) return 'translation drops or invents a passage';
    return 'translation-only sense error';
  }
  if (/long[- ]s|\bſ\b|ſ|\bs\/f\b|\bf\/s\b|\bf for s\b|\bs for f\b/i.test(t)) return 'long s / f';
  // Reviewers write the leaf's expansions in brackets (n[on], q[uam]) or keep the marks (nõ, ̃): a misread there is an abbreviation read wrongly.
  if (/abbrev|suspension|contraction|macron|tilde|nomen sacrum|brevigraph|ꝑ|ꝓ|ꝗ|ꝯ|q̄|p̄|⁊|expan/i.test(t)
    || /\p{L}\[[a-z]{1,6}\]|[̃̄̅]|[õũĩẽñ]/u.test(String(e.image ?? ''))) return 'abbreviation expanded wrongly';
  if (c === 'O7' || /numer|digit|date|year|citation|chapter|verse|folio|roman numeral|number/i.test(t)) return 'numerals / citations';
  if (c === 'O12' || c === 'O13' || /margin|gloss|annotation|later hand/i.test(t)) return /invent|not on|absent|fabricat/i.test(t) ? 'invented margin' : 'margin mishandled';
  if (/^O(1|2|3)$/.test(c) || /invent|fabricat|not on the (page|leaf|image)|confabul|hallucin/i.test(t)) return 'invented text';
  if (c === 'O5' || c === 'O4' || /omit|dropped|missing|skipp|line lost|lacuna/i.test(t)) return 'dropped line or phrase';
  if (c === 'O8' || /normali[sz]/i.test(t)) return 'normalised toward the expected';
  return 'other misread word';
}

/** Every error of a review page, flat, with a stable claim id (the second reader's key). */
export function claimsOf(bookId, pg) {
  const out = [];
  const push = (lane, list) => (list || []).forEach((e, i) => out.push({ claim_id: `${bookId}:${pg.page_number}:${lane}:${i}`, lane, e }));
  push('ocr', pg.ocr_errors); push('tr', pg.tr_errors); push('other', pg.other);
  if (pg.right_page === 'no' && !out.some((x) => x.e.severity === 'serious' && /^I[12]$/.test(classOf(x.e)))) {
    out.push({ claim_id: `${bookId}:${pg.page_number}:leaf:0`, lane: 'other', e: { note: 'right_page: no — the image is not the leaf of this text', severity: 'serious', class: 'I1' } });
  }
  return out;
}
