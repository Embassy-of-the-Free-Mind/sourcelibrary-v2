import json
HERE='/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'
P=json.load(open(f'{HERE}/pkt-prior.json'))
rows=P['all']; ind={r['pali']:r for r in P['indic']}
esc=lambda s:str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
INK,MUTE,GRID='var(--fig-ink)','var(--fig-mute)','var(--fig-grid)'
S1,S4='var(--s1)','var(--s4)'
def txt(x,y,s,fill=INK,a='start',sz=11,w='400',ls='0'):
    return f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" text-anchor="{a}" font-size="{sz}" font-weight="{w}" letter-spacing="{ls}">{esc(s)}</text>'
def rect(x,y,w,h,f,op=1):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0,w):.1f}" height="{max(0,h):.1f}" fill="{f}" opacity="{op}"/>'
W,PADC,LH=760,332,44
H=104+LH*len(rows)+34
sc=4.2
b=[txt(0,14,'THE HISTORICAL PRIOR FOR EACH CHAKRA',MUTE,sz=10.5,ls='.12em',w='600'),
   txt(0,30,'what the sources DO at each locus, across ten independently reconstructed traditions',MUTE,sz=10)]
b.append(txt(PADC-8,54,'← visualised / recited',MUTE,a='end',sz=10))
b.append(txt(PADC+8,54,'perceived →',MUTE,sz=10))
b.append(txt(W-6,54,'traditions',MUTE,a='end',sz=9.5))
b.append(f'<line x1="{PADC}" y1="62" x2="{PADC}" y2="{H-46}" stroke="{GRID}" stroke-width="1"/>')
for i,r in enumerate(rows):
    y=76+i*LH
    hi = r['pali']=='Anāhata'
    if hi: b.append(rect(0,y-4,W,LH-6,S1,.07))
    b.append(txt(8,y+13,r['pali'],INK,sz=12.5,w='600' if hi else '400'))
    b.append(txt(8,y+27,r['eng']+f"  ·  n={r['n']}",MUTE,sz=9.5))
    b.append(rect(PADC-r['rit']*sc,y+3,r['rit']*sc,15,S4,.85))
    b.append(txt(PADC-r['rit']*sc-6,y+15,f"{r['rit']:.0f}%",MUTE,a='end',sz=9.5))
    b.append(rect(PADC,y+3,r['exp']*sc,15,S1,.9))
    b.append(txt(PADC+r['exp']*sc+6,y+15,f"{r['exp']:.0f}%",INK,sz=10.5,w='600' if hi else '400'))
    # indic-only marker
    iv=ind.get(r['pali'],{}).get('exp',0)
    b.append(f'<line x1="{PADC+iv*sc:.1f}" y1="{y+1}" x2="{PADC+iv*sc:.1f}" y2="{y+20}" stroke="{INK}" stroke-width="1.4" stroke-dasharray="2 2" opacity=".55"/>')
    b.append(txt(W-6,y+9,f"{r['trads']}/10 place it",MUTE,a='end',sz=9.5))
    b.append(txt(W-6,y+22,f"{r['tradsExp']}/10 feel it",INK if r['tradsExp']==10 else MUTE,a='end',sz=9.5,w='600' if r['tradsExp']==10 else '400'))
b.append(f'<line x1="{PADC+40}" y1="{H-30}" x2="{PADC+52}" y2="{H-30}" stroke="{INK}" stroke-width="1.4" stroke-dasharray="2 2" opacity=".55"/>')
b.append(txt(PADC+58,H-26,'dashed rule = experiential rate within Indic sources only (the PKT’s home tradition)',MUTE,sz=9.5))
b.append(txt(0,H-8,'Anāhata is the only locus where all ten traditions — including seven that never inherited the chakra system — report something felt.',MUTE,sz=10.5))
svg=f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Historical prior per chakra" style="max-width:100%;height:auto;font-family:var(--ff-ui);font-size:11px">{"".join(b)}</svg>'
json.dump({'fig':svg,'rows':rows,'indic':P['indic']},open(f'{HERE}/peace-assets.json','w'))
print('ok',len(svg)//1024,'KB')
