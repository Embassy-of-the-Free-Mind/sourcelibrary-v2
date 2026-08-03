/**
 * work-identity-match.mjs — is this catalogue record the same WORK as this book?
 *
 * Pure functions, no I/O, so the gold set in
 * tests/unit/reference-set-work-identity.test.ts can exercise them directly.
 * That separation is the point: this logic was tuned five times against
 * whichever sample happened to be on screen, and step 4 of that tuning silently
 * lost verified true positives (Cicero's *De Officiis* → Grimald 1556) while
 * making the corpus look cleaner. It is now pinned to hand-verified pairs.
 *
 * THE KEY INSIGHT, after five failed rounds of ratio tuning
 * --------------------------------------------------------
 * MARC 240 exists precisely to name a work independently of how any edition
 * titles itself. It IS the join key. So the test is set CONTAINMENT of the
 * uniform title in our title — not a coverage ratio on the 245 display title,
 * which is the edition's marketing line and carries apparatus our title never has.
 *
 * Every ratio-based rule failed on the same two rocks. "De officiis." reduces to
 * ONE usable token, so any count- or fraction-based rule either discards it (a
 * false negative on a work that has been in English since 1556) or, once
 * loosened, lets "The cup to the dregs" match a Tibetan ritual text because
 * "dregs" is simultaneously an English word and a romanized Tibetan syllable.
 * Containment gets both right for a reason rather than by tuning.
 */

/** Bibliographic filler and container words that carry no work identity. */
export const TITLE_STOP = new Set([
  // English / Latin
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'des', 'der', 'die', 'und',
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
  'english', 'translation', 'translated', 'works', 'text', 'new', 'notes',
  'introduction', 'edition', 'edited', 'selected', 'sive', 'seu', 'cum',

  // Romanized Tibetan container vocabulary — the exact equivalents of "opera
  // omnia" or "tractatus". `thor bu` = miscellanea, `bstan bcos` = treatise,
  // `rnam thar` = hagiography, `lo rgyus` = history, `sogs` = et cetera.
  // ⚠️ Assembled from context, not by a Tibetanist. Worth review by someone who
  // reads Tibetan before this list is trusted to exclude a real match.
  'thor', 'sogs', 'skor', 'bstan', 'bcos', 'rnam', 'thar', 'rgyus', 'chos',

  // Romanized Sanskrit / Indic container vocabulary.
  'grantha', 'sastra', 'shastra', 'sutra', 'sutras', 'tantra', 'purana',
  'samhita', 'bhasya', 'tika', 'vritti',
]);

export const normaliseTitle = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function titleTokens(s) {
  return normaliseTitle(s).split(/\s+/).filter((t) => t.length >= 4 && !TITLE_STOP.has(t));
}

export const bookTitleTokens = (...titles) => [...new Set(titles.flatMap(titleTokens))];

/**
 * Crude inflectional stem, so a uniform title and our title of the same work
 * agree across case endings: "magiae" ⇔ "magia", "officiis" ⇔ "officii".
 * Deliberately shallow — it only has to bridge declension, not lemmatise.
 */
export function stem(t) {
  const declined = t.replace(/(?:ibus|arum|orum|is|ae|am|um|us|os|as|es|em|i|o|a|e)$/, '');
  if (declined !== t) return declined;
  // English plural, applied only when no Latin ending matched. Our title is
  // frequently the Latin ("Elementa") where the catalogue's 245 is the English
  // ("Euclid's Elements") — without this the two never meet and Euclid's Elements
  // reads as a different work from Euclid's Elements.
  return /[^aeiou]s$/.test(t) && t.length > 4 ? t.slice(0, -1) : t;
}

/**
 * PRIMARY TEST — is every token of the MARC 240 uniform title present in our
 * title? Word order is ignored: a uniform title is a set, not a phrase
 * ("Formula vitae honestae" ⇔ our "De formula honestae vitae").
 *
 * Returns null when there is no uniform title, no book tokens, or any uniform
 * token is absent. Null means "not established", never "no prior exists".
 *
 * Verified behaviour (real LoC rows, see the gold set):
 *   "De officiis."            ⊆ "De officiis. Add: Paradoxa Stoicorum"      ✓
 *   "Formula vitae honestae." ⊆ "De formula honestae vitae"                 ✓
 *   "Moralia."                ⊆ "Plutarchi Chaeronensis Moralia"            ✓
 *   "Elements."               ⊆ "Στοιχεῖα (Elements)"                       ✓
 *   "Iliad."                  ⊆ "Homer, Iliad with Scholia"                 ✓
 *   "Magiae naturalis."       ⊆ "Magia Naturalis"              (stemmed)    ✓
 *   "Legs bshad gser phreng." ⊆ "Neyphug Thor bu Legs bshad gser phreng"    ✓
 *   "Calice jusqu'à la lie."  ⊄ Tibetan ritual text                        ✗
 *   "ʼDod paʼi bstan bcos."   ⊄ "she bya rab tu gsal ba'I bstan bcos"      ✗
 */
export function uniformTitleContainment(bookToks, uniformTitle, opts = {}) {
  const ut = titleTokens(uniformTitle);
  if (!ut.length || !bookToks?.length) return null;
  const bookStems = new Set(bookToks.map(stem));
  if (ut.some((t) => !bookStems.has(stem(t)))) return null;

  // GENERIC UNIFORM TITLES need author corroboration.
  //
  // A one- or two-word uniform title is frequently a whole GENRE rather than a
  // work: "Annales.", "Itinerarium.", "Journal.", "Prodromus.". Containment
  // alone then matches any book sharing that ordinary word, and it produced four
  // absurd pairings in the full run — all with a DIFFERENT author:
  //
  //   "Annales mac[onniques]" (Masonic annals)  → Tacitus, *Annales*
  //   "Itinerarium Portugallensium"             → Mandeville, *Itinerarium*
  //   "Hermetisches Journal"                    → *Journal of Maurice de Guérin*
  //   "Merckwürdiges Leben des ... Moritz W."   → Wilhelm Busch, *Max und Moritz*
  //
  // Every genuine match, by contrast, agrees on author: Cicero→Cicero,
  // Homer→Homer, Euclid→Euclid, Della Porta→Della Porta, Jayadeva→Jayadeva. So
  // require that agreement precisely where the title stops being distinctive,
  // rather than raising a threshold and losing the one-token true positives
  // ("De officiis.", "Moralia.", "Elements.", "Poetics.").
  //
  // Consequence worth stating: an ANONYMOUS work can only match on a long,
  // distinctive uniform title. That is the conservative direction — it leaves a
  // claim standing rather than demoting it on a coincidence.
  if (ut.length <= GENERIC_UNIFORM_MAX_TOKENS) {
    const { bookAuthorSurname, recordAuthorSurnames } = opts;
    const agrees = Boolean(bookAuthorSurname)
      && (recordAuthorSurnames ?? []).some((s) => s && s === bookAuthorSurname);
    if (!agrees) {
      return null;
    }
    return {
      score: 1,
      hits: ut.length,
      basis: 'uniform_title_containment+author',
      uniform_tokens: ut.length,
      book_tokens: bookToks.length,
      author_corroborated: true,
    };
  }

  return {
    score: 1,
    hits: ut.length,
    basis: 'uniform_title_containment',
    uniform_tokens: ut.length,
    book_tokens: bookToks.length,
  };
}

/** At or below this many tokens, a uniform title is treated as possibly generic. */
export const GENERIC_UNIFORM_MAX_TOKENS = 2;

/**
 * Tokens of a personal name, for discounting inside a TITLE.
 *
 * A 245 display title routinely contains the author: "The Iliad of Homer", "The
 * thirteen books of Euclid's Elements", "The Rhetoric of Aristotle". Those tokens
 * carry no work identity — an author's name is equally present in the titles of
 * everything they wrote, which is exactly why it manufactures false matches
 * between two different works by one person. This is the same job TITLE_STOP does
 * for "liber" and "tractatus", except the filler is supplied per-pair.
 */
export function personalNameTokens(names = []) {
  return new Set(
    names.filter(Boolean)
      .flatMap((n) => titleTokens(String(n).replace(/\d{3,4}/g, ' ')))
      .map(stem),
  );
}

/**
 * FALLBACK — the 245 display title, for the 35.2% of rows carrying no 240.
 *
 * TWO OUTCOMES, and the difference is the whole point:
 *
 *   a WEAK HINT (score ≤ 0.55, below STRONG_WORK_IDENTITY) — the default. The
 *   candidate is retrieved and screened but cannot assert work identity. This is
 *   what the function used to return unconditionally, which meant over a third of
 *   the reference set could only ever yield `none_found`.
 *
 *   a CONFIRMATION (score 1) — when the author agrees AND, after discounting
 *   personal-name tokens, one title's remaining content is CONTAINED in the
 *   other's.
 *
 * Why containment rather than a raised ratio: a 245 is an edition's own line and
 * carries apparatus a work title never has. "The thirteen books of Euclid's
 * Elements" against our "Elementa" scores 0.50 on min-coverage and would be lost
 * by any threshold above that, while "Historia animalium" against "De partibus
 * animalium" — two different works — scores the same 0.50 and would be kept. A
 * ratio cannot separate those; containment separates them for a reason. It is
 * also the identical test the 240 path uses, so the two paths agree by
 * construction instead of by tuning.
 *
 * Both directions count. Our title is sometimes the fuller one ("Sahih al-Bukhari
 * (Complete)" ⊃ the record's "Sahih al-Bukhari") and sometimes the barer one
 * ("Code of Hammurabi" ⊂ "The complete code of Hammurabi").
 *
 * Author agreement is REQUIRED and is not a threshold that can be relaxed. The
 * title-token lane has no author access point, and a 245 match resting on words
 * alone is precisely how "The cup to the dregs" matched a Tibetan ritual text.
 */
export function displayTitleOverlap(bookToks, displayTitle, opts = {}) {
  const rt = new Set(titleTokens(displayTitle));
  if (!rt.size || !bookToks?.length) return null;
  const hits = bookToks.filter((t) => rt.has(t)).length;
  if (!hits) return null;
  const bookCoverage = hits / bookToks.length;
  const recordCoverage = hits / rt.size;
  const weak = {
    score: Math.min(0.55, Math.min(bookCoverage, recordCoverage)),
    hits,
    basis: 'display_title_overlap',
    book_coverage: bookCoverage,
    record_coverage: recordCoverage,
    book_tokens: bookToks.length,
    record_tokens: rt.size,
  };

  const { bookAuthorSurname, recordAuthorSurnames, authorNames } = opts;
  const agrees = Boolean(bookAuthorSurname)
    && (recordAuthorSurnames ?? []).some((s) => s && s === bookAuthorSurname);
  if (!agrees) return weak;

  const names = personalNameTokens(authorNames ?? []);
  const bookContent = [...new Set(bookToks.map(stem))].filter((t) => !names.has(t));
  const recordContent = [...new Set([...rt].map(stem))].filter((t) => !names.has(t));
  // A title that is nothing but the author's name identifies no work.
  if (!bookContent.length || !recordContent.length) return weak;

  const bookInRecord = bookContent.every((t) => recordContent.includes(t));
  const recordInBook = recordContent.every((t) => bookContent.includes(t));
  if (!bookInRecord && !recordInBook) return weak;

  return {
    score: 1,
    hits: bookContent.filter((t) => recordContent.includes(t)).length,
    basis: 'display_title_containment+author',
    direction: bookInRecord ? 'book_in_record' : 'record_in_book',
    book_content_tokens: bookContent.length,
    record_content_tokens: recordContent.length,
    discounted_name_tokens: [...names],
    author_corroborated: true,
  };
}

// ── CJK / original-script matching ───────────────────────────────────────────

/** Han, kana and hangul ranges — the scripts where romanized matching fails. */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

/**
 * CJK numerals and volume markers. A run made only of these is an ENUMERATION —
 * "(三十九)" is volume 39 — not title content.
 *
 * Without this exclusion the volume number becomes the match key and pairs with
 * numerals in any unrelated title: 三才圖會(三十九) matched *The Thirty-Nine Steps*
 * and 武備志(一百二) matched *The 120 Days of Sodom*, because Wikidata carries
 * Chinese labels for Buchan and Sade containing exactly those numerals. It is the
 * same failure the Western VOLUME guard exists to catch, in a different script.
 */
const CJK_ENUMERATION_ONLY = /^[〇零一二三四五六七八九十百千万萬第卷冊册巻編编集號号輯辑]+$/;

/**
 * Contiguous runs of CJK characters, punctuation and Latin stripped.
 * Pure enumerations are dropped — they identify a volume, never a work.
 */
export function cjkRuns(s) {
  if (!s) return [];
  return String(s)
    .replace(/[^㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+/g, ' ')
    .split(/\s+/)
    .filter((r) => r.length >= 2 && !CJK_ENUMERATION_ONLY.test(r));
}

export const hasCjk = (s) => CJK_RE.test(String(s || ''));

/**
 * ORIGINAL-SCRIPT CONTAINMENT — the work-identity test for CJK.
 *
 * Romanized matching is not merely weaker here, it is unusable. LoC mixes pinyin
 * and Wade-Giles; pinyin is syllable-separated where our titles are joined
 * ("Huang ji jing shi shu" vs "Huangji Jingshi Shu"); and most pinyin syllables
 * fall under the token-length floor. Working around all of that by concatenating
 * and substring-matching was measured at ~2 real matches in 38 — romanized
 * Chinese is a dense syllable soup in which short keys collide by accident
 * ("mingshi" sits inside "zhiwumingshitukao", matching a herbal to the *Ming
 * History*).
 *
 * Han characters are morphemes and have exactly one spelling, so a shared run is
 * strong evidence. `MIN_CJK_RUN` is 3: two characters is often a common bigram
 * ("中國", "大成"), three is usually a title.
 *
 * A partial containment is a REAL and useful signal here rather than noise —
 * 本草綱目 ⊂ 本草綱目拾遺 is the *Bencao Gangmu* inside its own supplement, which is
 * exactly the related-work relation screening needs to see.
 */
export const MIN_CJK_RUN = 3;

export function vernacularContainment(bookTitles, row) {
  const bookRuns = bookTitles.flatMap(cjkRuns).filter((r) => r.length >= MIN_CJK_RUN);
  if (!bookRuns.length) return null;

  const candidates = [
    ['vernacular_uniform_title', row.vernacular_uniform_title],
    ['vernacular_title', row.vernacular_title],
  ].filter(([, v]) => v && hasCjk(v));
  if (!candidates.length) return null;

  for (const [basis, value] of candidates) {
    for (const recRun of cjkRuns(value).filter((r) => r.length >= MIN_CJK_RUN)) {
      for (const bookRun of bookRuns) {
        if (bookRun.includes(recRun) || recRun.includes(bookRun)) {
          const shared = Math.min(bookRun.length, recRun.length);
          return {
            score: 1,
            hits: shared,
            basis: `cjk_${basis}`,
            matched_run: recRun.length <= bookRun.length ? recRun : bookRun,
            exact: bookRun === recRun,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Best available work-identity signal for a book/row pair, or null.
 *
 * Original script first where both sides have it — it is the strongest signal
 * available and immune to the romanization problems above.
 */
export function matchWorkIdentity(bookToks, row, opts = {}) {
  if (opts.bookTitles?.length) {
    const vern = vernacularContainment(opts.bookTitles, row);
    if (vern) return vern;
  }
  return uniformTitleContainment(bookToks, row.uniform_title, opts)
    // The subtitle is part of the same 245 field and often carries the work names
    // the title proper omits ("Four texts on Socrates : Plato's Euthyphro,
    // Apology, and Crito"). Dropping it discarded real content on the very rows
    // that have no 240 to fall back on.
    ?? displayTitleOverlap(bookToks, `${row.title || ''} ${row.subtitle || ''}`, opts);
}

/** Threshold at which a match is strong enough to require screening. */
export const STRONG_WORK_IDENTITY = 0.6;
