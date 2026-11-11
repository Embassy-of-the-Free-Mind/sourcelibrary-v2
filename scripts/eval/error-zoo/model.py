import json,glob,re,collections as C,numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score
rows={(r['run'],r['book'],r['page']):r for r in json.load(open('rows.json'))}
X=[];y=[];g=[];meta=[]
TAGS=['margin','sig','image-desc','column-break','columns','warning','unclear','leaf-break','insert','term','gloss','note','header','page-num','meta','vocab']
for f in glob.glob('/root/jobs/spare-audit/spare-audit-2026111*/packets/*.json'):
    run=f.split('/')[4]
    for b in json.load(open(f)):
        for p in b['pages']:
            r=rows.get((run,b['book_id'],int(p['page_number'])))
            if not r: continue
            o=p.get('ocr') or ''; t=p.get('translation') or ''
            body=re.sub(r'<[^>]+>.*?</[^>]+>|<[^>]+>','',o,flags=re.S)
            tag=lambda k:(re.search(f'<{k}>(.*?)</{k}>',o) or [None,'NA'])[1].strip()[:20]
            words=re.findall(r'\w+',body); n=max(1,len(body))
            lines=[l for l in body.split('\n') if l.strip()]
            m=re.search(r'1[0-9]{3}',str(b['book'].get('published')))
            d={'lang='+str(r['lang']):1,'ocr='+str(r['ocr_model']):1,'script='+tag('script'):1,'ptype='+tag('page-type'):1,'scan='+tag('scan-quality'):1,
               'century':int(m.group()[:2]) if m else -1,'year_missing':0 if m else 1,
               'ocr_len':len(body),'tr_len':len(t),'tr_ratio':len(t)/n,'lines':len(lines),
               'avg_line':np.mean([len(l) for l in lines]) if lines else 0,
               'nonascii':sum(ord(c)>127 for c in body)/n,'digits':sum(c.isdigit() for c in body)/n,
               'punct':sum(c in '.,;:' for c in body)/n,'upper':sum(c.isupper() for c in body)/n,
               'uniq_words':len(set(words))/max(1,len(words)),'short_words':sum(len(w)<=2 for w in words)/max(1,len(words)),
               'long_words':sum(len(w)>=12 for w in words)/max(1,len(words)),
               'brackets':body.count('[')/n*1000,'qmarks':body.count('?')/n*1000,'ellipsis':(body.count('...')+body.count('…'))/n*1000,
               'tr_brackets':t.count('[')/max(1,len(t))*1000,'tr_unclear':len(re.findall(r'illegible|unclear|uncertain|\[\?',t,re.I)),
               'rep3':len(words)-len(set(zip(words,words[1:],words[2:]))) if len(words)>3 else 0,
               'book_pages':b['book'].get('pages_count') or 0,'page_pos':int(p['page_number'])/max(1,b['book'].get('pages_count') or 1)}
            for k in TAGS: d['tag_'+k]=len(re.findall(f'<{k}[ >/]',o))
            X.append(d);y.append(int(r['serious']));g.append(b['book_id']);meta.append(r)
y=np.array(y);dv=DictVectorizer(sparse=False);Xm=dv.fit_transform(X)
print('pages',len(y),'serious rate',y.mean().round(3))
cv=GroupKFold(5)
gb=HistGradientBoostingClassifier(max_depth=3,learning_rate=0.05,max_iter=300,l2_regularization=1.0)
p=cross_val_predict(gb,Xm,y,cv=cv,groups=g,method='predict_proba')[:,1]
print('GBM all features AUC',round(roc_auc_score(y,p),3))
# baseline: metadata only
mi=[i for i,f in enumerate(dv.feature_names_) if f.split('=')[0] in('lang','ocr','script','ptype','scan','century','year_missing')]
pb=cross_val_predict(gb,Xm[:,mi],y,cv=cv,groups=g,method='predict_proba')[:,1]
print('GBM metadata-only AUC',round(roc_auc_score(y,pb),3))
# precision at top deciles
o=np.argsort(-p)
for q in (0.1,0.2,0.3,0.5):
    k=int(len(y)*q); print(f'top {int(q*100)}% flagged: precision {y[o[:k]].mean():.0%}, catches {y[o[:k]].sum()/y.sum():.0%} of serious')
# feature importance via permutation
from sklearn.inspection import permutation_importance
gb.fit(Xm,y); pi=permutation_importance(gb,Xm,y,n_repeats=5,random_state=0,scoring='roc_auc')
for i in np.argsort(-pi.importances_mean)[:15]: print(f'  {dv.feature_names_[i]:40} {pi.importances_mean[i]:.3f}')
pg_=p.copy()
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import make_pipeline
texts=[]
for f in glob.glob('/root/jobs/spare-audit/spare-audit-2026111*/packets/*.json'):
    run=f.split('/')[4]
    for b in json.load(open(f)):
        for p in b['pages']:
            if (run,b['book_id'],int(p['page_number'])) in rows: texts.append((p.get('ocr') or '')[:4000]+' ||| '+(p.get('translation') or '')[:3000])
lr=make_pipeline(TfidfVectorizer(analyzer='char_wb',ngram_range=(2,4),min_df=3,max_features=60000,sublinear_tf=True),LogisticRegression(C=2,max_iter=2000))
pt=cross_val_predict(lr,texts,y,cv=cv,groups=g,method='predict_proba')[:,1]
print('char-ngram LR AUC',round(roc_auc_score(y,pt),3),' blend AUC',round(roc_auc_score(y,(pg_+pt)/2),3))
pbl=(pg_+pt)/2;o=np.argsort(-pbl)
for q in (0.1,0.2,0.3):
    k=int(len(y)*q); print(f'blend top {int(q*100)}%: precision {y[o[:k]].mean():.0%}, catches {y[o[:k]].sum()/y.sum():.0%}')
