#!/usr/bin/env python3
"""legacy-ocr-fetch.py — the holding library's own free OCR for each #5924 gate leaf (prereg Amendment 5a, descriptive).

PRIOR ART: scripts/eval/latin-bakeoff-5924/fetch.py / prep.py (fetch the fed leaf by its sidecar URL; this fetches the
library's TEXT for that leaf instead); no legacy-OCR fetcher for IA hOCR / MDZ hOCR / e-rara METS exists in scripts/
(git grep hocr_pageindex, hocr_searchtext, FULLTEXT: none).

  legacy-ocr-fetch.py <legacy-in.json> <out dir>
Writes <out>/X.jsonl (leaf k, the scored arm), Xm1.jsonl / Xp1.jsonl (leaves k-1 / k+1, the mapping check only) and
<out>/legacy-log.jsonl (one row per page: source, status). Run where e-rara answers (gex45; it 403s the ARM job hosts).
"""
import gzip, html, json, re, sys, time, urllib.request
from html.parser import HTMLParser

UA = {'User-Agent': 'Mozilla/5.0 (SourceLibrary eval #5924; derek@sourcelibrary.org)'}

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410): return e.code, b''
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return 0, b''

class Hocr(HTMLParser):
    """ocr_line spans → lines of ocrx_word text."""
    def __init__(self):
        super().__init__(); self.lines = []; self.depth = 0; self.cur = None; self.stack = []
    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get('class', '') or ''
        is_line = any(c in cls for c in ('ocr_line', 'ocr_caption', 'ocr_textfloat', 'ocr_header'))
        self.stack.append(is_line)
        if is_line: self.cur = []
    def handle_endtag(self, tag):
        if self.stack and self.stack.pop() and self.cur is not None:
            t = ' '.join(''.join(self.cur).split())
            if t: self.lines.append(t)
            self.cur = None
    def handle_data(self, d):
        if self.cur is not None: self.cur.append(d)

def hocr_text(raw):
    p = Hocr(); p.feed(raw.decode('utf-8', 'replace')); return '\n'.join(p.lines)

IA_CACHE = {}
def djvu_pages(raw):
    """<id>_djvu.xml: one OBJECT per access leaf, in leaf order; LINE → WORDs."""
    out = []
    for obj in re.findall(r'<OBJECT\b.*?</OBJECT>', raw, re.S):
        lines = [' '.join(html.unescape(w) for w in re.findall(r'<WORD[^>]*>(.*?)</WORD>', ln, re.S)) for ln in re.findall(r'<LINE>(.*?)</LINE>', obj, re.S)]
        out.append('\n'.join(l for l in lines if l.strip()))
    return out

def ia_leaf(ident, k):
    if ident not in IA_CACHE:
        s1, idx = get(f'https://archive.org/download/{ident}/{ident}_hocr_pageindex.json.gz')
        s2, txt = get(f'https://archive.org/download/{ident}/{ident}_hocr_searchtext.txt.gz')
        if s1 == 200 and s2 == 200:
            idx, txt = json.loads(gzip.decompress(idx)), gzip.decompress(txt).decode('utf-8', 'replace')
            IA_CACHE[ident] = ('hocr', [txt[a[0]:a[1]] for a in idx])
        else:   # older items: no hOCR derivative, only the DjVu XML
            s3, x = get(f'https://archive.org/download/{ident}/{ident}_djvu.xml')
            IA_CACHE[ident] = ('djvu.xml', djvu_pages(x.decode('utf-8', 'replace'))) if s3 == 200 and x else None
    c = IA_CACHE[ident]
    if c is None or k < 0 or k >= len(c[1]): return None
    return c[1][k]

MAN = {}
def manifest(url):
    if url not in MAN:
        s, b = get(url); MAN[url] = json.loads(b) if s == 200 else None
    return MAN[url]

def canvas_texts(man, key):
    """IIIF v2 canvases; returns (index of the canvas whose image id contains key, [seeAlso hOCR url per canvas])."""
    cs = man['sequences'][0]['canvases']; hit = None; urls = []
    for i, c in enumerate(cs):
        img = json.dumps(c.get('images', []))
        if hit is None and key in img: hit = i
        sa = c.get('seeAlso'); sa = sa if isinstance(sa, list) else [sa] if sa else []
        u = next((x.get('@id') for x in sa if isinstance(x, dict) and 'hocr' in (x.get('format', '') + x.get('profile', '') + x.get('label', '')).lower()), None)
        urls.append(u)
    return hit, urls

def alto_text(raw):
    out = []
    for ln in re.findall(r'<(?:\w+:)?TextLine\b.*?</(?:\w+:)?TextLine>', raw, re.S):
        ws = [html.unescape(w) for w in re.findall(r'<(?:\w+:)?String\b[^>]*?\bCONTENT="([^"]*)"', ln)]
        if ws: out.append(' '.join(ws))
    return '\n'.join(out)

def erara_leaf_texts(mets, page_id):
    """the ALTO of the physical page holding IMG_DEFAULT_<page_id>, and of its neighbours in ORDER."""
    phys = re.findall(r'<mets:div ID="phys(\d+)" TYPE="page"[^>]*>(.*?)</mets:div>', mets, re.S)
    ids = [p for p, _ in phys]
    if page_id not in ids: return None
    i = ids.index(page_id)
    def t(j):
        if j < 0 or j >= len(phys): return None
        m = re.search(r'FILEID="(ALTO\d+)"', phys[j][1])
        if not m: return None
        h = re.search(r'ID="' + m.group(1) + r'"><mets:FLocat xlink:href="([^"]+)"', mets)
        if not h: return None
        s, b = get(h.group(1)); return alto_text(b.decode('utf-8', 'replace')) if s == 200 and b else None
    return [t(i), t(i - 1), t(i + 1)]

def mets_fulltext(manifest_url):
    m = re.search(r'/i3f/v21/(\d+)/manifest', manifest_url or '')
    if not m: return None
    s, b = get(f'https://www.e-rara.ch/oai?verb=GetRecord&metadataPrefix=mets&identifier={m.group(1)}')
    return b.decode('utf-8', 'replace') if s == 200 else None

def main():
    rows = json.load(open(sys.argv[1])); out = sys.argv[2]
    X, Xm, Xp, log = (open(f'{out}/{n}', 'w') for n in ('X.jsonl', 'Xm1.jsonl', 'Xp1.jsonl', 'legacy-log.jsonl'))
    for r in rows:
        url, rec = r['image'], {'page_id': r['slug'], 'century': r['century']}
        texts = None
        m = re.search(r'archive\.org/download/([^/]+)/page/n(\d+)/', url)
        if m:
            ident, k = m.group(1), int(m.group(2)); rec.update(source='archive', key=f'{ident} n{k}')
            texts = [ia_leaf(ident, k + d) for d in (0, -1, 1)]
            if IA_CACHE.get(ident): rec['format'] = IA_CACHE[ident][0]
            if texts[0] is None: rec['status'] = 'no-legacy-text' if IA_CACHE.get(ident) is None else 'leaf-out-of-range'
        elif 'digitale-sammlungen.de' in url:
            m = re.search(r'(bsb\d+)_(\d+)', url); bsb = m.group(1); rec.update(source='mdz', key=m.group(0))
            man = manifest(f'https://api.digitale-sammlungen.de/iiif/presentation/v2/{bsb}/manifest')
            if man is None: rec['status'] = 'no-manifest'
            else:
                i, urls = canvas_texts(man, m.group(0))
                if i is None: rec['status'] = 'leaf-not-in-manifest'
                else:
                    def t(j):
                        if j < 0 or j >= len(urls) or not urls[j]: return None
                        s, b = get(urls[j]); return hocr_text(b) if s == 200 and b else None
                    texts = [t(i), t(i - 1), t(i + 1)]
                    if texts[0] is None: rec['status'] = 'no-legacy-text'
        elif 'e-rara.ch' in url:
            rec.update(source='e-rara', key=re.search(r'/v21/(\d+)/', url).group(1))
            mets = mets_fulltext(r.get('manifest'))
            if mets is None: rec['status'] = 'no-mets'
            elif 'USE="FULLTEXT"' not in mets: rec['status'] = 'no-legacy-text'
            else:
                texts = erara_leaf_texts(mets, rec['key'])
                if not texts or texts[0] is None: rec['status'] = 'no-legacy-text'
        elif 'heidelberg' in url:
            rec.update(source='heidelberg', key=url.split('/iiif/2/')[1].split('/')[0])
            man = manifest(r['manifest']) if r.get('manifest') else None
            if man is None: rec['status'] = 'no-manifest'
            else:
                i, urls = canvas_texts(man, rec['key'].replace('%3A', ':'))
                rec['status'] = 'no-legacy-text' if i is None or not urls[i] else 'seeAlso-present-not-parsed'
        else:
            rec.update(source='other', status='no-source')
        if texts and texts[0] is not None:
            rec['status'] = 'ok'
            for f, t in zip((X, Xm, Xp), texts):
                if t is not None: f.write(json.dumps({'page_id': r['slug'], 'text': t}, ensure_ascii=False) + '\n')
        log.write(json.dumps(rec) + '\n'); print(rec, flush=True)
    for f in (X, Xm, Xp, log): f.close()

if __name__ == '__main__':
    main()
