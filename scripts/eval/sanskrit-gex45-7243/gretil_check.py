# PRIOR ART: none for GRETIL-vs-reference checks of a Devanagari page (the Latin and Chinese checks align Wikisource/Kanripo text in their own scripts). gretil_check.py <final refs dir>: our four BORI Mahabharata references, transliterated to IAST, against GRETIL mbh_NN_u.htm (starred passages excluded).
import re, html, json, sys, unicodedata
V = {'अ':'a','आ':'ā','इ':'i','ई':'ī','उ':'u','ऊ':'ū','ऋ':'ṛ','ॠ':'ṝ','ऌ':'ḷ','ए':'e','ऐ':'ai','ओ':'o','औ':'au'}
M = {'ा':'ā','ि':'i','ी':'ī','ु':'u','ू':'ū','ृ':'ṛ','ॄ':'ṝ','ॢ':'ḷ','े':'e','ै':'ai','ो':'o','ौ':'au'}
C = dict(zip('कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह', ['k','kh','g','gh','ṅ','c','ch','j','jh','ñ','ṭ','ṭh','ḍ','ḍh','ṇ','t','th','d','dh','n','p','ph','b','bh','m','y','r','l','v','ś','ṣ','s','h']))
C['ळ'] = 'ḷ'
def deva2iast(s):
    s = unicodedata.normalize('NFC', s); out = []; i = 0
    while i < len(s):
        ch = s[i]
        if ch in C:
            out.append(C[ch]); nx = s[i+1] if i + 1 < len(s) else ''
            if nx == '़': i += 1; nx = s[i+1] if i + 1 < len(s) else ''
            if nx == '्': i += 1
            elif nx in M: out.append(M[nx]); i += 1
            else: out.append('a')
        elif ch in V: out.append(V[ch])
        elif ch == 'ं': out.append('ṃ')
        elif ch == 'ः': out.append('ḥ')
        elif ch == 'ँ': out.append('ṃ')
        elif ch == 'ऽ': pass
        else: out.append(ch)
        i += 1
    return ''.join(out)
def norm(t):  # letters only; class nasal before a stop and anusvara folded to one symbol
    t = re.sub(r'\s+', '', unicodedata.normalize('NFC', t.lower()).replace("'", ''))
    t = re.sub(r'[ṅñṇnm](?=[kgcjṭḍtdpb])', 'ṃ', t)
    t = re.sub(r'm(?=$)', 'ṃ', t)
    return ''.join(re.findall(r'[a-zāīūṛṝḷṃḥṅñṭḍṇśṣ]', t))
def lev(a, b):
    p = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        c = [i]
        for j, y in enumerate(b, 1): c.append(min(p[j] + 1, c[j-1] + 1, p[j-1] + (x != y)))
        p = c
    return p[-1]
pages = {'sa-1697c6ed-p499': '06', 'sa-1697bec1-p584': '03', 'sa-1697c43d-p421': '05', 'sa-1697d8cb-p58': '14'}
res = {}
for slug, bk in pages.items():
    raw = html.unescape(re.sub(r'<[^>]+>', '\n', open(f'mbh_{bk}.htm', encoding='utf-8').read()))
    lines = [re.sub(r'^\d\d,\d+\.\d+\S*\s*', '', l) for l in raw.split('\n') if re.match(r'^\d\d,\d+\.\d+', l) and '*' not in l.split()[0]]
    G = norm(' '.join(lines))
    ref = open(f"{sys.argv[1]}/{slug}.txt").read().split('\n')[1:]          # drop the running head
    R = norm(deva2iast(re.sub(r'[०-९0-9॥।]', ' ', '\n'.join(ref))))
    a = G.find(R[:24]); b = G.find(R[-24:], a)
    if a < 0 or b < 0: res[slug] = {'aligned': False}; continue
    W = G[a:b + 24]; d = lev(R, W)
    res[slug] = {'ref_chars': len(R), 'gretil_chars': len(W), 'edits': d, 'cer_pct': round(100 * d / len(W), 2)}
    import difflib
    sm = difflib.SequenceMatcher(None, W, R, autojunk=False)
    res[slug]['diffs'] = [(W[i1-6:i2+6], R[j1-6:j2+6]) for t, i1, i2, j1, j2 in sm.get_opcodes() if t != 'equal'][:8]
print(json.dumps(res, ensure_ascii=False, indent=1))
