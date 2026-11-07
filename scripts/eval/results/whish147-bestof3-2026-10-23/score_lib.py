"""Shared helpers for score.py and probe_score.py (#7119); see score.py for provenance."""
import os, re, json, unicodedata
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ['JOB_SCRATCH']
VERSE = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t']
COMM = ['20-b', '45-b', '129-b']
MODELS = {'opus': ['opus-1', 'opus-2', 'opus-3'], 'sonnet': ['sonnet-1', 'sonnet-2', 'sonnet-3'], 'fable': ['fable-1', 'fable-2', 'fable-3']}
LOC = {**json.load(open(f'{HERE}/locate-A.json')), **json.load(open(f'{HERE}/locate-C.json'))}
ED = {w: open(f'{S}/editions/{w}.txt').read() for w in ('sk', 'jm', 'dipika')}

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
    if m > len(ref): return Levenshtein.distance(h, ref), 0
    return min((Levenshtein.distance(h, ref[k:k + m]), k) for k in range(0, len(ref) - m + 1))

def read_rows(stage, leaf):
    """The rows of one read, normalised IAST; a Sonnet read that needed its one retry is scored from the retry."""
    d = f'{HERE}/reads/{stage}'
    f = f'{d}/{leaf}.final.txt' if os.path.exists(f'{d}/{leaf}.final.txt') else f'{d}/{leaf}.txt'
    if not os.path.exists(f): return None
    rows = [m.group(1) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f).read(), re.M)]
    return [norm(mal2iast(r)) for r in rows]

def ref_for(leaf):
    l = LOC[leaf]; t = ED[l['work']]
    a, b = max(0, l['start'] - 200), min(len(t), l['end'] + 200)
    return norm(t[a:b])

