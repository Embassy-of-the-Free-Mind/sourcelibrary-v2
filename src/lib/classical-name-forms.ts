/**
 * Original-script name forms for classical authors.
 *
 * ## Why this exists
 *
 * Measured 2026-08-06: of 1,151 Greek-language live books, **zero** carry Greek
 * script in `title`, `display_title`, `english_title`, `original_title` or
 * `author` — the only 20 exceptions are the literal placeholder
 * `[Greek: Omilia]`. Across 4,825 records in the `authors` thesaurus, not one
 * name form is in Greek, though Plato has 17 Latin/English variants and
 * Aristotle 23.
 *
 * So `Πλάτων` returns nothing. Not because search is broken — Greek *inside*
 * the books is findable, since the `pages` index maps `ocr` and the OCR carries
 * real Greek (`ἀρετή` → 16 passages, `ψυχή` → 13) — but because the string
 * `Πλάτων` does not exist anywhere in the catalogue. The books are Greek; the
 * catalogue cards are entirely Latin and English. A classicist's first instinct
 * is to search in Greek, and the catalogue answers with silence.
 *
 * ## The folding requirement — do not skip this
 *
 * The live `books_search` analyzer `standard_diacritic` is a standard tokenizer
 * plus `lowercase` plus **`asciiFolding`**. ASCII folding maps only *Latin*
 * accented characters; Greek passes through untouched. Indexing these forms
 * under that analyzer would half-work in the worst way: `Πλάτων` would match but
 * `πλατων` would not, and nobody types polytonic reliably.
 *
 * The field must be mapped with **`icuFolding`**, which folds Greek accents and
 * breathings. Proven on a throwaway index 2026-08-06: with icuFolding, all of
 * `Πλάτων`, `πλατων` and `ΠΛΑΤΩΝ` return Plato. See
 * `scripts/audit/greek-name-search.mjs`, which asserts exactly that against the
 * live index and is the acceptance test for the index change.
 *
 * ## Provenance and its limits
 *
 * Compiled by hand. Nominative first, then the genitive where a title is likely
 * to carry it (`Πλάτωνος πολιτεία`). **This list wants review by someone who
 * reads Greek** before it is treated as authoritative — it is a search aid, and
 * a wrong form here is a wrong form on a scholarly surface. Entries are limited
 * to names held with confidence; breadth is deliberately traded for accuracy.
 *
 * Keys match against `books.author`, which is a free-text string carrying forms
 * like "Aristotle", "Aristoteles", "Pseudo-Aristotle", "Galen; Hippocrates".
 */

export const CLASSICAL_NAME_FORMS: Record<string, string[]> = {
  // Philosophy — the core
  Plato: ['Πλάτων', 'Πλάτωνος'],
  Aristotle: ['Ἀριστοτέλης', 'Ἀριστοτέλους'],
  Xenophon: ['Ξενοφῶν', 'Ξενοφῶντος'],
  Epictetus: ['Ἐπίκτητος'],
  Epicurus: ['Ἐπίκουρος'],
  Democritus: ['Δημόκριτος'],
  Heraclitus: ['Ἡράκλειτος'],
  Parmenides: ['Παρμενίδης'],
  Empedocles: ['Ἐμπεδοκλῆς'],
  Pythagoras: ['Πυθαγόρας'],
  'Sextus Empiricus': ['Σέξτος Ἐμπειρικός'],
  'Marcus Aurelius': ['Μᾶρκος Αὐρήλιος'],

  // Neoplatonists — where this library is deepest
  Plotinus: ['Πλωτῖνος', 'Πλωτίνου'],
  Porphyry: ['Πορφύριος', 'Πορφυρίου'],
  Iamblichus: ['Ἰάμβλιχος', 'Ἰαμβλίχου'],
  Proclus: ['Πρόκλος', 'Πρόκλου'],
  Damascius: ['Δαμάσκιος'],
  Olympiodorus: ['Ὀλυμπιόδωρος'],
  Simplicius: ['Σιμπλίκιος'],
  Synesius: ['Συνέσιος'],

  // Medicine and natural science
  Galen: ['Γαληνός', 'Γαληνοῦ'],
  Hippocrates: ['Ἱπποκράτης', 'Ἱπποκράτους'],
  // Both spellings are attested and editions differ. A search field does not
  // have to adjudicate: carry both. (Flagged independently by two checks —
  // Gemini 3 Flash both when grading this list and when generating one cold.)
  Dioscorides: ['Διοσκουρίδης', 'Διοσκορίδης', 'Διοσκορίδου'],
  Theophrastus: ['Θεόφραστος', 'Θεοφράστου'],
  Aelian: ['Αἰλιανός'],

  // Mathematics and astronomy
  Euclid: ['Εὐκλείδης', 'Εὐκλείδου'],
  Archimedes: ['Ἀρχιμήδης'],
  Ptolemy: ['Πτολεμαῖος', 'Κλαύδιος Πτολεμαῖος'],
  Nicomachus: ['Νικόμαχος'],
  Apollonius: ['Ἀπολλώνιος'],
  Aratus: ['Ἄρατος'],

  // History, biography, geography
  Herodotus: ['Ἡρόδοτος', 'Ἡροδότου'],
  Thucydides: ['Θουκυδίδης', 'Θουκυδίδου'],
  Plutarch: ['Πλούταρχος', 'Πλουτάρχου'],
  'Diogenes Laertius': ['Διογένης Λαέρτιος'],
  Strabo: ['Στράβων'],
  Pausanias: ['Παυσανίας'],
  Athenaeus: ['Ἀθήναιος'],
  Lucian: ['Λουκιανός'],
  Josephus: ['Ἰώσηπος', 'Φλάβιος Ἰώσηπος'],

  // Poetry and drama
  Homer: ['Ὅμηρος', 'Ὁμήρου'],
  Hesiod: ['Ἡσίοδος'],
  Pindar: ['Πίνδαρος'],
  Aeschylus: ['Αἰσχύλος', 'Αἰσχύλου'],
  Sophocles: ['Σοφοκλῆς', 'Σοφοκλέους'],
  Euripides: ['Εὐριπίδης', 'Εὐριπίδου'],
  Aristophanes: ['Ἀριστοφάνης', 'Ἀριστοφάνους'],

  // Hermetica, alchemy and the patristic tradition this library collects
  // The articled form is how it usually appears in the texts themselves; the
  // bare form is how a reader is likelier to type it. Carry both.
  'Hermes Trismegistus': ['Ἑρμῆς Τρισμέγιστος', 'Ἑρμῆς ὁ Τρισμέγιστος', 'Ἑρμοῦ τοῦ Τρισμεγίστου'],
  Zosimos: ['Ζώσιμος'],
  Philo: ['Φίλων'],
  Eusebius: ['Εὐσέβιος'],
  Origen: ['Ὠριγένης'],
  Athanasius: ['Ἀθανάσιος'],
};

/** Greek letters, incl. the polytonic (Extended) block. */
const GREEK_SCRIPT = /[Ͱ-Ͽἀ-῿]/;

export function isGreekScript(s: string): boolean {
  return GREEK_SCRIPT.test(s);
}

/**
 * Name forms for a `books.author` string. The field is free text and routinely
 * holds several people ("Galen; Hippocrates"), editorial roles ("Plato; tr.
 * Thomas Taylor") and pseudo- attributions ("Pseudo-Aristotle"), so every key is
 * tested for containment rather than equality — a Pseudo-Aristotle volume should
 * still be reachable by searching Ἀριστοτέλης, since that is what a reader
 * looking for it would type.
 */
export function nameFormsFor(author: string | null | undefined): string[] {
  if (!author) return [];
  const hay = author.toLowerCase();
  const out = new Set<string>();
  for (const [key, forms] of Object.entries(CLASSICAL_NAME_FORMS)) {
    if (hay.includes(key.toLowerCase())) for (const f of forms) out.add(f);
  }
  return [...out];
}
