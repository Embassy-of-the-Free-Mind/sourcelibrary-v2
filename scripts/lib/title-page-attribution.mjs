/**
 * Who does a title page say wrote this book? (#3894 item 5)
 *
 * Early-modern title pages name their author by convention, and `books.title`
 * is a transcription of the title page. That makes the record self-describing:
 * "Rime del commendatore Annibal Caro" catalogued to a printer is decidable
 * from the record alone — no enrichment, no model call, no page fetch.
 *
 * This matters because the enrichment-based detector
 * (`author-vs-ai-metadata.mjs`) can only see the 12% of books that carry an
 * `ai_metadata.author`. It corrected the 1590 *Aminta* to Tasso while the 1581
 * and 1583 editions of the same poem stayed under "Manuzio, Aldo", invisible
 * purely because nobody had enriched them.
 *
 * THE CENTRAL DISTINCTION, and the reason this is not a one-line regex: Latin
 * title pages name the EDITOR as prominently as the author, in a different
 * grammatical case.
 *
 *     Auli Gellii Noctium Atticarum libri            <- genitive: Gellius WROTE it
 *     P. Terentius Afer a M. Antonio Mureto emendatus <- ablative + participle:
 *                                                       Muretus CORRECTED it
 *
 * Promoting the second to `books.author` replaces one wrong attribution with
 * another. So markers are classified by ROLE, and only author-role captures are
 * ever proposed.
 */

/** Honorifics and courtesy titles that sit between a marker and the name. */
const HONORIFIC = String.raw`(?:m\.|mr\.|mess(?:er)?\.?|messire|sig\.?r?\.?|signor[ei]?|s\.|mag\.?|`
  + String.raw`ill\.?mo|commendator[ei]|don|padre|frate|fra|f\.|b\.|d\.|r\.d\.|dott(?:or)?\.?|`
  + String.raw`cavalier[ei]?|caualier[ei]?|conte|abbate|monsig(?:nor)?\.?|rev\.?|reuerendo)`;

/** A capitalised personal-name run: "Annibal Caro", "M. Tullii Ciceronis". */
const NAME = String.raw`(?:[A-ZÀ-Ý][\wÀ-ÿ'’-]*\.?(?:\s+(?:de|della|del|di|da|van|von|le|la|dal)\b)?\s*){1,4}`;

/**
 * AUTHOR-ROLE markers. A name captured here is being named as the writer.
 *
 * `di/del/della` is the Italian workhorse ("Rime del commendatore Annibal
 * Caro"). It is also, unavoidably, the possessive used for everything else on a
 * title page — "Signoria di Venetia", "duca di Nemurs" — so it is only trusted
 * when the name that follows survives the place-name and honorific filters.
 */
const AUTHOR_MARKERS = [
  // Requires TWO words. `di` is the single loosest marker in the set — it is
  // Italian's universal possessive — and a one-word capture after it is far more
  // often a place, a council or a book of the Bible than an author: "decreto del
  // Concilio di Trento" gave "Concilio di Trento", and a Brucioli Bible gave
  // "Esdra". Real Italian author captures are "Annibal Caro", "Rinaldo Odoni",
  // "Torquato Tasso" — two words essentially always.
  { role: 'author', lang: 'it', minWords: 2, re: new RegExp(String.raw`\b(?:di|del|dello|della)\s+(?:${HONORIFIC}\s+)*(${NAME})`, 'gi') },
  { role: 'author', lang: 'la', re: new RegExp(String.raw`\bauct(?:h)?ore\s+(${NAME})`, 'gi') },
  { role: 'author', lang: 'la', re: new RegExp(String.raw`\bautore\s+(${NAME})`, 'gi') },
  { role: 'author', lang: 'it', re: new RegExp(String.raw`\bcompost[oi]\s+(?:per|da)\s+(?:${HONORIFIC}\s+)*(${NAME})`, 'gi') },
  { role: 'author', lang: 'fr', re: new RegExp(String.raw`\bpar\s+(${NAME})`, 'gi') },
];

/**
 * EDITOR-ROLE markers. Never proposed as the author — but detected, because a
 * title that names ONLY an editor is a title with no author evidence, and that
 * is a different verdict from "no name at all".
 */
const EDITOR_MARKERS = [
  // `a\.?` — transcriptions carry the abbreviation point ("a. M. Antonio Mureto
  // emendatus"), and requiring whitespace straight after the "a" missed every
  // one of them, which silently reclassified editors as having no role at all.
  { role: 'editor', lang: 'la', re: new RegExp(String.raw`\b(?:a|ab)\.?\s+(${NAME})\s+(?:emendat|correct|collect|illustrat|recognit|castigat|edit|translat|interpret)`, 'gi') },
  { role: 'editor', lang: 'la', re: new RegExp(String.raw`\b(?:emendat|correct|collect|illustrat|recognit|castigat)\w*\s+(?:a|ab|per)\.?\s+(${NAME})`, 'gi') },
  { role: 'editor', lang: 'it', re: new RegExp(String.raw`\btradott[oa]\s+(?:dal|dalla|da|per|nella)?\s*(?:${HONORIFIC}\s+)*(${NAME})`, 'gi') },
  { role: 'editor', lang: 'la', re: new RegExp(String.raw`\bedente\s*,?\s*(?:&\s*explicante\s*,?\s*)?(${NAME})`, 'gi') },
];

/**
 * Latin genitive-initial: the commonest author position of all, and the one
 * with no marker word — "M. Tullii Ciceronis Opera", "Auli Gellii Noctium
 * Atticarum libri", "Matthaei Curtii Papiensis De prandii ac caenae modo".
 *
 * Requires TWO or more genitive-looking tokens at the very start. One is far
 * too loose: half the Latin nouns in a title end in -i or -is, so a single
 * token would capture "Institutionum" out of "Institutionum Grammaticarum".
 */
const GENITIVE_HEAD = /^((?:[A-ZÀ-Ý][\wÀ-ÿ']*(?:i|ii|ij|is|ae|orum)\.?\s+){2,4})/;

/**
 * Latin nouns that decline exactly like a personal name and start a great many
 * titles. Without this the genitive head reads "Concordantiae Testamenti",
 * "Commentarii Linguae", "Comicorum Graecorum", "Iuris Orientalis" and "Varii
 * Historiae Romanae" as people — five of the first eight hits on the first run.
 * A capture is rejected if ANY of its tokens is one of these, because a real
 * name run does not contain them.
 */
const LATIN_WORK_NOUN = new RegExp(String.raw`^(?:concordanti|commentari|comicorum|iuris|juris|varii|`
  + String.raw`histori|oper|epistol|institution|oration|sententi|annotation|scriptor|libr|liber|`
  + String.raw`quaestion|disputation|element|fragment|antiquitat|observation|obseruation|`
  + String.raw`meditation|dissertation|tractat|dialog|orthographi|grammatic|rhetoric|`
  + String.raw`arithmetic|geometri|astronomi|philosophi|theologi|medicin|chirurgi|`
  + String.raw`lexic|thesaur|catalog|bibliothec|chronic|annal|memori|monument|`
  + String.raw`praeceptor|praefation|indic|tabul|figur|imagin|regul|canon|statut|`
  + String.raw`decret|constitution|privilegi|priuilegi|testament|euangel|evangel|psalm|`
  + String.raw`hymn|sermon|homili|meteor|physic|ethic|politic|poetic|music|`
  + String.raw`select|miscellane|collectane|analect|florileg|adag|emblem|symbol|`
  + String.raw`secret|arcan|mysteri|natur|scienti|art|vit|mort|anim|mund|coel|cael)`, 'i');

/** Place-name and role words that a marker can capture instead of a person. */
const NOT_A_PERSON = new RegExp(String.raw`^(?:venetia|venice|roma|rome|firenze|fiorenza|napoli|milano|`
  + String.raw`bologna|padoua|padova|siena|genova|torino|mantoua|ferrara|urbino|parigi|paris|lyon|`
  + String.raw`basilea|anversa|londra|london|god|dio|christo|cristo|giesu|gesu|jesu|maria|nostro|`
  + String.raw`santa|santo|san|sant|santita|santità|santissimo|santissima|beatitudine|maesta|maestà|eccellenza|altezza|chiesa|church|concilio|concili|sinodo|synodo|conclave|capitolo|ordine|compagnia|academia|accademia|esdra|genesi|esodo|leuitico|numeri|deuteronomio|giosue|giudici|salmi|prouerbi|proverbi|isaia|geremia|ezechiel|daniel|matteo|marco|luca|giouanni|giovanni|paolo|apocalisse|biblia|bibbia|questo|quello|quella|questa|medesimo|medesima|`
  + String.raw`mondo|tutti|tutte|molti|alcuni|diuersi|diversi|nuovo|nuoua|nuova|prima|primo|`
  + String.raw`seconda|secondo|terza|terzo|quarto|libro|libri|parte|tomo|volume|opera|opere|`
  + String.raw`lingua|latina|latino|toscana|italia|italiana|greca|greco|arte|vita|morte|anima|`
  + String.raw`amore|amor|natura|scienza|filosofia|theologia|teologia|medicina|legge|leggi)\b`, 'i');

/**
 * Trailing noise a greedy name run picks up.
 *
 * `de`/`del`/`della`/`di` are NOT cut here even though they end many captures,
 * because they are also inside surnames — cutting on them turned "Sauino De
 * Bobali Sordo" into "Sauino". They are trimmed only when they end the string.
 */
const TRAILING_STOP = /\s+(?:libri?|liber|opera|opere|volume|tomo|parte|nel|nella|con|col|et|and|&|in|ad|per|che|dove|oue|ove|il|lo|la|le|gli)\b.*$/i;
const TRAILING_PARTICLE = /\s+(?:de|del|della|di|da|van|von|le|la|dal|e|i)$/i;

/**
 * Nobility and office possessives. "duca di Nemurs", "Signoria di Venetia" and
 * "principe di Salerno" all put a PLACE after `di`, and the Italian author
 * marker cannot tell that from "Rime di Annibal Caro" without looking left.
 */
const TITLE_OF_NOBILITY = /\b(?:duc[ah]|duchessa|principe|principessa|conte|contessa|marchese|marchesa|barone|re|regina|imperator[ei]|papa|cardinale|vescouo|vescovo|arciuescouo|signoria|republica|repubblica|citta|città|stato|casa|corte)\s+(?:di|de|del|della)\s*$/i;

/** Tidy a captured run into a plausible personal name, or null. */
export function cleanName(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/\s+/g, ' ').trim()
    .replace(TRAILING_STOP, '')
    .replace(/[.,;:]+$/, '')
    .replace(TRAILING_PARTICLE, '')
    .trim();
  // Strip a leading honorific the marker regex allowed through.
  n = n.replace(new RegExp(String.raw`^(?:${HONORIFIC}\s+)+`, 'i'), '').trim();
  if (n.length < 4 || n.length > 60) return null;
  if (NOT_A_PERSON.test(n)) return null;
  const words = n.split(' ').filter(Boolean);
  if (!words.length || words.length > 5) return null;
  // A run containing a Latin work-noun is a title, not a person.
  if (words.some((w) => LATIN_WORK_NOUN.test(w))) return null;
  // At least one word that is not an initial — "M. T." is not a name.
  if (!words.some((w) => w.replace(/\./g, '').length >= 3)) return null;
  // Must still look capitalised.
  if (!/^[A-ZÀ-Ý]/.test(n)) return null;
  return n;
}

/**
 * Every person named on a title page, with the role its grammar assigns.
 * Returns [{ name, role, lang, marker }], author-role first, de-duplicated.
 */
export function namesOnTitlePage(title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 12) return [];
  const out = [];
  const seen = new Set();
  const push = (name, role, lang, marker, minWords = 1) => {
    const c = cleanName(name);
    if (!c) return;
    if (c.split(' ').filter(Boolean).length < minWords) return;
    const k = `${c.toLowerCase()}|${role}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ name: c, role, lang, marker });
  };

  const gen = t.match(GENITIVE_HEAD);
  if (gen) push(gen[1], 'author', 'la', 'genitive-head');
  // NOTE for callers: a genitive-head capture is a DECLINED form ("Nicolai
  // Clenardi", "Gasparis Contareni"). It identifies the person correctly and
  // must NOT be written to books.author verbatim — that is how "Marci Antonii
  // Nattae" nearly entered a byline during the #3894 item-2 pass.

  for (const m of [...AUTHOR_MARKERS, ...EDITOR_MARKERS]) {
    m.re.lastIndex = 0;
    let hit;
    while ((hit = m.re.exec(t)) !== null) {
      // "duca di Nemurs" is a place, not an author. The marker regex cannot see
      // this — it has to look LEFT of the match.
      if (TITLE_OF_NOBILITY.test(t.slice(Math.max(0, hit.index - 30), hit.index + hit[0].indexOf(hit[1])))) continue;
      push(hit[1], m.role, m.lang, m.re.source.slice(0, 24), m.minWords ?? 1);
    }
  }
  return out.sort((a, b) => (a.role === 'author' ? -1 : 1) - (b.role === 'author' ? -1 : 1));
}
