"""Build the reference texts the Whish 147 leaves are anchored to (#7119), as plain IAST with no numbering.

PRIOR ART: ../whish147-palm-leaf-opus-2026-10-21/collation-multileaf/plant.py — it read the GRETIL kārikās from
sk.json; this adds the three commentaries and the Tarkasaṃgraha, and strips the numbering (a pilot leaked GRETIL's
word index into a collation, #5935).

Sources (fetched to $JOB_SCRATCH, not committed):
  sk      GRETIL sa_IzvarakRSNa-sAMkhyakArikA (via sk.json of the 2026-10-21 run)
  jm      GRETIL sa_IzvarakRSNa-sAMkhyakArikA-comm3: Jayamaṅgalā, ed. H. Sarma, Calcutta 1926
  tk      the Source Library copy of Tārānātha Tarkavācaspati's print of the Sāṃkhya-tattvakaumudī (book
          6aa35fc539e924dd9a9122ab, BSB bsb10996672), machine OCR (gemini flash-lite), its footnote sub-commentary
          dropped, transliterated Devanagari -> IAST
  dipika  GRETIL sa_annaMbhaTTa-tarkasaMgraha-comm: the Dīpikā sections only (Prakāśikā, Bālapriyā and the root
          text dropped)
  ts      GRETIL sa_annaMbhatta-tarkasaMgraha
Run: $JOB_SCRATCH/venv/bin/python build_editions.py   (writes $JOB_SCRATCH/editions/<work>.txt)
"""
import html, json, os, re
from pathlib import Path
from indic_transliteration import sanscript

S = Path(os.environ.get('JOB_SCRATCH', '/mnt/HC_Volume_105839809/jobs/whish147-best'))
G = S / 'gretil'
OUT = S / 'editions'
OUT.mkdir(exist_ok=True)
HERE = Path(__file__).parent
SKJ = HERE.parent / 'whish147-palm-leaf-opus-2026-10-21' / 'collation-multileaf' / 'sk.json'


def body(xml):
    t = xml.split('<body>', 1)[1].split('</body>', 1)[0]
    return t


def detag(t):
    t = re.sub(r'<lb\s*/>', ' ', t)
    t = re.sub(r'</(p|l|lg|head|div|row)>', '\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    return html.unescape(t)


def clean(t):
    t = re.sub(r'\b(ISk|AnTs|SK)_\w+', '', t)
    t = re.sub(r'kārikā\s*\d+', '', t)
    t = re.sub(r'[\d०-९]+', '', t)
    t = re.sub(r'\(\s*\)|\[\s*\]', '', t)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r' *\n *', '\n', t)
    t = re.sub(r'\n{2,}', '\n', t)
    return t.strip()


def sk():
    d = json.loads(SKJ.read_text())
    out = []
    for k in sorted(d, key=int):
        v = re.sub(r'SK_\d+', '', d[k]).replace("'", '').replace('`', '').replace('^', '').replace('.a', "'")
        v = re.sub(r'(?<=\w)-(?=\w)', '', v)
        out.append(v.strip() + ' //')
    return clean('\n'.join(out))


def jm():
    return clean(detag(body((G / 'sa_IzvarakRSNa-sAMkhyakArikA-comm3.xml').read_text())))


def dipika():
    b = body((G / 'sa_annaMbhaTTa-tarkasaMgraha-comm.xml').read_text())
    blocks = re.split(r'(<p><hi rend="bold">[^<]{1,40}</hi></p>)', b)
    keep, on = [], False
    for blk in blocks:
        m = re.fullmatch(r'<p><hi rend="bold">([^<]{1,40})</hi></p>', blk)
        if m:
            h = m.group(1).strip()
            if h == 'dīpikā':
                on = True
            elif h in ('prakāśikā', 'bālapriyā', 'prasāraṇā', 'tarkasaṅgrahaḥ', 'tarkasaṃgrahaḥ') or h.startswith('ślokaḥ'):
                on = False
            continue
        if on:
            keep.append(re.sub(r'<l rend="bold">AnTs_[^<]*</l>', '', blk))
    return clean(detag('\n'.join(keep)))


def ts():
    return clean(detag(body((G / 'sa_annaMbhatta-tarkasaMgraha.xml').read_text())))


def tk():
    pages = json.loads((S / 'tk-print.json').read_text())
    out = []
    for p in pages:
        t = p['text']
        if 'Sanskrit' not in t[:400] and not re.search(r'[ऀ-ॿ]{20}', t):
            continue
        t = re.sub(r'<(scan-quality|language|script|page-type|page-num|header|meta|warning|vocab|summary|keywords|image-desc|insert|sig|catchword|folio)>[\s\S]*?</\1>', '', t)
        t = re.sub(r'<[^>]+>', '', t)
        lines = []
        for ln in t.split('\n'):
            s = ln.strip()
            # footnote paragraphs of the editor's sub-commentary start with (१) / (1)
            if re.match(r'^\(\s*[\d०-९]+\s*\)', s):
                continue
            if re.fullmatch(r'[\[\]\s\d०-९.।]*(तत्त्व|तत्व|तच्च)?\s*कौमुदी\s*[।.]?[\s\d०-९]*', s):
                continue
            lines.append(s)
        t = '\n'.join(lines)
        t = re.sub(r'\(\s*[\d०-९]+\s*\)', '', t)  # inline footnote markers
        out.append(t)
    deva = '\n'.join(out)
    iast = sanscript.transliterate(deva, 'devanagari', 'iast').replace('|', '/').replace('->', '').replace('<-', '')
    iast = iast[iast.index('ajāmekāṃ'):]  # print pages before this are the editor's preface
    return clean(iast)


if __name__ == '__main__':
    for name, fn in [('sk', sk), ('jm', jm), ('tk', tk), ('dipika', dipika), ('ts', ts)]:
        txt = fn()
        (OUT / f'{name}.txt').write_text(txt)
        print(name, len(txt), 'chars;', txt[:120].replace('\n', ' | '))
