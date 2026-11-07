# PRIOR ART: none — joins scripts/eval/judge-compare-7611 adjudications to live pages; looked in scripts/eval/judge-compare-7611/run.mjs (no translation join) (#7611)
import sys
import json,gzip,unicodedata
from collections import Counter
S=sys.argv[1].rstrip('/')+'/'
base='scripts/eval/judge-compare-7611/results/'
it={i['id']:i for i in json.load(open(base+'2026-10-30/items.json'))}
T=json.load(gzip.open('/data/scratch/sl/jobs/flash-judge-tier-7611/jc/texts.json.gz'))
L=json.load(gzip.open(S+'live.json.gz')); R=json.load(gzip.open(S+'revs.json.gz'))
rows=[]
for d in ['2026-10-30','2026-11-01']:
  for l in gzip.open(base+d+'/adjudications.jsonl.gz'):
    r=json.loads(l); r['_d']=d; rows.append(r)
def stratum(i):
  l,a=i['lang'],i['author']
  if l in('Chinese','Classical Chinese'): return 'Chinese '+('GPU' if a.startswith('GPU') else 'GEM')
  if l=='Tibetan': return 'Tibetan GPU'
  if l=='Latin' and a.startswith('GPU'): return 'Latin GPU>GEM'
  if l in('Latin','German','French') : return 'Latin/German/French GEM'
  return l
def cls(c):
  return c
N=lambda s: unicodedata.normalize('NFC',s or '')
pages={}
for r in rows:
  if not r.get('adj'): continue
  i=it.get(r['id'])
  if not i or i['set']!='real' or i['task']=='translation': continue
  ds=[d for d in r['adj'].get('real_defects',[]) if d.get('matters')]
  if not ds: continue
  P=pages.setdefault(r['id'],{'item':i,'defects':{},'notes':[]})
  P['notes'].append({'judge':r['judge'],'note':r['adj'].get('note'),'adj_accept':r['adj'].get('accept')})
  for d in ds:
    P['defects'].setdefault(d['quote'],{**d,'judges':[]})['judges'].append(r['judge'])
out=[]
for iid,P in pages.items():
  i=P['item']; lp=L[i['page_id']]['page']; tr=lp.get('translation') or {}
  judged=N(T[iid]['text']); live=N((lp.get('ocr') or {}).get('data'))
  tdate=tr.get('updated_at') if tr.get('data') else None
  src=None
  if tdate:
    later=[x for x in R[i['page_id']] if x['field']=='ocr' and x['created_at']>tdate]
    src=N(later[0]['data']) if later else live
  if not tdate: prov='no translation'
  elif src.strip()==judged.strip(): prov='same'
  else: prov='different transcription'
  rec={'id':iid,'page_id':i['page_id'],'book_id':i['book_id'],'page_number':i['page_number'],'image_url':i['image_url'],'lang':i['lang'],'author':i['author'],'cell':i['cell'],'stratum':stratum(i),'opus_accept':i.get('opus_accept'),
       'provenance':prov,'withheld':bool(lp.get('translation_withheld')),'health_blocked':bool(tr.get('health_blocked')),'translation_model':tr.get('model'),'translation_at':tdate,'ocr_at':(lp.get('ocr') or {}).get('updated_at'),
       'notes':P['notes'],'judged_text':judged,'source_text':src,'english':tr.get('data'),'defects':[]}
  for q,d in P['defects'].items():
    qn=N(q)
    rec['defects'].append({'quote':q,'class':d['class'],'from':d['from'],'judges':d['judges'],'in_judged':qn in judged,'in_source':(qn in src) if src else None})
  out.append(rec)
json.dump(out,open(S+'pages.json','w'),ensure_ascii=False)
D=[(p,d) for p in out for d in p['defects']]
print('pages',len(out),'defects',len(D),'opus-passed pages',sum(p['opus_accept'] for p in out),'defects on opus-passed',sum(p['opus_accept'] for p,d in D))
print(Counter(p['provenance'] for p in out))
print(Counter((p['provenance'],d['in_source']) for p,d in D))
print(Counter((p['stratum'],p['provenance']) for p in out))
print('withheld',Counter((p['withheld'],p['provenance']) for p in out))
print('in_judged false',sum(not d['in_judged'] for p,d in D))
