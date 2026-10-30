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

/** The fold every author-string matcher here uses: NFD, marks off, lower-case. */
const foldName = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Corpus evidence for the `underspecified` rule, as the function
 * `classifyVariant` wants: for a bare (single-token) form, how many DISTINCT
 * people carry an author string that extends it.
 *
 * Lives here, not in the audit, because the audit was the only caller that had
 * it — so the detector could see "Johannes" and the backfill that actually
 * writes the links could not (#4313). One builder, so the two cannot drift.
 *
 * `authorStrings` is every distinct `books.author` value (texts, not artworks).
 */
export function buildExtenderIndex(authorStrings) {
  const byForm = new Map();
  for (const raw of authorStrings) {
    const n = foldName(raw);
    const head = n.split(/[\s,]+/)[0];
    if (!head || head === n) continue;          // the bare form is not its own extender
    if (!byForm.has(head)) byForm.set(head, new Set());
    // Key by the folded remainder so two spellings of one person count once.
    byForm.get(head).add(n.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '));
  }
  return (v) => byForm.get(foldName(v))?.size ?? 0;
}

/**
 * Bare forms the `underspecified` rule refuses that ARE one person's name, each
 * pinned to the one doc allowed to match on it. Read by eye against a production
 * dry run (2026-10-12, #4313): the extender count cannot tell "Plato" (8 —
 * "Plato; Ficino", "Plato (trans. …)") from "Gregor" (5), because a famous
 * mononym collects compounds exactly as a forename collects surnames. A pattern
 * is a net, not a verdict, so the exceptions are a reviewed list, not a rule.
 *
 * Left OUT on purpose, though anchored docs claim them: Hugo, Apollonius,
 * Valerius, Adam, Justin, Philo, Athanasius (several people each) and
 * Theophrastus (in this corpus, as often Paracelsus as the Peripatetic).
 * Keys are folded (`foldName`); the slug pin means another doc carrying the
 * same form as an alias stays refused.
 */
export const REVIEWED_MONONYMS = {
  aristoteles: 'aristotle',
  aristotle: 'aristotle',
  paracelsus: 'paracelsus',
  plato: 'plato',
  vitruvius: 'vitruvius',
  pausanias: 'pausanias',
  polybius: 'polybius',
  vyasa: 'vyasa',
  regiomontanus: 'regiomontanus-johannes-muller',
};

/**
 * May the doc `slug` use the name form `raw` as a MATCH KEY? `classifyVariant`
 * plus the reviewed-mononym exception — the one question every writer that
 * links by name has to ask (#4313: the backfill never asked it).
 *
 * Returns the classifier's verdict, with `matchable` true for a reviewed mononym
 * on its own doc.
 */
export function matchKeyVerdict(raw, slug, opts = {}) {
  const c = classifyVariant(raw, opts);
  if (c.shape === 'underspecified' && REVIEWED_MONONYMS[foldName(raw)] === slug) {
    return { ...c, matchable: true, reviewed: true };
  }
  return c;
}

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

/**
 * Role words as catalogues abbreviate them, including plurals and the German
 * forms (Hrsg., Bearb., Übers.) that `ROLE` does not carry. Kept apart from
 * `ROLE` on purpose: widening `ROLE` would re-classify variants as unmatchable
 * for every writer that links by name, which is a separate decision.
 */
const ROLE_WORD = /^(?:trans(?:l(?:ator|ators|ated)?)?|tr|eds?|editors?|edited|hrsg|herausgegeben|bearb|ubers|uebers|übers|comm(?:entary|entator)?|illus(?:t(?:rator|rated)?)?|engraver|printer|publisher|introd(?:uction)?|pref(?:ace)?|annot(?:ator|ated)?|compil(?:er|ed)?)\.?(?:\s+by)?$/i;
const roleFromWord = (w) => {
  const s = w.toLowerCase().replace(/\.$/, '');
  if (/^(trans|transl|translator|translators|translated|tr|ubers|uebers|übers)/.test(s)) return 'trl';
  if (/^(eds?|editors?|edited|hrsg|herausgegeben|bearb)$/.test(s)) return 'edt';
  if (/^comm/.test(s)) return 'cmm';
  if (/^(illus|engraver)/.test(s)) return 'ill';
  if (s === 'printer') return 'prt';
  if (s === 'publisher') return 'pbl';
  return 'ctb';
};

/**
 * Split one person fragment of a `books.author` string into the name and the
 * role its annotation states (#7787). A bracket that names a role AND another
 * person ("Plutarch (trans. William W. Goodwin)") is a second contributor, not
 * a role of the first: it comes back in `extra`, and the first keeps no role.
 *
 *   parseContributor('Katherine Tingley (editor)') -> { name: 'Katherine Tingley', role: 'edt', extra: [] }
 *   parseContributor('trans. Bernadotte Perrin')   -> { name: 'Bernadotte Perrin', role: 'trl', extra: [] }
 *
 * `roleFrom` says where the role came from: 'bracket', 'prefix' or 'suffix'.
 * A caller uses it to decide whether a trailing "(eds.)" covers every name
 * joined by "&" before it.
 */
export function parseContributor(fragment) {
  let s = String(fragment ?? '').trim();
  let role = null; let roleFrom = null;
  const extra = [];
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (m, inner) => {
    const words = inner.trim().split(/\s+/);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const head = words.slice(0, n).join(' ');
      if (!ROLE_WORD.test(head)) continue;
      const rest = words.slice(n).join(' ').replace(/^by\s+/i, '').trim();
      if (/\p{L}{2,}/u.test(rest)) extra.push({ name: rest, role: roleFromWord(words[0]) });
      else { role = roleFromWord(words[0]); roleFrom = 'bracket'; }
      return ' ';
    }
    return m;
  });
  // Outside a bracket a bare "Ed" or "Tr" may be a name, so a prefix or suffix
  // role needs a full stop, "by", or a word of six letters or more.
  const plain = (w) => ROLE_WORD.test(w) && (/\.$|\sby$/i.test(w) || w.length >= 6);
  const pre = s.match(/^((?:\S+\.?)(?:\s+by)?)\s+(?=\S)/);
  if (pre && plain(pre[1])) { role = roleFromWord(pre[1].split(/\s+/)[0]); roleFrom = 'prefix'; s = s.slice(pre[0].length); }
  const suf = s.match(/[,\s]+([\p{L}]+\.?)\s*$/u);
  if (!role && suf && plain(suf[1]) && s.slice(0, suf.index).trim()) {
    role = roleFromWord(suf[1]); roleFrom = 'suffix'; s = s.slice(0, suf.index);
  }
  return { name: s.replace(/\s{2,}/g, ' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim(), role, roleFrom, extra };
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
