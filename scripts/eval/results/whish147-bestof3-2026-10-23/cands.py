"""Candidate rows for the Whish 147 best-of-N judges (#7119): each read's ROW lines in Malayalam as written, and the
same rows in IAST with the [illegible]-style marks kept, so the text judge sees where a read gave up.
PRIOR ART: ../whish147-stability-recall-2026-10-23/judge.mjs (branch eval/whish147-stability-recall) builds the IAST
inline with score_lib.mal2iast, which drops the bracketed marks; this keeps them and also hands back the Malayalam.
Usage: python cands.py <read.txt> [<read.txt> ...]   -> JSON {path: {mal: [...], iast: [...]}} on stdout
"""
import json, re, sys
from indic_transliteration import sanscript as s

FIX = (('ൎ', 'ര്'), ('ൽ', 'ല്'), ('ൻ', 'ന്'), ('ർ', 'ര്'), ('ൾ', 'ള്'), ('ൺ', 'ണ്'))


def m2i(seg):
    out = []
    for part in re.split(r'(\[[^\]]*\])', seg):
        if part.startswith('['):
            out.append(' [illegible] ')
            continue
        mal = ''.join(ch for ch in part if 'ഀ' <= ch <= 'ൿ' or ch.isspace())
        for a, b in FIX:
            mal = mal.replace(a, b)
        out.append(s.transliterate(mal, s.MALAYALAM, s.IAST).replace('è', 'e').replace('ò', 'o'))
    return re.sub(r'\s+', ' ', ''.join(out)).strip()


def rows(path):
    t = open(path, encoding='utf8').read()
    return [m.group(1).strip() for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', t, re.M)]


if __name__ == '__main__':
    out = {}
    for p in sys.argv[1:]:
        r = rows(p)
        out[p] = dict(mal=r, iast=[' ‖ '.join(m2i(x) for x in row.split('‖')) for row in r])
    print(json.dumps(out, ensure_ascii=False))
