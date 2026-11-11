# PRIOR ART: shapekey.py (session research) — its shape classes; the Manchu roman table below is new.
# Test 2 scorer (#5664, mongol-selfgt): Manchu-model reads of Kanjur word crops -> Mongolian shape classes ->
# lexicon hit, vs our LoRA's aligned read of the SAME crop. Shape classes are those of shapekey.py.
#
# Manchu (Möllendorff romanisation, as the model emits it) -> Mongolian shape class. Doubtful rows marked (?):
#   A E N -> A        a, e and n share the tooth in both scripts; Manchu dots (n, e) do not exist in the Kanjur
#   O U Ū W -> O      (?) Manchu ū is its own glyph (a closed bowl with a tail), close to Mongolian ö/ü; w is the
#                     Manchu w, not the Kanjur's v/w ligature
#   I -> I
#   K G H K' G' H' -> Q   masculine and feminine forms; Mongolian q/γ/k/g all fall in Q anyway
#   B P -> B ; F -> B (?) Manchu f is a distinct letter (no Kanjur equivalent), placed with b/p as shapekey.py
#                     places Mongolian ᠹ
#   S Š SY -> S ; T D -> T (Manchu d differs from t only by a dot in some positions)
#   J Y Ž DZ -> J (?) ž and dz are Chinese-transcription letters
#   C TS -> C (?) ts likewise ; NG -> AQ (as ᠩ) ; L M R -> L M R
import json, sys, random, re
from collections import Counter, defaultdict
sys.path.insert(0, '.'); from align import mwords
C = {}
for chs, k in [('ᠠᠡᠨ', 'A'), ('ᠣᠤᠥᠦᠸ', 'O'), ('ᠲᠳ', 'T'), ('ᠬᠭᠺᠻᠾ', 'Q'), ('ᠵᠶᠽ', 'J'), ('ᠪᠫᠹ', 'B'), ('ᠢᠧ', 'I'), ('ᠰᠱ', 'S'), ('ᠴᠼ', 'C')]:
    for ch in chs: C[ch] = k
C.update({'ᠩ': 'AQ', 'ᠮ': 'M', 'ᠯ': 'L', 'ᠷ': 'R'})
mkey = lambda w: ''.join(C.get(c, '?') for c in w)
DI = [("K'", 'Q'), ("G'", 'Q'), ("H'", 'Q'), ('NG', 'AQ'), ('TS', 'C'), ('DZ', 'J'), ('SY', 'S'), ('JY', 'J')]
SI = {**{c: 'A' for c in 'AEN'}, **{c: 'O' for c in 'OUŪW'}, 'I': 'I', **{c: 'Q' for c in 'KGH'}, **{c: 'B' for c in 'BPF'},
      'S': 'S', 'Š': 'S', 'T': 'T', 'D': 'T', **{c: 'J' for c in 'JYŽ'}, 'C': 'C', 'L': 'L', 'M': 'M', 'R': 'R'}
def rkey(roman):
    r = roman.upper().replace('’', "'"); out = []; i = 0; n_letters = 0
    while i < len(r):
        for d, k in DI:
            if r.startswith(d, i): out.append(k); i += len(d); n_letters += 1; break
        else:
            ch = r[i]; i += 1
            if ch in SI: out.append(SI[ch]); n_letters += 1
            elif ch.isalpha(): out.append('?'); n_letters += 1
    return ''.join(out), n_letters
if __name__ == '__main__':
    reads_manchu, pairs, lexname = sys.argv[1:4]
    from lexicons import load
    lex, _lk = load(lexname); lexk = set(_lk)
    print(f'--- lexicon {lexname}: {len(lex)} words, {len(lexk)} shape keys')
    lora = {}
    for l in open(pairs):
        p = json.loads(l); lora[p['wid']] = p['read']
    M = [json.loads(l) for l in open(reads_manchu)]
    sanity = [m for m in M if m['set'] == 'manchu-test']
    if sanity:
        ok = sum(m['manchu'] == m['gold_m'] for m in sanity); okr = sum(m['roman'].upper() == m['gold_r'].upper() for m in sanity)
        print(f'sanity (Manchu real test words): word acc manchu {ok}/{len(sanity)}, roman {okr}/{len(sanity)}')
    random.seed(0)
    def shuffled(k):   # letter-shuffled control on shape keys
        return ''.join(random.sample(k, len(k)))
    for fl in (0, 1):
        K = [m for m in M if m['set'] == 'kanjur' and m.get('flip', 0) == fl]
        if not K: continue
        keys = [(m['wid'],) + rkey(m['roman']) for m in K]
        empty = sum(1 for _, k, n in keys if n == 0)
        for lo in (1, 4):
            s = [(w, k) for w, k, n in keys if n >= lo]
            if not s: continue
            hit = sum(k in lexk for _, k in s) / len(s); ctl = sum(shuffled(k) in lexk for _, k in s) / len(s)
            print(f'manchu flip={fl} len>={lo}: crops {len(s):5} (empty reads {empty}) shape-key lexicon hit {hit:.2f} | letter-shuffled {ctl:.2f}')
        both = [(w, k, lora[w]) for w, k, n in keys if w in lora and n >= 1]
        if both:
            for lo in (1, 4):
                s = [(w, k, r) for w, k, r in both if len(r) >= lo]
                if not s: continue
                print(f'  same crops with a LoRA read, LoRA len>={lo}: n {len(s):4}  LoRA key-hit {sum(mkey(r) in lexk for _,_,r in s)/len(s):.2f}  '
                      f'Manchu key-hit {sum(k in lexk for _,k,_ in s)/len(s):.2f}  Manchu==LoRA key {sum(k == mkey(r) for _,k,r in s)/len(s):.2f}  '
                      f'key length diff median {sorted(abs(len(k)-len(mkey(r))) for _,k,r in s)[len(s)//2]}')
