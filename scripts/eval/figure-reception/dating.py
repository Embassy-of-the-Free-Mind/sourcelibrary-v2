# When a passage was written, for the figure-reception scripts (#7073). Python twin of writtenYear() in lib.mjs.
# PRIOR ART: none — written.json is new (written.mjs); nothing else in scripts/ dates a passage by its author.
#
# written.json gives an old text in a later edition its author's death year. Passages on preface, appendix or
# dedication pages keep the edition's year: in a modern edition of an old text those pages are the editor's. So does
# a passage that reads like the editor's note (EDITORIAL: a modern scholar named, or apparatus wording), since
# editions print their notes on the same pages as the text, and a passage that names the book's own author
# (Jowett's introductions in a Plato, an editor's "compare Plato" in a Phaedo). In an edition printed after 1800 the
# first tenth of the book is taken to be the editor's introduction (D'Ooge's Nicomachus, 1926). And a passage that
# names someone who died more than LATER years after the book's author cannot be that author's words: the notes to
# Hesiod that cite Tzetzes, Ficino's arguments in his Plato, Dacier's commentary in a Pythagorean anthology (found
# 2026-10-22 when the Outside Diels list dated them 700 and 348 BCE). Names and death years are the one-word names
# in written.json, so only authors the library holds count.
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
_W = json.load(open(os.path.join(HERE, 'written.json')))
EDITOR_PAGES = {'preface', 'appendix', 'dedication'}
EDITORIAL = re.compile(r'\b(Boeckh|Böckh|Diels|Zeller|Stallbaum|Mullach|Bekker|Burnet|Jowett|Schleiermacher|Fabricius|Meursius|'
                       r'Kühn|Hercher|Wyttenbach|Heyne|Bentley|Casaubon|Scaliger|Lobeck|Brandis|Ritter|Chaignet|Usener|Tannery)\b|'
                       r'^\W*\d+[,.] ?\d+\b|before Christ|\bB\. ?C\.|\bcentur(y|ies)\b|\b(cf|edd?|sc|viz)\.|variant|omitted in|see fragment|\bfragment \d+|\bfr\. ?\d+|\(\d+\) see\b', re.I)


LATER = 50
# Only authors dead by 1200 count (later one-word names are given names: Simon, John, Lorenzo), less names an earlier
# person also bears (Socrates the church historian would re-date Plato's dialogues).
AMBIGUOUS = {'Socrates', 'Dionysius', 'Alexander', 'Maximus', 'Achilles', 'Clement', 'Basil', 'Hieronymus', 'Theodorus',
             'Gregory', 'Apollodorus', 'Philo', 'Diogenes', 'Hermes', 'Orpheus', 'Zoroaster', 'Numa', 'Valerius', 'Marcus',
             'David', 'Venerable', 'Deacon', 'Michael', 'George', 'John', 'Bernard', 'Bernardus', 'Omar', 'Muhammed', 'Muḥammad',
             'Hanno', 'Asclepius', 'Hermias', 'Cyril', 'Leontius', 'Zacharias', 'Guido', 'Honorius', 'Palladius', 'Macer'}
_DEATH = {}
for _v in _W.values():
    if len(_v) > 2 and _v[2] and len(_v[2]) >= 4 and _v[2][0].isupper() and _v[0] is not None and _v[0] <= 1200 and _v[2] not in AMBIGUOUS:
        _DEATH[_v[2]] = max(_DEATH.get(_v[2], _v[0]), _v[0])
_NAMES = re.compile(r'\b(' + '|'.join(sorted(map(re.escape, _DEATH), key=len, reverse=True)) + r')\b')


def names_later(text, year):
    return any(_DEATH[n] > year + LATER for n in set(_NAMES.findall(text)))


def written_year(book_id, edition_year, page_type=None, text=None, page=None):
    w = _W.get(book_id)
    if w is None or page_type in EDITOR_PAGES:
        return edition_year
    if page is not None and len(w) > 4 and w[3] and w[3] >= 1800 and w[4] and page <= 0.1 * w[4]:
        return edition_year
    if text and (EDITORIAL.search(text) or (len(w) > 2 and w[2] and re.search(r'\b' + re.escape(w[2]) + r'\b', text))):
        return edition_year
    if text and names_later(text, w[0]):
        return edition_year
    return w[0]


def page_types(hits):
    """(book id, page) -> page type, from hits.json."""
    return {(b['id'], p['p']): p.get('type') for b in hits for p in b['passages']}
