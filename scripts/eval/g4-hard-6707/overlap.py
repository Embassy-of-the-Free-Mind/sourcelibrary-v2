# PRIOR ART: none — a word-trigram check of a Syriac read against its ground truth, used for the worst-page reads (O3 canonical substitution).
import json,re,sys,unicodedata
S='/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'
P=re.compile(r'[ܰ-݊̀-ͯ܀-܍\.\,\:\;\!\?\(\)\[\]«»"\'\-–—…·•]+')
def w(s): return [x for x in P.sub(' ',unicodedata.normalize('NFC',s)).split() if x]
raw={json.loads(l)['uid']:json.loads(l) for l in open(f'{S}/raw/G4L-syr-ms.raw.jsonl')}
for slug in sys.argv[1:]:
    h=w(raw['syriac-gt|'+slug]['text']); g=w(open(f'/root/ocr-bench/syriac-retest/gt-text/{slug}.txt').read())
    G3={tuple(g[i:i+3]) for i in range(len(g)-2)}; H3=[tuple(h[i:i+3]) for i in range(len(h)-2)]
    # per tenth of the hypothesis: share of word trigrams found on the reference
    n=len(H3); parts=[H3[i*n//10:(i+1)*n//10] for i in range(10)]
    print(slug, 'hyp words',len(h),'ref words',len(g),'trigram hit',round(sum(t in G3 for t in H3)/max(1,n),2),'by tenth',[round(sum(t in G3 for t in p)/max(1,len(p)),2) for p in parts])
