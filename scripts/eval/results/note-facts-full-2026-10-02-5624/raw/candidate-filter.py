import json,re,sys
CUE=r'(century|\b1[0-9]{3}\b|founder|founded|author|composed|disciple|teacher|student of|king|emperor|monastery|identified|refers to|known as|i\.e\.|is the|was a|lineage|tradition of|translated by|translator|attributed|Tibetan name|Sanskrit|father|mother|son of|born)'
def cands(path, cutoff=None):
    out=[];notes_tot=0;pages=0;maxat=''
    for l in open(path):
        p=json.loads(l)
        if cutoff and p['at']>cutoff: continue
        pages+=1; maxat=max(maxat,p['at'])
        d=p.get('data') or ''
        for m in re.finditer(r'<note>(.*?)</note>',d,re.S):
            n=m.group(1).strip(); notes_tot+=1
            if n.lower().startswith('original'): continue
            if len(n)<40: continue
            if not re.search(CUE,n): continue
            if not re.search(r'[A-Z][a-zāīūṛṣśṇḍṭñ]+',n[1:]): continue
            out.append(dict(book_id=p['book_id'],page=p['page'],note=n,start=m.start(),at=p['at']))
    return out,notes_tot,pages,maxat
