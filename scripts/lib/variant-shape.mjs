/**
 * What SHAPE is a string in `authors.variants[]`? (#3894 follow-up)
 *
 * A variant is supposed to be another way of writing ONE person's name, and the
 * whole identity layer treats it that way: `author-vs-ai-metadata.mjs`,
 * `nominativise.mjs`, `backfill-author-canonical-links.mjs` and the read-path
 * resolver all match incoming strings against `variants[]`. So a variant is a
 * MATCH SURFACE, and a bad one is not inert — it actively pulls unrelated books
 * and names onto the wrong person.
 *
 * That is not hypothetical. The `cicero` doc carries the variant
 * "Cicero (ed. Manutius family)", which is why a title page reading "Aldi
 * Manvtii" resolved to Cicero during the #3894 item-5 pass. Measured across the
 * corpus, 1,078 of 9,804 variants (11%) are shaped like this.
 *
 * CLASSIFY, DO NOT DELETE. Two of these shapes are load-bearing:
 *
 *   - a compound may be the ONLY record that a volume had co-authors, which is
 *     information the contents layer (#2916) wants rather than debris;
 *   - a book joins its author doc by matching `books.author` against these very
 *     strings, so removing a variant that books still carry ORPHANS them —
 *     the byline stays and the author page silently loses the book.
 *
 * The audit therefore reports, per variant, how many books would be cut loose.
 * The safe repair is to stop MATCHING on these, not to erase them.
 */

/**
 * How many distinct people must extend a bare form before it is unmatchable.
 * Deliberately loose: a false positive costs one review line, a false negative
 * costs a wrong byline on every book carrying the string.
 */
export const UNDERSPECIFIED_MIN_EXTENDERS = 5;

/** Separators that mean "and then a different person". */
const MULTI_SEP = /\s*[|;]\s*|\s+&\s+|\s*,\s+(?:and|et)\s+/;

/** Role words that mark a contributor rather than the author. */
const ROLE = /\b(trans(?:l(?:ator|ated)?)?\.?|ed(?:itor|ited)?\.?|comm(?:entary|entator)?\.?|illust(?:rator|rated)?\.?|introd(?:uction)?\.?|pref(?:ace)?\.?|annot(?:ator|ated)?\.?|compil(?:er|ed)?\.?|rev(?:ised|iser)?\.?|interprete|conversus|emendat|recognit)\b/i;

/** Edition/imprint annotations — never part of a personal name. */
const EDITION = /\((?:[^)]*\b(?:edition|editio|ed\.|aldine|sixtine|clementine|press|family|reprint|facsimile|vol\.?|volume|series)\b[^)]*)\)/i;

/** A parenthetical that is a life-date or a disambiguator, which IS fine. */
const OK_PAREN = /\((?:\s*(?:b\.|d\.|fl\.|ca\.|c\.|approximately)?\s*\d{3,4}\s*[-–—]?\s*(?:\d{3,4})?\s*|the (?:elder|younger)|saint|pseudo|[^)]{0,18})\)/i;

/**
 * Does the string contain ANY non-Latin script character?
 *
 * Presence, not proportion. A share-based test fails on these records because
 * the romanised qualifier is repeated on both sides — "Ji Xue approximately
 * 1488-1558; 薛己, approximately 1488-1558" is majority-Latin on the CJK side
 * too, thanks to the word "approximately", so a share test called it two
 * people and would have stripped the romanised lookup key off 12 books.
 */
const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Tibetan}\p{Script=Devanagari}]/u;
const hasNonLatin = (s) => NON_LATIN.test(String(s ?? ''));

/** Every 3-4 digit year in a string, as a sorted key. */
const dateKey = (s) => (String(s ?? '').match(/\b\d{3,4}\b/g) || []).sort().join('-');

/**
 * Is this a TRANSLITERATION PAIR — one person written twice, once romanised and
 * once in their own script?
 *
 * This corpus is full of them: "Zhang, Jiebin, 1563-1640; 張介賓, 1563-1640",
 * "Hŏ, Chun, 1546-1615; 許浚, 1546-1615". They are separated by a semicolon, so
 * a naive multi-person split reads each as two different people and marks the
 * variant unmatchable — which would strip the romanised key that is the ONLY
 * way most callers can reach these authors at all. The first run of this audit
 * did exactly that to 40 Zhang Jiebin books, 25 Heo Jun, 17 Yao Genchō.
 *
 * Signature: exactly two parts, opposite scripts, and identical life-dates (or
 * no dates on either side). Requiring the dates to agree is what stops a real
 * two-person compound in mixed scripts from slipping through.
 */
function isTransliterationPair(parts) {
  if (parts.length !== 2) return false;
  const [a, b] = parts;
  // Exactly one side carries a non-Latin script.
  if (hasNonLatin(a) === hasNonLatin(b)) return false;
  // …and both sides agree on life-dates (or neither states any). Requiring the
  // dates to agree is what stops a genuine two-person compound in mixed scripts
  // from being waved through as one person.
  return dateKey(a) === dateKey(b);
}

/**
 * Institutional headings legitimately contain "&" — "Drametse & Ogyen Choling
 * Collection" is ONE heading, not two people, and splitting it produced a
 * bogus person called "Drametse". Corporate bodies are #3483's problem, not a
 * compound-variant problem.
 */
const INSTITUTIONAL = /\b(collection|library|bibliot|museum|society|academy|institute|institut|universit|archive|archiv|press|monastery|temple|abbey|college|school|foundation|company|association|bros\.?|brothers|sons)\b/i;

/**
 * Classify one variant string.
 *
 * Order matters: multi-person is the most consequential shape, so it is tested
 * first even when a role word is also present ("A; B (trans.)" is both, and the
 * multi-person aspect is what makes it dangerous to match on).
 *
 * Pass `opts.extendingPeople(variant)` — a function returning how many DISTINCT
 * people in the corpus carry an author string extending this form — to enable the
 * `underspecified` rule. Without it the classifier judges shape only, exactly as
 * before, so existing callers are unaffected.
 *
 * Returns { shape, matchable, people[] }.
 *   shape     multi_person | role_annotated | edition_annotated | overlong |
 *             underspecified | clean
 *   matchable false when using this string as a lookup key can land on the
 *             wrong person — the property the identity layer actually needs
 *   people    for multi_person, the split parts, so a later pass can attach or
 *             mint them instead of discarding the information
 */
export function classifyVariant(raw, opts = {}) {
  const v = String(raw ?? '').trim();
  if (!v) return { shape: 'clean', matchable: false, people: [] };

  // UNDERSPECIFIED — a bare forename. Shape alone cannot see this one: "Johannes"
  // is a well-formed name and every other rule here calls it clean. What makes it
  // unmatchable is the CORPUS, so the caller supplies the evidence — how many
  // distinct people carry an author string extending this form. `jan-hus` carried
  // the bare variant "Johannes" and thereby claimed 115 books by Chrysostom,
  // Sacrobosco and Duns Scotus (#4313); nine more docs had the same defect and 75
  // more books were mis-linked (#4318). Uniqueness is not validity — each of those
  // strings matched exactly one doc, which is why the backfill trusted it.
  // Measured separation: Johannes 77 distinct extenders, Thomas 67, Alexander 31
  // vs real mononyms Aristoteles 1, Cicero 4, Boethius 5.
  const extenders = opts.extendingPeople?.(v) ?? 0;
  if (extenders >= UNDERSPECIFIED_MIN_EXTENDERS && !/[\s,]/.test(v)) {
    return { shape: 'underspecified', matchable: false, people: [v], extenders };
  }

  const parts = v.split(MULTI_SEP).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    // Two parts is not automatically two people. Three exceptions, each found
    // as a false positive on a production run:
    //   - a transliteration pair is ONE person written twice
    //   - an institutional heading legitimately contains "&"
    //   - "Surname, Given" is one name (handled by MULTI_SEP requiring and/et)
    if (isTransliterationPair(parts)) {
      return { shape: 'script_pair', matchable: true, people: [v] };
    }
    if (INSTITUTIONAL.test(v)) {
      return { shape: 'institutional', matchable: true, people: [v] };
    }
    return { shape: 'multi_person', matchable: false, people: parts.map(stripRole) };
  }
  if (ROLE.test(v)) return { shape: 'role_annotated', matchable: false, people: [stripRole(v)] };
  if (EDITION.test(v)) return { shape: 'edition_annotated', matchable: false, people: [v.replace(EDITION, '').trim()] };
  // Length alone is weak evidence, so it comes last and only catches strings no
  // other rule explained. Real names with dates and a toponym reach ~55 chars.
  if (v.length > 70) return { shape: 'overlong', matchable: false, people: [v] };
  return { shape: 'clean', matchable: true, people: [v] };
}

/** Drop a trailing/leading role annotation from one person fragment. */
export function stripRole(s) {
  return String(s ?? '')
    .replace(/\([^)]*\)/g, (m) => (OK_PAREN.test(m) && !ROLE.test(m) && !EDITION.test(m) ? m : ''))
    .replace(new RegExp(`\\s*[,:]?\\s*${ROLE.source}\\s*\\.?$`, 'i'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;:]\s*$/, '')
    .trim();
}
