# When a passage was written, for the figure-reception scripts (#7073). Python twin of writtenYear() in lib.mjs.
# PRIOR ART: none — written.json is new (written.mjs); nothing else in scripts/ dates a passage by its author.
#
# written.json gives an old text in a later edition its author's death year. Passages on preface, appendix or
# dedication pages keep the edition's year: in a modern edition of an old text those pages are the editor's. So does
# a passage that reads like the editor's note (EDITORIAL: a modern scholar named, or apparatus wording), since
# editions print their notes on the same pages as the text, and a passage that names the book's own author
# (Jowett's introductions in a Plato, an editor's "compare Plato" in a Phaedo).
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
_W = json.load(open(os.path.join(HERE, 'written.json')))
EDITOR_PAGES = {'preface', 'appendix', 'dedication'}
EDITORIAL = re.compile(r'\b(Boeckh|Böckh|Diels|Zeller|Stallbaum|Mullach|Bekker|Burnet|Jowett|Schleiermacher|Fabricius|Meursius|'
                       r'Kühn|Hercher|Wyttenbach|Heyne|Bentley|Casaubon|Scaliger|Lobeck|Brandis|Ritter|Chaignet|Usener|Tannery)\b|'
                       r'^\W*\d+[,.] ?\d+\b|before Christ|\bB\. ?C\.|\bcentur(y|ies)\b|\b(cf|edd?|sc|viz)\.|variant|omitted in|see fragment|\bfragment \d+|\bfr\. ?\d+|\(\d+\) see\b', re.I)


def written_year(book_id, edition_year, page_type=None, text=None):
    w = _W.get(book_id)
    if w is None or page_type in EDITOR_PAGES:
        return edition_year
    if text and (EDITORIAL.search(text) or (len(w) > 2 and w[2] and re.search(r'\b' + re.escape(w[2]) + r'\b', text))):
        return edition_year
    return w[0]


def page_types(hits):
    """(book id, page) -> page type, from hits.json."""
    return {(b['id'], p['p']): p.get('type') for b in hits for p in b['passages']}
