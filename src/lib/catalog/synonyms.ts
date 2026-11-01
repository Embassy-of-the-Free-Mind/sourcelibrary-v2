/**
 * Other names for the same subject, searched together.
 *
 * Searching "plague" should also find the books that call it pestilence,
 * pestis, Pestilenz or the Black Death. Titles in this corpus are Latin,
 * German, French and Italian as often as English, so a reader typing one
 * name sees a fraction of what the library holds: "plague" alone matched 5
 * catalogue titles where the group below matches 79 (measured 2026-10-17).
 *
 * PRIOR ART: src/lib/search/word-forms.ts folds the forms of ONE word
 * (magical → magic); src/lib/classical-name-forms.ts and AUTHOR_ALIAS_GROUPS
 * in books-catalog.ts fold PERSONAL names. Neither joins different words for
 * one subject, which is what this does.
 *
 * Why a checked list and not the AI search guide (/api/search/ai-expand):
 * the guide's "terms" are directions to look in — a book, a person, a field
 * ("De Contagione", "Fracastoro", "materia medica") — not other names. Adding
 * them automatically took "plague" from 94 to 249 results, many of them
 * general herbals. Library catalogues broaden from hand-made equivalence
 * lists ("Pestilence, see Plague") and offer everything else as suggestions;
 * the catalogue page does the same.
 *
 * STARTER LIST, unchecked by a subject specialist. Every entry should be a
 * name a title in the corpus could really use for the same subject. When in
 * doubt, leave a term out: a wrong synonym silently adds unrelated books to
 * every search for that subject.
 */

export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['plague', 'pestilence', 'black death', 'pestis', 'pestilentia', 'peste', 'pest', 'pestilenz'],
  ["philosophers' stone", "philosopher's stone", 'philosophers stone', 'lapis philosophorum', 'stein der weisen', 'pierre philosophale', 'pietra filosofale'],
  ['alchemy', 'alchemical', 'alchymical', 'alchymy', 'alchimia', 'alchymia', 'alchemia', 'alchemie', 'alchimie', 'alchymie'],
  ['chemistry', 'chymistry', 'chemia', 'chymia', 'chemie'],
  ['elixir', 'elixir of life', 'elixir vitae', 'lebenselixier'],
  ['quintessence', 'quinta essentia', 'quintessentia', 'quintessenz'],
  ['transmutation', 'transmutatio'],
  ['distillation', 'distillatio', 'destillatio', 'destillierkunst'],
  ['astrology', 'astrological', 'astrologia', 'astrologie'],
  ['kabbalah', 'kabbala', 'cabala', 'cabbala', 'qabbalah', 'kabbalistic', 'cabalistic'],
  ['rosicrucian', 'rose cross', 'rosae crucis', 'rosenkreuz', 'rosenkreutz', 'rosenkreuzer'],
  ['freemasonry', 'freemasons', 'masonic', 'freimaurer', 'freymaurer'],
  ['magic', 'magia', 'magie', 'magick'],
  ['natural magic', 'magia naturalis', 'magie naturelle'],
  ['witchcraft', 'witches', 'sorcery', 'maleficium', 'hexerei', 'hexen', 'sorcellerie', 'stregoneria'],
  ['angels', 'angeli', 'engel', 'anges'],
  ['demons', 'daemons', 'daemones', 'demonology', 'daemonologia', 'dämonen'],
  ['soul', 'anima', 'seele'],
  ['world soul', 'anima mundi', 'soul of the world', 'weltseele'],
  ['music of the spheres', 'harmony of the spheres', 'musica mundana', 'sphärenmusik'],
  ['art of memory', 'ars memoriae', 'ars memorativa', 'gedächtniskunst'],
  ['geomancy', 'geomantia', 'geomantie', 'punctierkunst'],
  ['palmistry', 'chiromancy', 'chiromantia', 'chiromantie'],
  ['physiognomy', 'physiognomia', 'physiognomonia', 'physiognomik', 'physiognomie'],
  ['quicksilver', 'argentum vivum', 'hydrargyrum', 'quecksilber'],
  ['antimony', 'antimonium', 'stibium', 'antimon'],
  ['syphilis', 'french disease', 'french pox', 'morbus gallicus', 'lues venerea', 'mal francese', 'franzosenkrankheit'],
  ['epilepsy', 'falling sickness', 'morbus caducus', 'epilepsia', 'fallsucht'],
  ['melancholy', 'melancholia', 'melancholie'],
  ['bloodletting', 'phlebotomy', 'phlebotomia', 'venesection', 'aderlass', 'aderlaß'],
  ['herbal', 'herbarium', 'herbarius', 'kräuterbuch', 'kreuterbuch'],
  ['comet', 'cometa', 'komet', 'comète'],
  ['eclipse', 'eclipsis', 'finsternis'],
];

/** Most other names added to one search; each is a query of its own. */
export const MAX_SYNONYMS = 7;

/** Lower case, accents folded, curly apostrophes straightened. */
export function foldSynonymText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The other names to search alongside `query`, with the rest of the query kept
 * around each: "plague remedies" → "pestilence remedies", "pestis remedies"….
 * The longest name found anywhere in the query decides the group, so
 * "natural magic" is not read as "magic". Empty when no group applies.
 */
export function synonymsFor(query: string, max = MAX_SYNONYMS): string[] {
  const q = ` ${foldSynonymText(query).trim()} `;
  if (q.trim().length < 3) return [];
  let best: { group: readonly string[]; term: string; hit: string } | null = null;
  for (const group of SYNONYM_GROUPS) {
    for (const name of group) {
      const term = foldSynonymText(name);
      if (best && term.length <= best.term.length) continue;
      // Whole words only, plural allowed: "pest" must not fire inside "tempest".
      const m = q.match(new RegExp(`(^|[^\\p{L}])${escapeRe(term)}(?:s|es)?(?![\\p{L}])`, 'u'));
      if (m) best = { group, term, hit: m[0].slice(m[1].length) };
    }
  }
  if (!best) return [];
  const found = best;
  return found.group
    .filter((name) => foldSynonymText(name) !== found.term)
    .slice(0, max)
    .map((name) => q.replace(found.hit, name).trim());
}

/**
 * Does `text` really use the other name `phrase`? Each word of the phrase that
 * is not already in `query` must appear as a whole word (common Latin, German
 * and English endings allowed). Used to keep a book an other-name search
 * returned only when the name is actually there: a meaning-based search for
 * "black death" also returns books about black bile.
 */
export function textUsesName(text: string, phrase: string, query = ''): boolean {
  const hay = foldSynonymText(text);
  const own = new Set(foldSynonymText(query).split(/\s+/));
  const words = foldSynonymText(phrase).split(/\s+/).filter((w) => w && !own.has(w));
  return words.length > 0 && words.every((w) =>
    new RegExp(`(^|[^\\p{L}])${escapeRe(w)}(?:s|es|a|ae|e|i|is|um|orum|en|n|ia)?(?![\\p{L}])`, 'u').test(hay));
}
