#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-correct-6560/profiles-diffqa/judge.mjs SEVERITY (PR #7505) asks the span judge
# whether two readings differ "severe"/"minor" and counts mantra vowel length as severe; profiles-diffqa/
# profile-counts.py buckets hunks by error KIND for the error profiles, not by reader impact. Neither gives the
# three reader-impact classes #6560 asks for (normalisation / minor / severe), so this is a rule pass + a hand table.
"""Reader-impact class of a span where the corrector changed the Yigdzin draft (#6560, 2026-10-27).

  normalisation (O8)  mantra/Sanskrit vowel length, anusvara/candrabindu, visarga, tshegs inside a Sanskrit cluster
  minor               particle variants, a particle added/dropped, tsheg/shad punctuation, a split or join,
                      the same word spelled another way
  severe              another word with another meaning, negation, number, name, text added or dropped (O1/O5/O6/O7)
                      sub-kinds: word (1-2 syllables swapped), adddrop (1-2 syllables added/dropped),
                      phrase (3+ syllables replaced, added or dropped)

The rules settle what they can; a span they cannot settle (one letter changed in one syllable: ཚོན→ཚོགས is another
word, ཙད→ཅད is a spelling) goes to the hand table hand-labels.json, keyed base→arm, read by one reader (the job's
Opus session) without the leaf, as a reader would meet the difference. The hand table overrides the rules.
"""
import json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
TSHEG = '་༌'
NORM_MARKS = 'ཱཾྂྃཿ྄༹'   # a-chung (vowel length), anusvara, candrabindu x2, visarga, halanta, tsa-phru
SKT = re.compile('[ཱཾྂྃཿཱྀྀགྷཌྷདྷབྷཛྷཀྵྒྷྜྷྡྷྦྷྫྷྐྵཊཋཌཎཥྚྛྜྞྵ]')
PARTICLES = [
    {'ཀྱི', 'གྱི', 'གི', 'འི', 'ཡི'}, {'ཀྱིས', 'གྱིས', 'གིས', 'ཡིས', 'ས'}, {'ཏུ', 'དུ', 'སུ', 'རུ', 'ར', 'ན', 'ལ'},
    {'སྟེ', 'ཏེ', 'དེ'}, {'ཀྱང', 'ཡང', 'འང'}, {'ཅེས', 'ཞེས', 'ཤེས'}, {'ཅིང', 'ཞིང', 'ཤིང'}, {'ཅེ', 'ཞེ', 'ཤེ'},
    {'གམ', 'ངམ', 'དམ', 'ནམ', 'བམ', 'མམ', 'འམ', 'རམ', 'ལམ', 'སམ', 'ཏམ'}, {'གོ', 'ངོ', 'དོ', 'ནོ', 'བོ', 'མོ', 'འོ', 'རོ', 'ལོ', 'སོ', 'ཏོ'},
    {'པ', 'བ'}, {'པོ', 'བོ'}, {'པའི', 'བའི', 'པ་ཡི', 'བ་ཡི'}, {'པར', 'བར'}, {'པས', 'བས'}, {'ནི'}, {'དང'}, {'ནས', 'ལས'},
]
PARTICLE_SET = set().union(*PARTICLES)


def nfd(t):
    return unicodedata.normalize('NFD', t or '')


def strip(t, marks):
    return ''.join(c for c in nfd(t) if c not in marks)


def syls(t):
    return [s for s in re.split('[་༌།༎\\s]+', t or '') if s]


def same_particle(a, b):
    return any(a in g and b in g for g in PARTICLES)


def rule(base, arm):
    """(class, sub, why) or ('?', sub, why) when the rules cannot settle it."""
    A, B = syls(base), syls(arm)
    n = max(len(A), len(B))
    sub = 'phrase' if n >= 3 else 'adddrop' if not A or not B else 'word'
    skt = bool(SKT.search(base or '') or SKT.search(arm or ''))
    if skt and strip(base, NORM_MARKS + TSHEG).replace('ྀ', 'ི') == strip(arm, NORM_MARKS + TSHEG).replace('ྀ', 'ི'):
        return 'normalisation', sub, 'equal without vowel length / anusvara / visarga / tsheg'
    if strip(base, TSHEG + ' ') == strip(arm, TSHEG + ' '):
        return 'minor', sub, 'split, join or tsheg'
    if not A or not B:
        rest = A or B
        if all(s in PARTICLE_SET for s in rest) and len(rest) <= 1:
            return 'minor', sub, 'particle added or dropped'
        return 'severe', sub, 'text added or dropped'
    if len(A) == len(B):
        diff = [(x, y) for x, y in zip(A, B) if x != y]
        if all(same_particle(x, y) for x, y in diff):
            return 'minor', sub, 'particle variant'
        # one syllable fused with its particle (པའི vs པ་ཡི), or a particle merged into the syllable before it
    if ''.join(A).replace('ཡི', 'འི') == ''.join(B).replace('ཡི', 'འི'):
        return 'minor', sub, 'particle fused/split'
    if skt and n <= 2:
        return '?', sub, 'Sanskrit syllable changed beyond length marks'
    if n == 1 and len(A) == 1 and len(B) == 1:
        return '?', sub, 'one syllable changed'
    return 'severe', sub, 'different syllables'


def classify(base, arm, hand):
    c, sub, why = rule(base, arm)
    k = f'{base}→{arm}'
    if k in hand:
        h = hand[k]
        c, why = h['class'], f"hand: {h.get('why', '')}"
    return {'class': c, 'sub': sub if c == 'severe' else None, 'why': why}


def load_hand():
    p = os.path.join(HERE, 'hand-labels.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}


if __name__ == '__main__':
    hand = load_hand()
    for line in sys.stdin:
        base, _, arm = line.rstrip('\n').partition('→')
        print(json.dumps({'base': base, 'arm': arm, **classify(base, arm, hand)}, ensure_ascii=False))
