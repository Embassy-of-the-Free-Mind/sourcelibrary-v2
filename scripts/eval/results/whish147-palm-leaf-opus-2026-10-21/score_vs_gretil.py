# PRIOR ART: scripts/eval/typed-editions (#5935) scores against typed editions in the same script; this scores a Malayalam-script read against an IAST reference, so it transliterates first. One-off for this experiment.
import sys, re, unicodedata
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein
from rapidfuzz import fuzz
ref_raw = open(sys.argv[1]).read().split('# Text',1)[1]
def norm(t):
    t = unicodedata.normalize('NFC', t).lower()
    t = re.sub(r"[0-9\-'’`.\s|,;:()\[\]^*/_]|sk_\d+", '', t)
    t = re.sub(r'r([kgcjṭḍtdpbm])\1', r'r\1', t)        # scribal gemination after r
    t = re.sub(r'(?:ṃ|ṅ|ñ|ṇ)(?=[kgcjṭḍtdpb])', 'm', t)   # nasal before stop
    t = t.replace('ṃ', 'm')
    return t
ref = norm(ref_raw)
for f in sys.argv[2:]:
    txt = open(f).read()
    txt = re.sub(r'<[^>]+>', ' ', txt)
    mal = ''.join(ch for ch in txt if 'ഀ' <= ch <= 'ൿ' or ch.isspace())
    iast = s.transliterate(mal, s.MALAYALAM, s.IAST)
    h = norm(iast)
    if len(h) < 20: print(f, 'too short', len(h)); continue
    al = fuzz.partial_ratio_alignment(h, ref)
    seg = ref[max(0, al.dest_start-20):al.dest_end+20]
    # best local window by Levenshtein
    best = min(((Levenshtein.distance(h, ref[i:i+len(h)]), i) for i in range(max(0, al.dest_start-200), min(len(ref), al.dest_start+200))), default=(None,0))
    d, i = best
    print(f.split('/')[-1], 'chars', len(h), 'CER vs GRETIL', round(d/len(h), 3), 'at ref pos', i)
    print('  OCR :', iast[:300].replace('\n',' / '))
    print('  REF :', ref[i:i+160])
