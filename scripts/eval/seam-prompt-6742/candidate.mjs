// PRIOR ART: scripts/eval/PREREGISTRATION-translation-restraint*.md (#5349, "Stop where the page stops": end
// mid-sentence + <meta>, judged on page-level invention, null) and #5675 (seam lines "This page only", null on block-door
// invention) — both judged invention on the paid lite lane. This candidate names the three edge shapes the #6742 pilot
// found (an ellipsis at the foot or head, a sentence closed that the source carries on, a catchword rendered) and is
// judged on the #6742 join judge with the production CLI model. It is ONE added instruction on top of the v13 default.
/**
 * The seam-prompt candidate (#6742 job seam-prevent): v13 + one instruction after instruction 1.
 * `withSeamRule(v13)` is the exact text the A/B sends and the migration inserts, so the two cannot drift.
 */
export const SEAM_RULE = `1a. **The page's last words:** end exactly where this page's source ends. If the source stops in the middle of a sentence or clause, stop the English at the same point, mid-sentence: no ellipsis ("…" or "..."), no closing full stop, and no words added to finish it, because the next page carries the rest. A catchword (the next page's first word printed alone at the foot) is not translated. Never open a page with an ellipsis, and never translate again words that the previous page's translation already rendered.`;

const ANCHOR = /^1\. If the page continues a sentence from the previous page[^\n]*\n/m;

export function withSeamRule(base) {
  const m = String(base).match(ANCHOR);
  if (!m) throw new Error('seam-prompt candidate: instruction 1 ("If the page continues a sentence…") not found in the base prompt');
  const at = m.index + m[0].length;
  return base.slice(0, at) + SEAM_RULE + '\n' + base.slice(at);
}
