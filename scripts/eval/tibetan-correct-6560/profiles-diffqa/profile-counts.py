#!/usr/bin/env python3
# PRIOR ART: pass/rescore.mjs on #7479 (severe vs minor per page, for the write rule) and the hand classification of
# judge B's draft-side spans on #6560 (2026-10-16, G4L gate). Neither counts the KINDS of change on both sides of the
# leaf, which is what the two error profiles quote; this counts them, mechanically, from the judged audits.
"""
Measured counts for the two error profiles (#6560, #6740): every span an earlier tiled span judge DECIDED, by kind.
  leaf shows the correction -> an error of the DRAFT (Yigdzin) that Flash fixed
  leaf shows the draft      -> an error Flash INTRODUCED

  python3 profile-counts.py KEY.json.gz:REPLIES.jsonl.gz [...] > counts.json

Kinds, first match wins (both readings of a span, syllables joined by tsheg):
  line      one side has 6+ syllables and the sides differ by 4+ (text present in one, missing in the other)
  punct     only tsheg, shad or spacing differs (includes a syllable split or joined)
  yatags    only a subscribed ya differs
  mantra    either side carries a Sanskrit mark (long vowel, anusvara, candrabindu, visarga, retroflex, ṣa, kṣa)
  vowel     the same letters apart from the vowel signs
  particle  both sides are 1-2 syllables from the particle list
  word      anything else: another syllable or word
"""
import gzip, json, re, sys, collections

PUNCT = re.compile('[་།༎༏༐༑༔  ༌]')
SKT = re.compile('[\u0f71\u0f80\u0f7e\u0f83\u0f7f\u0f84\u0f4a\u0f4b\u0f4c\u0f4e\u0f65\u0f9a\u0f9b\u0f9c\u0f9e\u0fb5\u0f69]')  # aa, reversed i, anusvara, candrabindu, visarga, halanta, retroflex, ssa, kssa (not plain i/u: #7479 rescore bug)
VOWELS = re.compile('[ིེོཻཽྀུ]')
PARTICLES = set('ཀྱི གྱི གི ཡི འི ཀྱིས གྱིས གིས ཡིས ས ཏུ དུ རུ སུ ར ན ལ ནས ལས དང ཀྱང ཡང འང ཏེ དེ སྟེ ཅིང ཞིང ཤིང གམ ངམ འམ ནམ མམ རམ ལམ སམ ཏམ དམ བམ ཅེས ཞེས ཤེས ཅི ཞིག ཅིག ཤིག པ བ པོ བོ མ མོ ཀྱང ནི'.split())


def parse(text):
    m = re.search(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)', text or '')
    out = {}
    for l in (m.group(1) if m else (text or '')).split('\n'):
        l = l.strip().rstrip(',')
        if l.startswith('{'):
            try:
                j = json.loads(l); out[int(j['item'])] = j
            except Exception:
                pass
    return out


def side(it, ans):
    a = str((ans or {}).get('answer', '')).strip().upper()
    if a in ('A', 'B'):
        return 'arm' if (a == 'A') == (it['A_is'] == 'arm') else 'base'
    return None


def kind(base, arm):
    b, a = base or '', arm or ''
    nb, na = len([s for s in b.split('་') if s]), len([s for s in a.split('་') if s])
    if max(nb, na) >= 6 and abs(nb - na) >= 4:
        return 'line'
    if PUNCT.sub('', b) == PUNCT.sub('', a):
        return 'punct'
    if b.replace('ྱ', '') == a.replace('ྱ', ''):
        return 'yatags'
    if SKT.search(b) or SKT.search(a):
        return 'mantra'
    if VOWELS.sub('', PUNCT.sub('', b)) == VOWELS.sub('', PUNCT.sub('', a)):
        return 'vowel'
    if 1 <= nb <= 2 and 0 <= na <= 2 and all(s in PARTICLES for s in (b + '་' + a).split('་') if s):
        return 'particle'
    return 'word'


def main():
    out = {'by_audit': {}, 'total': {'fixed': collections.Counter(), 'introduced': collections.Counter()}, 'examples': {'introduced': collections.defaultdict(list), 'fixed': collections.defaultdict(list)}}
    for spec in sys.argv[1:]:
        kf, rf = spec.split(':')
        key = json.load(gzip.open(kf, 'rt'))
        rep = {}
        for l in gzip.open(rf, 'rt'):
            r = json.loads(l)
            if r.get('text'):
                rep[r['uid']] = parse(r['text'])
        c = {'fixed': collections.Counter(), 'introduced': collections.Counter(), 'pages': 0}
        for pid, k in key.items():
            if pid not in rep:
                continue
            c['pages'] += 1
            for it in k['items']:
                if it['kind'] != 'span':
                    continue
                s = side(it, rep[pid].get(it['item']))
                if not s:
                    continue
                kd = kind(it.get('base'), it.get('arm'))
                lab = 'fixed' if s == 'arm' else 'introduced'
                c[lab][kd] += 1
                out['total'][lab][kd] += 1
                ex = out['examples'][lab][kd]
                if len(ex) < 6:
                    ex.append(f"{it.get('base') or '∅'} → {it.get('arm') or '∅'}")
        out['by_audit'][kf.split('/')[-1]] = {'pages': c['pages'], 'fixed': dict(c['fixed']), 'introduced': dict(c['introduced'])}
    out['total'] = {k: dict(v) for k, v in out['total'].items()}
    out['examples'] = {k: dict(v) for k, v in out['examples'].items()}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
