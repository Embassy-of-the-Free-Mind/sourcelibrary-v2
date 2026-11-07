"""Shared per-row CER helpers for the Whish 147 fresh-read scoring (#7119); copied from #7148's score-lines.py."""
import re, unicodedata
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein

def norm(t):
    t = unicodedata.normalize('NFC', t).lower()
    t = re.sub(r"[0-9\-'’`.\s|,;:()\[\]^*/_]|sk_\d+", '', t)
    t = re.sub(r'r([kgcjṭḍtdpbm])\1', r'r\1', t)
    t = re.sub(r'(?:ṃ|ṅ|ñ|ṇ)(?=[kgcjṭḍtdpb])', 'm', t)
    return t.replace('ṃ', 'm')

def mal2iast(txt):
    txt = re.sub(r'\[[^\]]*\]', ' ', txt); txt = re.sub(r'<[^>]+>', ' ', txt)
    mal = ''.join(ch for ch in txt if 'ഀ' <= ch <= 'ൿ' or ch.isspace())
    for a, b in (('ൎ', 'ര്'), ('ൽ', 'ല്'), ('ൻ', 'ന്'), ('ർ', 'ര്'), ('ൾ', 'ള്'), ('ൺ', 'ണ്')): mal = mal.replace(a, b)
    return s.transliterate(mal, s.MALAYALAM, s.IAST).replace('è', 'e').replace('ò', 'o')

def best(h, ref):
    m = len(h)
    if m > len(ref): return Levenshtein.distance(h, ref)
    return min(Levenshtein.distance(h, ref[k:k + m]) for k in range(0, len(ref) - m + 1))
