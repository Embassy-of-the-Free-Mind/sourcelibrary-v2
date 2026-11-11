import sys, random, re
sys.argv=['x', sys.argv[1]]
exec(open(sys.argv[0] if False else '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/97bd19cb-1529-48a1-9f26-d4fea0c31260/scratchpad/score.py').read().split('for f in sys.argv[2:]')[0])
from rapidfuzz.distance import Levenshtein
random.seed(1); out=[]
for trial in range(6):
    i=random.randrange(0,len(ref)-400); s=list(ref[i:i+300]); random.shuffle(s); h=''.join(s)   # same letters, no order
    j=random.randrange(0,len(ref)-400); h2=ref[j:j+300][::-1]                                   # real Sanskrit, wrong text (reversed)
    for hh in (h,h2):
        best=min(Levenshtein.distance(hh, ref[k:k+len(hh)]) for k in range(0,len(ref)-len(hh),3))
        out.append(round(best/len(hh),3))
print('shuffled / reversed-passage CERs:', out)
