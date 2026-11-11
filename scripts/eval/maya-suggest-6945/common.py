# Shared paths and reading normalisation for the #6903 stage-2 Palenque eval and the #6945 suggester replay.
# PRIOR ART: round 2's harness (/data/scratch/sl/jobs/maya-glyph-team-6903/bin/score.py, not committed: wired to a
# private key) — norm_tok/key_tokens are copied from it so Palenque and Dresden are scored the same way; the number-word
# folding is new, because Stuart writes coefficients as digits and models often write them as words.
import json, os, re

MS = os.environ.get('MS', '/data/scratch/sl/jobs/maya-suggest-6945/')      # this job's scratch (private: readings, crops)
R2 = os.environ.get('R2', '/data/scratch/sl/jobs/maya-glyph-team-6903/')   # round 2 (Dresden pieces, sign index, retrieval)
R1 = os.environ.get('R1', '/data/scratch/sl/jobs/maya-glyph-6903/')        # round 1 (Dresden items, private key, catalogue)

# Only number words that are not also a common syllable or logogram (jun/HUN, cha, CHAN, ho, UK' are left alone: the
# blind judges catch those, the deterministic scorer does not).
NUM = {'ox': '3', 'wak': '6', 'wuk': '7', 'waxak': '8', 'balun': '9', 'bolon': '9', 'lahun': '10', 'lajun': '10',
       'buluch': '11', 'buluk': '11', "lahcha'": '12', 'lahcha': '12', 'lajcha': '12', 'oxlahun': '13', 'uxlahun': '13',
       'chanlahun': '14', 'holahun': '15', 'waklahun': '16', 'uklahun': '17', 'waxaklahun': '18', 'balunlahun': '19'}
UNK = re.compile(r'^(\?\?|_+|\?|…|\.\.\.|)$')

def norm_tok(t):
    t = t.lower().strip()
    t = re.sub(r"[’ʼ`´‘]", "'", t).replace('“', '').replace('”', '').replace('"', '')
    t = re.sub(r'\([^)]*\)', '', t).replace('(', '').replace(')', '')
    t = t.replace('?', '').replace('[', '').replace(']', '').replace('…', '')
    t = t.replace("b'", 'b').replace('j', 'h')
    t = re.sub(r'([aeiou])\1', r'\1', t)
    t = re.sub(r"([aeiou])h(?=[^aeiou'\s]|$)", r'\1', t) if len(t) > 3 else t
    t = t.replace("'", '').strip()  # glottal stops folded: models drop them as often as they misplace them
    return NUM.get(t, t)

def split_tokens(tr):
    return [x for x in re.split(r'[-\s.]+', (tr or '').strip()) if x]

def key_tokens(tr):
    """Reference transliteration -> list of alternative-sets, one per legible sign (unknown signs dropped)."""
    out = []
    for tok in split_tokens(tr):
        alts = [a for a in tok.split('/') if not UNK.match(a.strip())]
        alts = {norm_tok(a) for a in alts}
        alts.discard('')
        if alts: out.append(alts)
    return out

def model_tokens(tr):
    s = set()
    for tok in re.split(r'[-\s.,;]+', (tr or '')):
        for a in tok.split('/'):
            n = norm_tok(a)
            if n: s.add(n)
    return s

def is_illegible(tr):
    return not key_tokens(tr)

def squash(tr): return re.sub(r'\s+', '', tr or '')

def jl(p): return json.load(open(p))
def jd(o, p): json.dump(o, open(p, 'w'), ensure_ascii=False, indent=1)
