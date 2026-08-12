/**
 * Turn a Latin genitive name from a title page into a nominative — by LOOKUP,
 * not by grammar. (#3894 item 5 follow-up)
 *
 * `title-page-attribution.mjs` reads authors off title pages, and the commonest
 * author position is a genitive head: "Auli Gellii Noctium Atticarum libri",
 * "Nicolai Clenardi Institutiones", "Gasparis Contareni ... De magistratibus".
 * Those name the right person in the wrong case. 51 of 112 queue rows are like
 * this, and writing one verbatim puts a declined form in a byline — the trap
 * that nearly caught "Marci Antonii Nattae" during the item-2 pass.
 *
 * WHY NOT DECLINE IT. Latin nominatives are not recoverable from a genitive by
 * rule: -i comes from both -us (Gellii → Gellius) and -um; third-declension
 * stems change shape entirely (Gasparis → Gaspar, Clenardi → Clenardus but
 * Salmasii → Salmasius); and Greek names imported into Latin follow neither.
 * A rule engine would be wrong often and confidently.
 *
 * The corpus already holds the answer. The `authors` thesaurus stores NOMINATIVE
 * canonical names with `variants[]`, and `sameNameForm` already folds Latin
 * endings — so "Nicolai Clenardi" and "Nicolaus Clenardus" reach the same stem.
 * Looking the genitive up against the thesaurus returns a real, curated
 * nominative for a real person, or nothing. Nothing is the right answer when the
 * person is not in the thesaurus: it means the name still needs a human, which
 * is exactly the state a review queue should express.
 */
import { sameNameForm, foldOrtho } from './name-equivalence.mjs';
import { stripEnding, PRECISION_ENDINGS } from './latin-morphology.mjs';

/**
 * Toponymic and role epithets that trail a Latin name and are NOT the surname:
 * "Nattae Astensis" (of Asti), "Ferrarii Mediolanensis" (of Milan). Dropping
 * them is what makes "the last token is the surname" true.
 */
const EPITHET = /(?:ensis|ensi|anus|ani|inus|ini|iensis|atis|ates|nus|nis)$/;
const EPITHET_WORD = /^(?:romani?|roman|venetus|veneti|florentini?|neapolitani?|graeci?|latini?|iunioris|senioris|filii?|nepotis|poetae?|doctoris|episcopi|cardinalis|presbyteri|monachi|abbatis)$/;

/**
 * The DISTINCTIVE (surname) stem of a captured name, plus supporting stems.
 *
 * In a Latin genitive head the surname is the LAST name token — "Iacobi
 * Sannazarii" is Sannazaro, "Gasparis Contareni" is Contarini, "Nicolai
 * Clenardi" is Clénard — after trailing toponyms are dropped.
 *
 * This distinction is the whole ballgame. The first cut tried every stem
 * independently and accepted a match on ANY of them, so it matched on the GIVEN
 * name and returned: Iacobi Sannazarii → "Jacob of Edessa", Gasparis Contareni
 * → "Gaspard Bauhin", Lucae Paeti → "…G.H. Luce", Aldi Manvtii → "Cicero".
 * Praenomina are shared by thousands of people; only the surname identifies.
 * (`author-reconcile.mjs` reaches the same conclusion from the other direction,
 * gating on document frequency so that common stems cannot drive a match.)
 */
export function lookupStems(captured) {
  const words = foldOrtho(captured).split(' ').filter((w) => w.length >= 4);
  const kept = words.filter((w) => !EPITHET_WORD.test(w));
  const stems = kept.map((w) => stripEnding(w, PRECISION_ENDINGS, 4)).filter((w) => w.length >= 4);
  if (!stems.length) return { surname: null, supporting: [] };

  // Walk back from the end past toponymic epithets to the real surname.
  let idx = kept.length - 1;
  while (idx > 0 && EPITHET.test(kept[idx])) idx--;
  const surname = stripEnding(kept[idx], PRECISION_ENDINGS, 4);
  return {
    surname: surname.length >= 4 ? surname : null,
    supporting: stems.filter((s) => s !== surname),
  };
}

/**
 * Latin ↔ vernacular given names. Orthographic folding cannot connect these —
 * Matthaeus/Matteo and Carolus/Carlo diverge past one edit — and without them
 * the given-name corroboration below rejects correct matches: "Matthaei
 * Gribaldi" against *Matteo* Gribaldi, "Caroli Sigonii" against *Carlo*
 * Sigonio. This is the same gap `author-reconcile.mjs` documents: authority
 * records enumerate vernacular variants but not Latin inflections.
 *
 * Each row is one person-name across languages, stemmed on both sides.
 */
const PRAENOMEN_GROUPS = [
  ['matth', 'matte', 'matth', 'mathe', 'matti'], ['carol', 'carl', 'charl', 'karl'],
  ['nicol', 'nicl', 'niccol', 'nikol'], ['marc', 'marco', 'mark'],
  ['iacob', 'jacob', 'giacom', 'jacqu', 'iacop'], ['ioann', 'johann', 'giovann', 'jean', 'juan', 'john'],
  ['petr', 'pier', 'pietr', 'peter'], ['paul', 'paol', 'pavl'],
  ['franc', 'francesc', 'frances'], ['antoni', 'anton'],
  ['guliel', 'guillel', 'guglielm', 'william', 'wilhelm', 'guillaum'],
  ['ludouic', 'ludovic', 'lodouic', 'lodovic', 'louis', 'ludwig'],
  ['hieronym', 'girolam', 'jerom'], ['laurent', 'lorenz', 'loren'],
  ['bartholom', 'bartolom', 'barthelem'], ['scipi', 'scipion'],
  ['alexandr', 'alessandr'], ['andre', 'andrea'], ['stephan', 'stefan', 'etienn'],
  ['georg', 'giorg', 'george'], ['henric', 'enric', 'henri', 'heinric'],
  ['gaspar', 'gasparo', 'gasper'], ['aldo', 'aldus', 'aldi'],
];

/** Do two name strings share a given name across the Latin/vernacular divide? */
function sharesPraenomen(fullName, stem) {
  const words = foldOrtho(fullName).split(' ').filter((w) => w.length >= 3);
  for (const group of PRAENOMEN_GROUPS) {
    const stemHit = group.some((g) => stem.startsWith(g) || g.startsWith(stem));
    if (!stemHit) continue;
    if (words.some((w) => group.some((g) => w.startsWith(g) || g.startsWith(w)))) return true;
  }
  return false;
}

/**
 * Resolve a captured (possibly genitive) name to a thesaurus nominative.
 *
 * `findCandidates(stem)` must return author docs whose canonical name or
 * variants plausibly contain the stem — injected so this stays testable and
 * storage-agnostic.
 *
 * Returns { nominative, slug, matched_on, ambiguous } or null.
 * `ambiguous` is set when more than one DISTINCT person matched: the queue
 * should show that rather than pick, because picking between two same-stem
 * people is precisely the error that put Annibal Caro under a 13th-century
 * Dominican during the item-2 pass.
 */
export async function nominativise(captured, findCandidates) {
  const { surname, supporting } = lookupStems(captured);
  if (!surname) return null;

  const docs = await findCandidates(surname);
  if (!docs?.length) return null;

  /** Does this doc carry the SURNAME stem — not merely some shared token? */
  const carriesSurname = (d) => {
    const forms = [d.canonical_name || d._id, ...(d.variants || [])].filter(Boolean);
    return forms.some((f) => foldOrtho(f).split(' ')
      .filter((w) => w.length >= 4)
      .map((w) => stripEnding(w, PRECISION_ENDINGS, 4))
      // EXACT stem equality. A prefix rule is right for comparing two full
      // names (sameNameForm uses one) and wrong here, because this matches ONE
      // token against a whole thesaurus, where some longer surname sharing the
      // prefix nearly always exists: it produced Riccii → "Riccioli", Curtii →
      // "Curtin", Gentilis → "Gentile", three different people. Exactness costs
      // recall — "Paeti"/"Peti" no longer resolves — and that is the correct
      // trade for a queue whose output is written to a public byline.
      .some((w) => w === surname));
  };

  const hits = docs.filter(carriesSurname);
  if (!hits.length) return null;

  // Collapse docs that are the same person under different spellings.
  const distinct = [];
  for (const h of hits) {
    const name = h.canonical_name || h._id;
    if (!distinct.some((d) => sameNameForm(d.canonical_name || d._id, name))) distinct.push(h);
  }

  // Where the capture also carries a given name, prefer the doc that shares it.
  // Two Contarinis are separated by "Gasparis", not by the surname they share.
  const corroborated = supporting.length
    ? distinct.filter((d) => {
      const forms = [d.canonical_name || d._id, ...(d.variants || [])].filter(Boolean);
      return forms.some((f) => supporting.some((sup) => sameNameForm(f, sup) || sharesPraenomen(f, sup)));
    })
    : [];

  // A capture that carries a given name AND finds no candidate sharing it is
  // evidence of a DIFFERENT person with the same surname, not a weak match.
  // Falling back to the uncorroborated pool returned "Bartholomaei Riccii" →
  // Paolo Riccio and "Scipii Gentilis" → Giovanni Gentile — right surname,
  // wrong man, and the byline would have looked entirely plausible.
  if (supporting.length && !corroborated.length) return null;

  const pool = corroborated.length ? corroborated : distinct;
  const best = pool[0];
  return {
    nominative: best.canonical_name || best._id,
    slug: best._id,
    matched_on: surname,
    corroborated_by_given_name: corroborated.length > 0,
    // Ambiguity is REPORTED, never resolved by picking. Choosing between two
    // same-surname people is what put Annibal Caro under a 13th-century
    // Dominican earlier in this workstream.
    ambiguous: pool.length > 1,
    alternatives: pool.slice(1, 4).map((d) => d.canonical_name || d._id),
  };
}
