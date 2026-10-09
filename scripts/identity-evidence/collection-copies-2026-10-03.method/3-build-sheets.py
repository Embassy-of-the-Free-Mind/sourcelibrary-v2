import json,subprocess,io,os,hashlib
from concurrent.futures import ThreadPoolExecutor
from PIL import Image,ImageDraw,ImageFont
m=[o for o in json.load(open('manifest.json')) if len(o['books'])<=4]
H=330
def fetch(u):
    if not u: return None
    if u.startswith('/'): u='https://sourcelibrary.org'+u
    f='img/'+hashlib.md5(u.encode()).hexdigest()+'.jpg'
    if not os.path.exists(f):
        b=subprocess.run(['curl','-sL','--max-time','40',u],capture_output=True).stdout
        try:
            im=Image.open(io.BytesIO(b)).convert('RGB'); im=im.resize((max(1,int(im.width*H/im.height)),H)); im.save(f,quality=80)
        except Exception: return None
    return f
urls=[u for o in m for b in o['books'] for u in (b['cover'],b['mid'])]
with ThreadPoolExecutor(8) as ex: list(ex.map(fetch,urls))
try: font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15); big=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
except Exception: font=big=ImageFont.load_default()
def row(ci,o):
    cells=[]
    for li,b in enumerate(o['books']):
        ims=[]
        for u in (b['cover'],b['mid']):
            f=fetch(u); ims.append(Image.open(f) if f else Image.new('RGB',(230,H),(200,200,200)))
        w=sum(i.width for i in ims)+6; cell=Image.new('RGB',(max(w,330),H+62),'white'); x=0
        for i in ims: cell.paste(i,(x,62)); x+=i.width+6
        d=ImageDraw.Draw(cell); L='ABCD'[li]
        d.text((2,2),f"{L}  {b['provider']} {b['year']}  {b['pages']}pp",fill='black',font=big)
        d.text((2,26),f"OCR {b['ocr_pct']}%  TR {b['tr_pct']}%   mid p{b['mid_page']}",fill=(160,0,0),font=big)
        cells.append(cell)
    W=sum(c.width for c in cells)+20*len(cells); r=Image.new('RGB',(W,H+62+30),(235,235,235)); x=0
    d=ImageDraw.Draw(r); d.text((4,4),f"#{ci}  {o['books'][0]['title']}",fill='black',font=big)
    for c in cells: r.paste(c,(x,30)); x+=c.width+20
    return r
index=[]
PER=3
for s in range(0,len(m),PER):
    rows=[row(ci,m[ci]) for ci in range(s,min(s+PER,len(m)))]
    W=max(r.width for r in rows); img=Image.new('RGB',(W,sum(r.height+10 for r in rows)),'white'); y=0
    for r in rows: img.paste(r,(0,y)); y+=r.height+10
    if img.width>2400: img=img.resize((2400,int(img.height*2400/img.width)))
    n=f'sheets/s{s//PER:03d}.jpg'; img.save(n,quality=78)
    for ci in range(s,min(s+PER,len(m))): index.append({'cluster':ci,'sheet':n,'key':m[ci]['key'],'collections':m[ci]['collections'],'members':{'ABCD'[i]:b for i,b in enumerate(m[ci]['books'])}})
json.dump(index,open('index.json','w'),indent=1)
print(len(m),'clusters',len(os.listdir('sheets')),'sheets', sum(1 for _ in os.listdir('img')),'images')
