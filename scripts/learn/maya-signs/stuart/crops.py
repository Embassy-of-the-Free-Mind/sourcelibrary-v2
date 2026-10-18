import sys, json, hashlib, io
from PIL import Image
D=sys.argv[1]; O=sys.argv[2]
cells=json.load(open(f'{D}/cells-final.json'))
src=hashlib.sha256(open(f'{D}/maya-syllabary-v2.pdf','rb').read()).hexdigest()
for c in cells:
    if c['syllable']=='me': c['uncertain']=2
    c['slug']=c['syllable'].replace("'","_")
    im=Image.open(f"{D}/{c['img']}").convert('L'); out=[]
    for i,b in enumerate(c['variants']):
        cr=im.crop((b[0]-4,b[1]-4,b[2]+5,b[3]+5)); buf=io.BytesIO(); cr.save(buf,'PNG'); data=buf.getvalue()
        h=hashlib.sha256(data).hexdigest(); fn=f"{c['slug']}-{i+1}-{h[:8]}.png"
        open(f'{O}/{fn}','wb').write(data)
        out.append({'n':i+1,'box':b,'file':fn,'sha256':h,'w':cr.size[0],'h':cr.size[1]})
    c['crops']=out
json.dump({'pdf_sha256':src,'cells':cells},open(f'{O}/manifest.json','w'),indent=1,ensure_ascii=False)
print(len(cells),sum(len(c['crops']) for c in cells))
