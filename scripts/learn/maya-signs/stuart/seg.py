import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
D=sys.argv[1]; DIL=int(sys.argv[2]) if len(sys.argv)>2 else 11
CONS=[["'","b'","ch","ch'"],["h","j","k","k'"],["l","m","n","p"],["s","t","t'","tz"],["tz'","w","x","y"]]
VOW="aeiou"
ROWS={0:[40,253,464,677,887,1097],1:[49,261,474,685,895,1105],2:[46,258,469,682,892,1101],3:[48,260,471,683,893,1103],4:[49,261,473,685,896,1106]}
COLS={0:[56,404,716,1062,1445],1:[52,401,712,1058,1441],2:[50,398,710,1056,1438],3:[46,394,705,1052,1434],4:[59,407,719,1065,1447]}
cells=[]
for p in range(5):
    im=Image.open(f'{D}/raw-00{p}.jpg').convert('L'); a=np.array(im)
    sheet=im.convert('RGB'); dr=ImageDraw.Draw(sheet)
    for r in range(5):
        for c in range(4):
            x0,x1=COLS[p][c]+7,COLS[p][c+1]-7; y0,y1=ROWS[p][r]+7,ROWS[p][r+1]-7
            sub=a[y0:y1,x0:x1]<110
            sub=ndi.binary_opening(sub,np.ones((2,2)))  # kill jpeg speckle
            lab,n=ndi.label(ndi.binary_dilation(sub,iterations=DIL))
            groups=[]
            for k,sl in enumerate(ndi.find_objects(lab)):
                m=(lab[sl]==k+1)&sub[sl]
                ink=int(m.sum())
                if ink<40: continue
                ys,xs=np.nonzero(m)
                bx=[int(sl[1].start+xs.min()+x0),int(sl[0].start+ys.min()+y0),int(sl[1].start+xs.max()+x0),int(sl[0].start+ys.max()+y0)]
                groups.append({'box':bx,'ink':ink})
            groups.sort(key=lambda g:(g['box'][1]//60,g['box'][0]))
            syl=(CONS[p][c].replace("'","") if c or p else '')+VOW[r] if CONS[p][c]!="'" else VOW[r]
            syl=(CONS[p][c]+VOW[r]) if CONS[p][c]!="'" else VOW[r]
            cells.append({'page':p+2,'img':f'raw-00{p}.jpg','consonant':CONS[p][c],'vowel':VOW[r],'syllable':syl,'cell':[x0,y0,x1,y1],'groups':groups})
            for i,g in enumerate(groups):
                dr.rectangle(g['box'],outline=(255,0,0),width=2); dr.text((g['box'][0],g['box'][1]-12),f"{syl}.{i+1}",fill=(0,0,255))
    sheet.save(f'{D}/seg-{p}.png')
json.dump(cells,open(f'{D}/cells.json','w'),indent=1,ensure_ascii=False)
print(sum(len(c['groups']) for c in cells),'groups;', sum(1 for c in cells if not c['groups']),'empty cells')
