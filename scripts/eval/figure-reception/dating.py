# When a passage was written, for the figure-reception scripts (#7073). Python twin of writtenYear() in lib.mjs.
# PRIOR ART: none — written.json is new (written.mjs); nothing else in scripts/ dates a passage by its author.
#
# written.json gives an old text in a later edition its author's death year. Passages on preface, appendix or
# dedication pages keep the edition's year: in a modern edition of an old text those pages are the editor's.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
_W = json.load(open(os.path.join(HERE, 'written.json')))
EDITOR_PAGES = {'preface', 'appendix', 'dedication'}


def written_year(book_id, edition_year, page_type=None):
    w = _W.get(book_id)
    if w is None or page_type in EDITOR_PAGES:
        return edition_year
    return w[0]


def page_types(hits):
    """(book id, page) -> page type, from hits.json."""
    return {(b['id'], p['p']): p.get('type') for b in hits for p in b['passages']}
