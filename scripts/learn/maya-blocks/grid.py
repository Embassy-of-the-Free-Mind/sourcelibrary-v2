"""Cut each drawing panel (panels.json) into its block grid. Usage: grid.py <pm.pdf> <panels.json> <work-dir>
-> <work-dir>/cells.json (one box per block, in PDF points) and <work-dir>/overlays/<panel>.png to check by eye.
Gutters come from the ink profile (DP near equal spacing), unless the panel gives hand-checked xcuts_pt/ycuts_pt;
'extra' adds hand boxes, 'skip' leaves a cell out, 'rename' relabels a column. Zoom = the drawing's native ppi."""
import pymupdf, sys, json, os, numpy as np
from PIL import Image, ImageDraw
PDF, SPEC, WORK = sys.argv[1:4]
d=pymupdf.open(PDF); os.makedirs(f'{WORK}/overlays',exist_ok=True)
def native_zoom(p, clip):
    best=None
    for i in p.get_image_info():
        b=pymupdf.Rect(i['bbox']); 
        if not b.intersects(clip) or b.width<1: continue
        z=i['width']/b.width
        if best is None or (b & clip).get_area()>best[1]: best=(z,(b & clip).get_area())
    return min(max(best[0] if best else 4.0, 2.0), 8.0)
def render(pn, clip, z):
    pix=d[pn-1].get_pixmap(matrix=pymupdf.Matrix(z,z),clip=clip,colorspace=pymupdf.csGRAY)
    return np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width)
def cuts(prof, n, lam=3.0):
    L=len(prof); 
    if n==1: return [0,L]
    k=max(3,L//(n*12)); sm=np.convolve(prof,np.ones(k)/k,'same')
    sm=sm/(sm.max()+1e-9)
    cand=list(range(1,L-1,max(1,L//400)))
    exp=L/n; INF=1e18
    # dp[j][c]= min cost choosing j-th cut at cand c
    prev={0:(0.0,None)}; pos=[0]
    layers=[]
    for j in range(1,n):
        cur={}
        for c in cand:
            if abs(c-j*exp)>0.45*exp: continue
            best=(INF,None)
            for pc,(cost,_) in prev.items():
                w=c-pc
                if w<0.4*exp: continue
                v=cost+sm[c]+lam*((w-exp)/exp)**2
                if v<best[0]: best=(v,pc)
            if best[1] is not None: cur[c]=best
        layers.append(cur); prev=cur
    best=(INF,None)
    for pc,(cost,_) in prev.items():
        v=cost+lam*(((L-pc)-exp)/exp)**2
        if v<best[0]: best=(v,pc)
    out=[L]; c=best[1]
    for lay in reversed(layers):
        out.append(c); c=lay[c][1]
    out.append(0); return sorted(out)
def tight(a, thr=0.02):
    idx=np.where(a>thr)[0]; return (idx[0],idx[-1]+1) if len(idx) else (0,len(a))
specs=json.load(open(SPEC)); outcells=[]
for sp in specs:
    pn=sp['page']; clip=pymupdf.Rect(*sp['clip']); z=sp.get('zoom') or native_zoom(d[pn-1],clip)
    g=render(pn,clip,z); ink=(g<150).astype(float)
    x0,x1=tight(ink.mean(0)); y0,y1=tight(ink.mean(1))
    sub=ink[y0:y1,x0:x1]
    nc,nr=len(sp['cols']),len(sp['rows'])
    xc=sp.get('xcuts_pt'); yc=sp.get('ycuts_pt')
    xs=[round((v-clip.x0)*z)-x0 for v in xc] if xc else cuts(sub.mean(0),nc,sp.get('lam',1.5))
    ys=[round((v-clip.y0)*z)-y0 for v in yc] if yc else cuts(sub.mean(1),nr,sp.get('lam',1.5))
    im=Image.fromarray(g).convert('RGB'); dr=ImageDraw.Draw(im)
    skip=set(sp.get('skip',[]))
    for i,c in enumerate(sp['cols']):
        for j,r in enumerate(sp['rows']):
            coord=sp.get('rename',{}).get(c,f'{c}{r}')
            if coord in skip: continue
            bx=[x0+xs[i],y0+ys[j],x0+xs[i+1],y0+ys[j+1]]
            bpt=[round(clip.x0+bx[0]/z,1),round(clip.y0+bx[1]/z,1),round(clip.x0+bx[2]/z,1),round(clip.y0+bx[3]/z,1)]
            outcells.append(dict(panel=sp['id'],monument=sp['monument'],coord=coord,page=pn,box_pt=bpt,zoom=round(z,3)))
            dr.rectangle(bx,outline=(255,0,0),width=2); dr.text((bx[0]+3,bx[1]+2),coord,fill=(0,0,255))
    for ex in sp.get('extra',[]):  # hand boxes in pt
        b=ex['box_pt']; bx=[(b[0]-clip.x0)*z,(b[1]-clip.y0)*z,(b[2]-clip.x0)*z,(b[3]-clip.y0)*z]
        outcells.append(dict(panel=sp['id'],monument=sp['monument'],coord=ex['coord'],page=pn,box_pt=b,zoom=round(z,3),hand=True))
        dr.rectangle(bx,outline=(0,160,0),width=2); dr.text((bx[0]+3,bx[1]+2),ex['coord'],fill=(0,120,0))
    im.thumbnail((1400,1400)); im.save(f"{WORK}/overlays/{sp['id']}.png")
    print(sp['id'],'zoom',round(z,2),'cells',nc*nr-len(skip)+len(sp.get('extra',[])))
json.dump(outcells,open(f'{WORK}/cells.json','w'),indent=0)
