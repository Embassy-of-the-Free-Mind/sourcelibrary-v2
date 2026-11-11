import json,numpy as np,collections as C,warnings;warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier as HGB
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score
D=json.load(open('feats2.json'))
# per-language robust z for ratios
for key in ('tr_ratio','chars_per_ink','trchars_per_ink','ocr_chars','tri_ppl','oov_frac'):
    by=C.defaultdict(list)
    for d in D:
        v=d['num'].get(key); 
        if v is not None and v==v: by[d['cat']['lang']].append(np.log1p(v) if key!='tri_ppl' else v)
    for d in D:
        v=d['num'].get(key); a=by[d['cat']['lang']]
        if v is not None and v==v and len(a)>=10:
            x=np.log1p(v) if key!='tri_ppl' else v; med=np.median(a); mad=np.median(np.abs(np.array(a)-med))+1e-6
            d['num']['z_'+key]=(x-med)/mad; d['num']['absz_'+key]=abs((x-med)/mad)
cats=sorted({(k,v) for d in D for k,v in d['cat'].items()}); cnt=C.Counter((k,v) for d in D for k,v in d['cat'].items())
cats=[c for c in cats if cnt[c]>=8]
nums=sorted({k for d in D for k in d['num']})
names=nums+[f'{k}={v}' for k,v in cats]
X=np.array([[d['num'].get(k,np.nan) for k in nums]+[1.0 if d['cat'].get(k)==v else 0.0 for k,v in cats] for d in D],dtype=float)
y=np.array([d['y'] for d in D]); g=[d['book'] for d in D]; cv=GroupKFold(5)
m=lambda:HGB(max_depth=3,learning_rate=0.04,max_iter=400,l2_regularization=2.0,min_samples_leaf=25)
def auc(cols,seeds=3):
    idx=[names.index(c) for c in cols]; s=[]
    for sd in range(seeds):
        perm=np.random.RandomState(sd).permutation(len(y))
        p=np.zeros(len(y)); p[perm]=cross_val_predict(m(),X[perm][:,idx],y[perm],cv=cv,groups=np.array(g)[perm],method='predict_proba')[:,1]; s.append(roc_auc_score(y,p))
    return np.mean(s),p
G={'meta':[n for n in names if n.split('=')[0] in('lang','ocr','script','page-type','scan-quality') or n in('year','pages_count','page_pos','edge_page')],
   'size':[n for n in names if n in('ocr_chars','tr_chars','tr_ratio','ocr_words') or n.startswith(('z_tr_ratio','absz_tr_ratio','z_ocr_chars','absz_ocr_chars'))],
   'repetition':['ocr_zlib','tr_zlib','max_line_repeat','dup_line_frac','max_4gram_repeat','tr_dup_sent','top_word_share','char_entropy','tr_entropy'],
   'garbage':['garbage_cons','garbage_samechar','mixed_alnum','oneletter_frac','latin_letter_frac','in_block'],
   'lexical':[n for n in names if 'oov' in n or 'logfreq' in n or 'tri_ppl' in n],
   'tr_consistency':['num_ocr','num_tr','num_jacc','tr_nonenglish','tr_avg_sent','tr_notes','tr_unclear','caps_ratio'],
   'tags':[n for n in names if n.startswith('tag_')],
   'image':[n for n in names if n.startswith(('img_','chars_per_ink','trchars_per_ink','z_chars','absz_chars','z_trchars','absz_trchars'))]}
allc=[c for v in G.values() for c in v if c in names]
full,pf=auc(allc); print(f'ALL features ({len(allc)}): AUC {full:.3f}')
print('\nalone / drop-group:')
for k,v in G.items():
    v=[c for c in v if c in names]; a,_=auc(v); dd,_=auc([c for c in allc if c not in v]); print(f'  {k:15} n={len(v):2} alone {a:.3f}   all-minus {dd:.3f} (Δ {full-dd:+.3f})')
mm=m().fit(X[:,[names.index(c) for c in allc]],y)
from sklearn.inspection import permutation_importance
pi=permutation_importance(mm,X[:,[names.index(c) for c in allc]],y,n_repeats=5,random_state=0,scoring='roc_auc')
print('\ntop features:'); [print(f'  {allc[i]:28} {pi.importances_mean[i]:.3f}') for i in np.argsort(-pi.importances_mean)[:20]]
o=np.argsort(-pf)
for q in (0.1,0.2,0.3): k=int(len(y)*q); print(f'top {int(q*100)}%: precision {y[o[:k]].mean():.0%}, catches {y[o[:k]].sum()/y.sum():.0%}')
np.save('pf.npy',pf)
# direction of key features
print('\nserious rate by quintile:')
for c in ['tr_ratio','absz_tr_ratio','ocr_zlib','tri_ppl','oov_frac','absz_chars_per_ink','img_aspect','year','in_block','max_4gram_repeat']:
    if c not in names: continue
    v=X[:,names.index(c)]; ok=~np.isnan(v); qs=np.quantile(v[ok],[.2,.4,.6,.8]); b=np.digitize(v[ok],qs)
    print(f'  {c:20}', ' '.join(f'{y[ok][b==i].mean():.0%}' for i in range(5)))
