#!/usr/bin/env python3
"""Figures for the subtle-body comparison. Inline SVG, CSS-variable fills."""
import json, collections

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'
C = [json.loads(l) for l in open(f'{HERE}/centres.jsonl')]
SYSP = json.load(open(f'{HERE}/probes-body.json'))['systems']
SYS = [s['id'] for s in SYSP]
LAB = {s['id']: s['label'] for s in SYSP}
SHORT = {'hindu_tantra':'Hindu tantra','kundalini_yoga':'Yogic channels','tibetan_tantra':'Tibetan tantra',
 'sufi_lataif':'Sufi laṭāʾif','daoist_neidan':'Daoist neidan','kabbalah_body':'Kabbalah',
 'theosophical':'Theosophical','hesychast':'Hesychast','boehme_western':'Böhme / Western',
 'chinese_medicine':'Channel medicine'}
CORE = ['above-crown','crown','brow','eyes','ears','back-of-head','throat','heart',
        'solar-plexus','stomach','navel','lower-abdomen','genitals','perineum-base']
NICE = {'above-crown':'above the crown','crown':'crown','brow':'brow','eyes':'eyes','ears':'ears',
 'back-of-head':'back of head','throat':'throat','heart':'heart','solar-plexus':'solar plexus',
 'stomach':'stomach','navel':'navel','lower-abdomen':'lower abdomen','genitals':'genitals',
 'perineum-base':'base / perineum'}

esc = lambda s: str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
INK, MUTE, GRID = 'var(--fig-ink)', 'var(--fig-mute)', 'var(--fig-grid)'
S1, S2, S3, S4 = 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'

def frame(w, h, body, title=''):
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{esc(title)}" '
            f'style="max-width:100%;height:auto;font-family:var(--ff-ui);font-size:11px">{body}</svg>')
def txt(x,y,s,fill=INK,anchor='start',size=11,weight='400',ls='0',op=1):
    return (f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" text-anchor="{anchor}" font-size="{size}" '
            f'font-weight="{weight}" letter-spacing="{ls}" opacity="{op}">{esc(s)}</text>')
def rect(x,y,w,h,fill,op=1,rx=0):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0,w):.1f}" height="{max(0,h):.1f}" fill="{fill}" opacity="{op}" rx="{rx}"/>'

FIG = {}

# ---------------------------------------------------------------- A: alignment grid
def fig_align():
    tot = {s: sum(1 for r in C if r['system']==s and r['location'] in CORE) or 1 for s in SYS}
    cell, PAD_L, TOP = 62, 132, 96
    w = PAD_L + cell*len(SYS) + 74
    h = TOP + 26*len(CORE) + 40
    b = [txt(0,14,'WHERE EACH TRADITION PUTS ITS CENTRES',MUTE,size=10.5,ls='.12em',weight='600'),
         txt(0,30,'share of that system’s located centres, by body locus. Circle area ∝ share.',MUTE,size=10)]
    for i,s in enumerate(SYS):
        x = PAD_L + i*cell + cell/2
        b.append(f'<g transform="translate({x:.1f},{TOP-10}) rotate(-42)">'+txt(0,0,SHORT[s],INK,anchor='start',size=10.5)+'</g>')
    for j,loc in enumerate(CORE):
        y = TOP + j*26
        b.append(rect(PAD_L-4, y-9, cell*len(SYS)+8, 22, GRID, .16 if j%2 else 0))
        b.append(txt(PAD_L-12, y+5, NICE[loc], INK, anchor='end', size=11))
        present = 0
        for i,s in enumerate(SYS):
            n = sum(1 for r in C if r['system']==s and r['location']==loc)
            share = 100*n/tot[s]
            if share >= 3: present += 1
            if n:
                rad = max(1.6, (share ** .5) * 2.4)
                col = S1 if s != 'chinese_medicine' else S3
                b.append(f'<circle cx="{PAD_L+i*cell+cell/2:.1f}" cy="{y:.1f}" r="{min(rad,11):.1f}" fill="{col}" opacity=".72"/>')
        b.append(txt(PAD_L+cell*len(SYS)+10, y+5, f'{present}/10', MUTE if present<8 else INK, size=10.5,
                     weight='600' if present>=8 else '400'))
    b.append(txt(PAD_L+cell*len(SYS)+10, TOP-14, 'systems', MUTE, size=9.5, ls='.1em'))
    b.append(txt(0, h-14, 'Pink column is the control: channel-and-point medicine maps the same body for treatment, not for ascent.', MUTE, size=10))
    return frame(w,h,''.join(b),'Body loci by tradition')

# ---------------------------------------------------------------- B: felt vs imagined
def fig_felt():
    rows=[]
    for loc in CORE:
        sub=[r for r in C if r['location']==loc]
        if len(sub)<25: continue
        e=100*sum(1 for r in sub if r['fn']=='experiential')/len(sub)
        ri=100*sum(1 for r in sub if r['fn']=='ritual')/len(sub)
        rows.append((loc,len(sub),e,ri))
    rows.sort(key=lambda r:-(r[2]-r[3]))
    PAD_C, LH, w = 300, 27, 720
    h = 74 + LH*len(rows) + 20
    sc = 3.2
    b=[txt(0,14,'FELT, OR IMAGINED?',MUTE,size=10.5,ls='.12em',weight='600'),
       txt(0,30,'at each locus, the share of records where the source reports something PERCEIVED there,',MUTE,size=10),
       txt(0,44,'against the share where something is VISUALISED or RECITED there',MUTE,size=10)]
    b.append(txt(PAD_C-6,62,'← visualised / recited',MUTE,anchor='end',size=10))
    b.append(txt(PAD_C+6,62,'perceived →',MUTE,size=10))
    b.append(f'<line x1="{PAD_C}" y1="68" x2="{PAD_C}" y2="{h-24}" stroke="{GRID}" stroke-width="1"/>')
    for i,(loc,n,e,ri) in enumerate(rows):
        y=74+i*LH
        b.append(txt(8,y+13,NICE[loc],INK,size=11.5))
        b.append(txt(PAD_C-ri*sc-8,y+13,f'{ri:.0f}%',MUTE,anchor='end',size=10))
        b.append(rect(PAD_C-ri*sc,y+3,ri*sc,14,S4,.85))
        b.append(rect(PAD_C,y+3,e*sc,14,S1,.85))
        b.append(txt(PAD_C+e*sc+8,y+13,f'{e:.0f}%',INK,size=10))
        b.append(txt(w-6,y+13,str(n),MUTE,anchor='end',size=9.5))
    b.append(txt(0,h-6,'The heart is felt. The crown, the navel and the base are largely imagined.',MUTE,size=10.5))
    return frame(w,h,''.join(b),'Experiential versus ritual records by locus')

# ---------------------------------------------------------------- C: how many centres
def fig_counts():
    w, PAD_L, LH = 720, 168, 30
    rows=[]
    for s in SYS:
        t=collections.Counter(r['total_in_system'] for r in C if r['system']==s
                              and r['total_in_system'] and 1 <= r['total_in_system'] <= 24)
        if t: rows.append((s,t))
    h = 66 + LH*len(rows) + 24
    lo, hi = 1, 24
    sc = (w - PAD_L - 60)/(hi-lo)
    b=[txt(0,14,'HOW MANY CENTRES DOES THE SYSTEM HAVE?',MUTE,size=10.5,ls='.12em',weight='600'),
       txt(0,30,'every count stated in the sources; dot area ∝ how often that count is asserted',MUTE,size=10)]
    for v in range(2,25,2):
        x=PAD_L+(v-lo)*sc
        b.append(f'<line x1="{x:.1f}" y1="46" x2="{x:.1f}" y2="{h-26}" stroke="{GRID}" stroke-width="1" opacity=".5"/>')
        b.append(txt(x,42,str(v),MUTE,anchor='middle',size=9.5))
    for i,(s,t) in enumerate(rows):
        y=66+i*LH
        b.append(txt(PAD_L-12,y+4,SHORT[s],INK,anchor='end',size=11.5))
        mx=max(t.values())
        for v,n in t.items():
            x=PAD_L+(v-lo)*sc
            r=max(2.2,(n/mx)**.5*9)
            b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{S1}" opacity=".7"/>')
        top=max(t.items(), key=lambda kv: kv[1])
        b.append(txt(w-6,y+4,f'modal {top[0]}',MUTE,anchor='end',size=10))
    b.append(txt(0,h-8,'“Seven chakras” is not what the classical sources say: the modal Hindu tantric count is six.',MUTE,size=10.5))
    return frame(w,h,''.join(b),'Stated number of centres per system')

# ---------------------------------------------------------------- D: colour
def fig_colour():
    RB={'perineum-base':'red','lower-abdomen':'orange','navel':'yellow','solar-plexus':'yellow',
        'heart':'green','throat':'blue','brow':'indigo','crown':'violet'}
    SWATCH={'red':'#c0392b','crimson':'#a02040','orange':'#d2691e','yellow':'#d4a017','gold':'#c9a86c',
            'green':'#3a7d44','blue':'#2a6fb0','indigo':'#4b3f9e','violet':'#7c5db5','white':'#f2efe6',
            'black':'#2b2b2b','smoke':'#8a8480'}
    def norm(c):
        c=(c or '').lower()
        for k in ['crimson','red','orange','yellow','gold','green','blue','indigo','violet','purple','white','black','smoke']:
            if k in c: return 'violet' if k=='purple' else k
        return None
    order=['crown','brow','throat','heart','navel','lower-abdomen','perineum-base']
    w, PAD_L, LH = 720, 150, 40
    h = 70 + LH*len(order) + 30
    b=[txt(0,14,'WHAT COLOUR IS EACH CENTRE?',MUTE,size=10.5,ls='.12em',weight='600'),
       txt(0,30,'every colour the sources actually assign, with the modern rainbow scheme marked for comparison',MUTE,size=10)]
    b.append(txt(PAD_L,52,'colours assigned in the sources →',MUTE,size=9.5))
    b.append(txt(w-6,52,'modern scheme',MUTE,anchor='end',size=9.5))
    for i,loc in enumerate(order):
        y=70+i*LH
        cc=collections.Counter(norm(r['colour']) for r in C if r['location']==loc and norm(r['colour']))
        b.append(txt(PAD_L-12,y+16,NICE[loc],INK,anchor='end',size=11.5))
        x=PAD_L
        tot=sum(cc.values()) or 1
        for col,n in cc.most_common(8):
            wd=max(14,(n/tot)*250)
            b.append(rect(x,y+4,wd-3,20,SWATCH.get(col,'#999')))
            if wd>34: b.append(txt(x+4,y+18,f'{col} {n}','#111' if col in ('white','gold','yellow') else '#fff',size=9.5))
            x+=wd
        exp=RB.get(loc)
        if exp:
            b.append(rect(w-96,y+4,20,20,SWATCH.get(exp,'#999')))
            b.append(txt(w-70,y+18,exp,MUTE,size=10))
    b.append(txt(0,h-12,'Only 12% of colour assignments match the modern rainbow — and the rate is identical before and after 1875.',MUTE,size=10.5))
    b.append(txt(0,h-0,'The one real convergence is white at the crown.',MUTE,size=10.5))
    return frame(w,h,''.join(b),'Colours assigned to each centre')

for name,fn in [('align',fig_align),('felt',fig_felt),('counts',fig_counts),('colour',fig_colour)]:
    FIG[name]=fn(); print(f'  {name}: {len(FIG[name])//1024}KB')

# ------------------------------------------------------------------ examples
def clean(s): return ' '.join((s or '').split())
ex=[]
for loc in ['heart','crown','navel','perineum-base','throat','brow']:
    sub=[r for r in C if r['location']==loc and r['fn']=='experiential' and r.get('experience')
         and r.get('book_year')]
    seen=set(); picks=[]
    for r in sub:
        k=(r['system'], (r['experience'] or '')[:30])
        if k in seen: continue
        seen.add(k); picks.append(r)
        if len(picks)>=4: break
    if picks: ex.append({'loc':loc,'nice':NICE[loc],'items':[{
        'system':SHORT[r['system']],'name':r['name'],'experience':clean(r['experience']),
        'book':r['book_title'],'yr':r['book_year'],'lang':r['book_language'],
        'url':f"https://sourcelibrary.org/book/{r.get('slug','')}/page/{r['page_id']}" if r.get('slug') else None,
        'page_id':r['page_id'],'book_id':r['book_id']} for r in picks]})

tables={
 'function_mix':[[SHORT[s]]+[round(100*sum(1 for r in C if r['system']==s and r['fn']==f)/max(1,sum(1 for r in C if r['system']==s)))
                 for f in ['experiential','ritual','physiological','cosmological','therapeutic']] for s in SYS],
 'records':[[SHORT[s], sum(1 for r in C if r['system']==s), len({r['book_id'] for r in C if r['system']==s})] for s in SYS],
}
json.dump({'figures':FIG,'examples':ex,'tables':tables,
           'totals':{'records':len(C),'books':len({r['book_id'] for r in C}),'systems':len(SYS)}},
          open(f'{HERE}/body-assets.json','w'))
print(f"\n{len(C)} records, {len({r['book_id'] for r in C})} books, {sum(len(g['items']) for g in ex)} examples")
