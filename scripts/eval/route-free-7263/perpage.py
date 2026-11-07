# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill_all.py — it rebuilds k/n aggregates, not per-page rows across tests;
# scripts/eval/route-judge-6740/paired-arm.mjs — scores one test dir, not every test on file. Loaders written by job route-free-analyses-7263 (#7263).
"""Helper: route-judge-6740 result dir -> rows (book,page,cell,route,accept,wrong_text,fidelity). Used by perpage-manifest loaders."""
import json,gzip,os
R=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
def _load(p):
    if not os.path.exists(p) and os.path.exists(p+'.gz'): p+='.gz'
    op=gzip.open if p.endswith('.gz') else open
    t=op(p,'rt').read()
    return [json.loads(l) for l in t.splitlines() if l.strip()] if '.jsonl' in p else json.loads(t)
def rows(d,suf='',kinds=('item',)):
    d=R+'route-judge-6740/results/'+d+'/'
    k=_load(d+'key%s.json'%suf); v={x['id']:x['verdict'] for x in _load(d+'verdicts-opus%s.jsonl'%suf) if x.get('verdict')}
    out=[]
    for x in k:
        if x['kind'] not in kinds: continue
        ver=v.get(x['judged_as'])
        if ver is None: out.append(dict(book=x['book_id'],page=x.get('page_number'),cell=x['cell'],route=x['route'],accept=None,wrong_text=None,fidelity=None));continue
        wt=any(df.get('severity')=='wrong_text' for df in ver.get('defects') or [])
        out.append(dict(book=x['book_id'],page=x.get('page_number'),cell=x['cell'],route=x['route'],accept=ver['accept'],wrong_text=wt,fidelity=ver.get('fidelity')))
    return out

# ---- additional loaders (all return list of dict(book,page,route,accept,wrong_text,+extras)) ----
def _row(book,page,route,accept,wt,**kw): return dict(book=book,page=page,route=route,accept=accept,wrong_text=wt,**kw)
def _wt(ver): return any(d.get('severity')=='wrong_text' for d in (ver or {}).get('defects') or [])
def lane_accept():
    d=R+'route-judge-6740/results/lane-accept-7263-2026-10-28/'
    s={p['page_id']:p for p in _load(d+'sample.json.gz')['pages']}
    return [_row(s[v['page_id']]['book_id'],s[v['page_id']]['page_number'],'lane-served:'+s[v['page_id']]['outcome'],v['verdict']['accept'],_wt(v['verdict']),lang=s[v['page_id']]['lang']) for v in _load(d+'verdicts-opus.jsonl.gz') if v.get('verdict') and v['page_id'] in s]
def keyed(path,suf=''):
    """route-judge-shaped dir outside results/ (read-surface confirm*)."""
    k=_load(path+'key.json'); v={x['id']:x['verdict'] for x in _load(path+'verdicts-opus.jsonl.gz') if x.get('verdict')}
    return [_row(x['book_id'],x.get('page_number'),x['route'],v[x['judged_as']]['accept'],_wt(v[x['judged_as']]),cell=x['cell']) for x in k if x['kind']=='item' and x['judged_as'] in v]
def read_surface(sub): return keyed(R+'read-surface-6740/%s/'%sub)
def eu_agy():
    d=R+'eu-agy-translate-7263/results/'; plan=_load(d+'plan.json')['langs']
    sel={}
    for l,v in plan.items():
        for s in v['selected']: sel[s['key'] if 'key' in s else None]=s
    out=[]
    for v in _load(d+'verdicts.jsonl.gz'):
        if v.get('set')!='abs' or not v.get('verdict'): continue
        s=sel.get(v['key'],{}); out.append(_row(v['key'].split('-',1)[1],s.get('page_number'),{'a':'agy-flash-low@4','r':'flash-lite'}[v['arms'][0]],v['verdict']['accept'],_wt(v['verdict']),lang=v['key'].split('-')[0]))
    return out
def korean():
    pp=_load(R+'korean-cell-7982/results/score.json')['per_page']; out=[]
    for p in pp:
        for r in ('stored','agy-flash-low-read','paddle-vl','qwen3-vl-8b'):
            t=p[r].split()
            if len(t)!=3: out.append(_row(p['book'],p['page_id'],r,None,None,note=p[r])); continue
            a,f,w=t; out.append(_row(p['book'],p['page_id'],r,a=='A',w!='wt0',fidelity=int(f[1:])))
    return out
def cells_6553():
    out=[]
    for r in _load(R+'results/cells-6553-2026-10-25/scored.jsonl'):
        if not r.get('judged') or r.get('leaf')!='text': continue
        for arm,rt in (('lite','lite'),('agy','agy-flash-low-read')):
            a=r.get(arm)
            if a: out.append(_row(r['book_id'],r['page_id'],rt,a['status']=='text' and not a.get('serious'),bool(a.get('serious')) or a['status']=='invented',cell=r['cell_name']))
    return out
def arabic(which):
    f={'mss':'arabic-mss-gate-7341/gate-rows.jsonl','kraus':'kraus-print-7341/kraus-rows.jsonl'}[which]; out=[]
    for r in _load(R+'results/'+f):
        if (r['kind']=='print')!=(which=='kraus'): continue
        for j in ('claude','gemini'):
            u=r['usability_'+j]; out.append(_row(r['work'],r['page'].split('|')[1],r['engine'],u in('USABLE','NOTICEABLE'),u=='MISLEADING',judge=j))
    return out
def latin_served():
    d=R+'spotcheck-latin-5924/results/'; m={(b['book_id'],p['page_number']):p['ocr_model'] for b in _load(d+'spotcheck-draw.json') for p in b['pages']}
    return [_row(v['book_id'],v['page_number'],m[(v['book_id'],v['page_number'])],v['verdict']!='misleading',v['verdict']=='misleading') for v in _load(d+'spotcheck-verdicts.json')]
def step_t(lang):
    out=[]
    for r in _load(R+'flash-reread-5924/results-7568/%s/step-t.json'%lang):
        b,p=r['slug'].rsplit('-p',1)
        for arm,rt in (('L','lite'),('C','lite>opus-correct'),('R','agy-flash-low-read')): out.append(_row(b,int(p),rt,r['V'][arm]!='misleading',r['V'][arm]=='misleading',V=r['V'][arm],lang=lang))
    return out
def tengyur():
    u=_load('/root/ft-code/scripts/maintenance/tengyur-cli-6361/results/byeye/unblinded.json'); out=[]
    for k,v in u.items():
        vol,p=k.split(':')
        for side,rt in (('staged','agy-flash-low@1'),('stored','3flash')): out.append(_row('vol'+vol,int(p),rt,v[side]==0,v[side]>0))
    return out
def siku_tr():
    d=R+'stale-retranslate-6567/'; mp={i['uid']:i for i in _load(d+'pilot-map.json')['items']}; out=[]
    for p in _load(d+'pilot-results.json')['per_page']:
        for side,rt in (('new','agy-flash-low@1'),('old','stored')): m=p['O'][side]['material']; out.append(_row(mp[p['uid']]['book_id'],p['page_id'],rt,m==0,m>0))
    return out
def zh_arms(f='zh-gemini-reocr-7263/results/score-cheap-arms.json'):
    d=_load(R+f); out=[]
    for s,v in d['strata'].items():
        for p in v['per_page']:
            for arm in ('served','P','O','Pu','PFL','PFM','SFL','PSN','SSN'):
                if arm in p: out.append(_row(p['book_id'],p['page_number'],arm,p[arm]['accept'],p[arm]['wrong'],stratum=s,fidelity=p[arm]['fidelity']))
    return out
def router_confirm(f):
    d=_load(R+f); out=[]
    for p in d['per_page']:
        for arm,x in p.items():
            if isinstance(x,dict) and 'accept' in x: out.append(_row(p['book_id'],p['page_number'],arm,x['accept'],x.get('wrong'),fidelity=x.get('fidelity')))
    return out
def sonnet_router():
    out=[]
    for c,rows in _load(R+'results/sonnet-router-7263/verdicts.json').items():
        for p in rows: out.append(_row(p['book_id'],p['page_number'],'sonnet-router:'+c,p['accept'],p['wrong'],cell=c))
    return out
def zh_ditto_restore(f='judge-judge.json'):
    d=_load(R+'results/zh-ditto-restore-5274/'+f); out=[]
    for p in d['pages']:
        for arm,v in p['verdicts'].items():
            wt=any(x.get('material') for x in p['defects'].get(arm,[])) if isinstance(p.get('defects'),dict) else None
            out.append(_row(p['uid'].split('-')[1],int(p['uid'].rsplit('-p',1)[1]),arm,v!='misleading',v=='misleading',verdict=v,set=p['set']))
    return out
def agy_ppc_6740():
    return [_row(r['book_id'],r['page_number'],r['task']+':'+r['arm'],r['accept'],r['wrong_text'],cer=r.get('cer'),judged=r['judged']) for r in _load(R+'agy-ocr-per-call-6740/pages.jsonl.gz')]
def read_surface_cer():
    d=_load(R+'read-surface-6740/results/score.json.gz')['langs']; out=[]
    for l,v in d.items():
        for run in v['runs']:
            for t in run['targets']:
                out.append(_row(t['book_id'],int(t['slug'].rsplit('-p',1)[1]),'%s:%s(ppc%s,edge%s,%s)'%(l,run['id'],run['ppc'],run['edge'],run['think']),None,t.get('wrong_text'),cer=t.get('cer'),status=t['status'],live=run['live']))
    return out
def ppc_7522():
    d=R+'ocr-per-call-7522/results/'; key=_load(d+'key.json'); pg={}
    for b in _load(R+'ocr-per-call-7522/draw.json')['books']:
        for p in b.get('pages',[]): pg[p.get('page_id') or p.get('id')]=(b.get('book_id') or b.get('id'),p.get('page_number'))
    out=[]
    for v in _load(d+'verdicts-opus.jsonl.gz'):
        for L,x in v['verdict']['versions'].items():
            arm=key[v['page_id']].get(L)
            if arm in(None,'CTL'): continue
            out.append(_row(pg.get(v['page_id'],(None,None))[0],v['page_id'],arm,x['usable'],None,**{'omissions':len(x['omissions']),'cross_page_bleed':len(x['cross_page_bleed'])}))
    return out

def ppc_7503():
    d=R+'agy-per-call-7503/'; key=_load(d+'judge-key.json'); out=[]
    ids={}
    for b in _load(d+'draw.json').get('books',[]) if isinstance(_load(d+'draw.json'),dict) else []:
        for p in b.get('pages',[]): ids[p.get('page_id') or p.get('id')]=b.get('book_id') or b.get('id')
    for l in open(d+'judge-verdicts.jsonl'):
        v=json.loads(l)
        for L,x in v['verdict']['versions'].items():
            arm=key[v['page_id']].get(L)
            if arm in (None,'CTL'): continue
            out.append(_row(ids.get(v['page_id']),v['page_id'],arm,x['usable'],None,sense_errors=len(x.get('sense_errors',[]))))
    return out
def judge_compare_repeats():
    d=R+'judge-compare-7611/results/2026-10-30/'; items={i['id']:i for i in _load(d+'items.json')}; out=[]
    for j in ('opus','argon','flash'):
        for v in _load(d+'verdicts-%s-repeat.jsonl.gz'%j):
            i=items[v['id']]; out.append(_row(i['book_id'],i['page_number'],i['route'],(v.get('verdict') or {}).get('accept'),_wt(v.get('verdict')),judge=j,cell=i['cell'],item=v['id']))
    return out
def correction_release():
    d=R+'correction-pass-7818/results/release/'; it={i['id']:i for i in _load(d+'items.json')}
    return [_row(None,v['page'],v['arm']+':'+v['role'],(v.get('verdict') or {}).get('accept'),_wt(v.get('verdict')),rep=v.get('rep'),set=v['set'],lang=v['lang'],id=v['id']) for v in _load(d+'verdicts-opus.jsonl.gz')]

def latin_250():
    F=R+'flash-reread-5924/results/'
    PLAN=[('step-c.json','L','lite',False),('step-c.json','F','agy-flash-low-read',False),('oc-step-c2.json','O','lite>opus-correct',False),('oc-step-c2.json','L','lite',True),('oc-step-c3.json','O','lite>opus-correct',False),('oc-step-c3.json','F','agy-flash-low-read',False),('fc-step-c4.json','FC','lite>agy-flash-low',False),('fc-step-c4.json','L','lite',True),('fc-step-c5.json','FC','lite>agy-flash-low',False),('fc-step-c5.json','O','lite>opus-correct',False)]
    out=[]
    for f,s,rt,skip in PLAN:
        for r in _load(F+f):
            if skip and r.get('shown') is False: continue
            b,p=r['slug'].rsplit('-p',1); mis=r['C_'+s]=='misleading' or bool(r.get('ntl_'+s))
            out.append(_row(b,int(p),rt,not mis,mis,step=f,side=s))
    return out
def ditto_pilot_md():
    import re
    t=open(R+'results/zh-ditto-correct-5274/side-by-side.md').read(); out=[]
    for blk in t.split('\n## ')[1:]:
        h=blk.split('\n',1)[0]; m=re.match(r'(\S+)-p(\d+) — (.*?), (zero|keep)',h); uid,pg=m.group(1),int(m.group(2))
        pc='10' if 'per-call 10' in h else '1'
        for line in blk.splitlines():
            c=[x.strip() for x in line.strip('|').split('|')]
            if line.startswith('|') and len(c)>=5 and c[0] not in('arm','---'):
                out.append(_row(uid.split('-')[-1],pg,c[0],c[4]!='misleading',c[4]=='misleading',verdict=c[4],usable=c[3],per_call=pc,cer=c[2],marks=c[1]))
    return out

FRAKTUR = os.environ.get('FRAKTUR_DIR', '/mnt/HC_Volume_105839809/jobs/fraktur-tests-7835/fraktur-7835/')
def fraktur():
    """#7835 verdicts: one verdict per distinct text; an arms list like ['a','b'] means both arms served that text."""
    v = [json.loads(l) for l in open(FRAKTUR + 'verdicts-opus.jsonl')]
    sel = {}
    for t in ('t1', 't2', 't3'):
        for s in json.load(open(FRAKTUR + t + '/selected.json'))['selected']: sel[(t, s['page_id'])] = s
    out = []
    for x in v:
        if not x.get('verdict') or x['set'] != 'abs' or (x['test'], x['page']) not in sel: continue
        s = sel[(x['test'], x['page'])]
        arms = ['lite'] if x['arms'] == ['litec'] else x['arms']
        if x['arms'] == ['litec']: arms = ['lite', 'c']
        for a in (arms if len(x['arms']) > 1 or x['arms'] == ['litec'] else [''.join(x['arms'])]):
            out.append(_row(s['book_id'], s['page_number'], a, x['verdict']['accept'], _wt(x['verdict']), test=x['test'], face=s.get('face')))
    return out
