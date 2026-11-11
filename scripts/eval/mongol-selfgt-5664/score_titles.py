# PRIOR ART: scripts/eval/mongol-synth-5664/judge.mjs judges reads by meaning; this scores Opus's titles by word overlap against rKTs.
import json,re,random,unicodedata
from collections import Counter
items=[json.loads(l) for l in open('items.jsonl')]; O=json.load(open('opus.json'))
C={}
for chs,k in [('ᠠᠡᠨ','A'),('ᠣᠤᠥᠦᠸ','O'),('ᠲᠳ','T'),('ᠬᠭᠺᠻᠾ','Q'),('ᠵᠶᠽ','J'),('ᠪᠫᠹ','B'),('ᠢᠧ','I'),('ᠰᠱ','S'),('ᠴᠼ','C')]:
  for ch in chs: C[ch]=k
C.update({'ᠩ':'AQ','ᠮ':'M','ᠯ':'L','ᠷ':'R'})
def uwords(t):
  t=re.sub('[᠋-᠏‌‍]','',t).replace(' ',' ')
  return [w for w in re.split(r'[\s᠀-᠅᠈᠉]+',t) if w and all('ᠠ'<=c<='ᡂ' for c in w)]
def key(w): return ''.join(C.get(c,'?') for c in w)
def lwords(t):
  t=unicodedata.normalize('NFC',t.lower()).replace('ǰ','j').replace('č','c').replace('š','s').replace('ā','a').replace('ī','i').replace('ū','u')
  return [w for w in re.split(r"[\s\-'’()\[\].,]+",t) if w]
def lkey(w):
  w=w.replace('ng','N')
  m=str.maketrans({'e':'a','n':'a','u':'o','ö':'o','ü':'o','w':'o','v':'o','d':'t','γ':'k','q':'k','g':'k','h':'k','y':'j','p':'b','f':'b','c':'c','z':'j'})
  return w.translate(m)
def rec(ref,out):
  r=Counter(ref); o=Counter(out); hit=sum((r&o).values())
  return hit/max(1,sum(r.values())), hit/max(1,sum(o.values()))
def arms(i,j):
  it=items[i]; o=O.get(items[j]['k'],{})
  ru=uwords(it['ref']); ou=uwords(o.get('script',''))
  rl=lwords(it['ref_lat']); ol=lwords(o.get('translit',''))
  return {'uni_exact':rec(ru,ou),'uni_shape':rec([key(w) for w in ru],[key(w) for w in ou]),
          'lat_exact':rec(rl,ol),'lat_shape':rec([lkey(w) for w in rl],[lkey(w) for w in ol])}
def agg(pairs):
  A={}
  for i,j in pairs:
    for k,(r,p) in arms(i,j).items(): A.setdefault(k,[]).append((r,p))
  return {k:(sum(r for r,_ in v)/len(v), sum(p for _,p in v)/len(v)) for k,v in A.items()}
n=len(items); real=agg([(i,i) for i in range(n)])
ctl=[]
for s in range(20):
  random.seed(s); p=list(range(n))
  while any(p[i]==i for i in range(n)): random.shuffle(p)
  ctl.append(agg([(i,p[i]) for i in range(n)]))
ctrl={k:(sum(c[k][0] for c in ctl)/20, sum(c[k][1] for c in ctl)/20) for k in real}
print(f'{"metric":10} {"recall":>7} {"prec":>6} | ctrl recall prec')
for k in real: print(f'{k:10} {real[k][0]:7.2f} {real[k][1]:6.2f} | {ctrl[k][0]:5.2f} {ctrl[k][1]:5.2f}')
# exclude formula words: content-only recall on translit
F={'qutug','tu','neretu','yeke','kolgen','sudur','tarni','yin','un','u','ün','yi','i','in','ner','e','tü','bolai','kemegdekü','kemegdekui','ilaju','tegus','nogcigsen'}
def content(ws): return [w for w in ws if w not in F and len(w)>2]
cr=[];cc=[]
for i in range(n):
  rl=content(lwords(items[i]['ref_lat'])); 
  if not rl: continue
  cr.append(rec([lkey(w) for w in rl],[lkey(w) for w in content(lwords(O[items[i]['k']]['translit']))])[0])
  j=(i+7)%n; cc.append(rec([lkey(w) for w in rl],[lkey(w) for w in content(lwords(O[items[j]['k']]['translit']))])[0])
print('content-word lat_shape recall', round(sum(cr)/len(cr),2), 'ctrl', round(sum(cc)/len(cc),2), 'n',len(cr))
perm=[round(arms(i,i)['lat_exact'][0],2) for i in range(n)]
print('per-text lat_exact recall', sorted(perm))
print('texts >=0.5 lat_exact', sum(x>=.5 for x in perm), 'uni_shape>=.5', sum(arms(i,i)['uni_shape'][0]>=.5 for i in range(n)))
json.dump({'real':real,'ctrl':ctrl},open('score.json','w'),indent=1)
