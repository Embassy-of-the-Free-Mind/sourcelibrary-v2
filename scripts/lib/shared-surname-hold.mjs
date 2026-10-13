// PRIOR ART: src/lib/entity-aliases.ts + the `entity_aliases` collection — route a variant to ONE
// canonical record; a shared surname has no one record to route to. src/lib/search/name-chooser.ts
// — finds the bearers of a surname at query time for the "Which Bacon?" card; it reads, it does
// not decide what an index writer attaches. scripts/audit/shared-surname-reattribution-plan.mjs —
// moves mentions that are already on the bare record; the writers put new ones back (#5950).
/**
 * Surnames an index writer must not attach to a person record (#5950).
 *
 * The extractors get a bare name back from the model ("Bacon") and attach the mention to the
 * `entities` person record of that exact name. Where that record carries ONE person's Wikidata
 * id, dates and portrait and several people share the surname, every such mention is a claim
 * about that one person: 47% of sampled mentions on such records were on the wrong person
 * (scripts/eval/experiments/2026-10-06-shared-name-mislinks-5950.md).
 *
 * A held surname is attached to NO person record. The mention is not lost: it stays in the
 * book's own index (`book_indexes.people`), where it can be found again once someone has decided
 * whose it is.
 *
 * THE LIST IS WRITTEN BY HAND, one surname at a time, after its mentions were read by eye. It is
 * not generated: the mechanical rule "two full-name records with distinct Wikidata ids share the
 * last word" matches 219 large single-name records on 2026-10-06, among them Aristotle (5,383
 * books), David, Adam and Paul, because the ids and the names in `entities` are not clean enough
 * to carry it. Each entry names at least two bearers with distinct ids and the measured share
 * of wrong mentions.
 *
 * Not listed, on purpose: a bare record that claims NOBODY (no Wikidata id; Montanus, Bruno,
 * Fabricius, Agrippa after their claims were cleared). A mention there names no one wrongly, and
 * it is where the plan looks for mentions to move.
 *
 * Imported by all five writers of `entities.books[]` (the .mjs workers and the three routes);
 * tests/unit/entity-page-attribution.test.ts fails if one of them stops calling it.
 */
export const HELD_SURNAMES = {
  Bacon: {
    wrong: '3 of 10',
    bare_record_claims: 'Q37388',
    bearers: [{ name: 'Roger Bacon', wikidata_id: 'Q171677' }, { name: 'Francis Bacon', wikidata_id: 'Q37388' }],
  },
  Scaliger: {
    wrong: '6 of 10',
    bare_record_claims: 'Q441066',
    bearers: [{ name: 'Julius Caesar Scaliger', wikidata_id: 'Q441066' }, { name: 'Joseph Scaliger', wikidata_id: 'Q315163' }],
  },
  Agricola: {
    wrong: '4 of 10',
    bare_record_claims: 'Q76579',
    bearers: [{ name: 'Georgius Agricola', wikidata_id: 'Q76579' }, { name: 'Rodolphus Agricola', wikidata_id: 'Q365557' }],
  },
  Philalethes: {
    wrong: '3 of 10',
    bare_record_claims: 'Q3801927',
    bearers: [{ name: 'Eirenaeus Philalethes', wikidata_id: 'Q3801927' }, { name: 'Eugenius Philalethes', wikidata_id: 'Q3397209' }],
  },
};

const foldName = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const HELD = new Set(Object.keys(HELD_SURNAMES).map(foldName));

/**
 * Is this the bare form of a held surname? Only the exact single word, as a person: "Bacon" is
 * held; "Roger Bacon", "Lord Bacon" and a place or concept called "Bacon" are not.
 * @param {string} name the name the mention would be attached to (after alias resolution)
 * @param {string} type 'person' | 'place' | 'concept'
 * @returns {boolean}
 */
export function isHeldSurname(name, type) {
  return type === 'person' && HELD.has(foldName(name));
}
