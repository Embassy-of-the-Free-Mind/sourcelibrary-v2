#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/feats2.py — the same text features (size, repetition, garbage, lexicality, script
block, OCR<->translation consistency, tags) over the spare-audit PACKETS and their images. This ports them to the
all-source label table (labels.jsonl + pages.jsonl from labels.mjs / fetch-pages.mjs), drops the image block (images
exist on disk only for the spare audit), and adds what the first pass did not have: neighbour-seam features
(catchword, carry-over, page-number continuity, T5 lookahead), model-route features, and a `difficulty` tag per
feature so train.py can ablate "hard page" against "wrong text".

features.py <dir>  reads <dir>/labels.jsonl and <dir>/pages.jsonl, writes <dir>/feats.json:
  [{ y, book, page_id, source, method, selection, exposure, reader, stale, text_from, cat: {...}, num: {...} }]
One row per label row. Rows with no text to feature (page missing, empty OCR) are dropped and counted.
"""
import json, re, zlib, math, sys, collections as C

DIR = sys.argv[1]
labels = [json.loads(l) for l in open(f"{DIR}/labels.jsonl")]
pages = {}
for l in open(f"{DIR}/pages.jsonl"):
    p = json.loads(l); pages[p['page_id']] = p

TAGBLOCK = re.compile(r'<(scan-quality|language|script|page-type|vocab|meta|image-desc|warning|columns|page-num)>.*?</\1>', re.S)
def body_of(o): return TAGBLOCK.sub('', o or '')
def strip(o): return re.sub(r'<[^>]+>', '', o or '')
tok = lambda s: re.findall(r'[^\W\d_]+', s.lower())
def tagval(o, t):
    m = re.search(f'<{t}>(.*?)</{t}>', o or '', re.S); return m.group(1).strip() if m else None

def model_family(m):
    m = (m or '').lower()
    if not m or m == 'none': return 'none'
    if 'lite' in m: return 'gemini-lite'
    if 'flash' in m: return 'gemini-flash'
    if 'pro' in m and 'gemini' in m: return 'gemini-pro'
    if 'opus' in m or 'claude' in m: return 'claude'
    if 'paddle' in m: return 'paddle'
    if 'yigdzin' in m or 'bdrc' in m: return 'yigdzin'
    if 'pero' in m: return 'pero'
    if 'source' in m or 'esukhia' in m or 'etext' in m: return 'etext'
    if 'gpt' in m or 'qwen' in m or 'glm' in m or 'agy' in m: return 'other-llm'
    return 'other'

def year_of(b):
    for v in (b.get('year'), b.get('published'), b.get('est_year')):
        m = re.search(r'1[0-9]{3}|20[0-2][0-9]', str(v or ''))
        if m: return int(m.group())
    return None

# ---- assemble the text each label row is about -------------------------------------------------------------
recs = []; dropped = C.Counter()
for r in labels:
    if r.get('positive_only'):
        pass  # kept: train.py decides; they still need features
    p = pages.get(r['page_id'])
    if r['source'] == 'spare_audit' and r.get('ocr_text') is not None:
        o, t, text_from = r['ocr_text'] or '', r.get('translation') or '', 'packet'
    elif p and p.get('ocr_text'):
        o, t, text_from = p['ocr_text'], p.get('translation') or '', 'live'
    else:
        dropped[f"{r['source']}/no_text"] += 1; continue
    if len(strip(body_of(o)).strip()) < 5:
        dropped[f"{r['source']}/empty_ocr"] += 1; continue
    if not p:
        dropped[f"{r['source']}/no_page"] += 1; continue
    recs.append(dict(r=r, p=p, o=o, t=t, text_from=text_from))
print('rows', len(labels), 'featured', len(recs), 'dropped', dict(dropped), file=sys.stderr)

# ---- language-level vocab and trigram tables, leave-one-book-out ----------------------------------------------
vocab = C.defaultdict(C.Counter); bookv = C.defaultdict(C.Counter); tri = C.defaultdict(C.Counter); booktri = C.defaultdict(C.Counter)
seen_page = set()
for x in recs:
    body = strip(body_of(x['o'])); x['body'] = body; x['tok'] = tok(body)
    L = x['p']['book'].get('language') or '?'; x['L'] = L; B = x['p']['book_id']
    key = (x['r']['page_id'], x['text_from'])
    if key in seen_page: continue  # a page judged twice counts once in the language tables
    seen_page.add(key)
    c = C.Counter(x['tok']); vocab[L].update(c); bookv[(L, B)].update(c)
    s = re.sub(r'\s+', ' ', body); tt = C.Counter(s[i:i+3] for i in range(len(s) - 2)); tri[L].update(tt); booktri[(L, B)].update(tt)

def ent(s):
    c = C.Counter(s); n = sum(c.values()); return -sum(v / n * math.log2(v / n) for v in c.values()) if n else 0
BLOCKS = {'Greek': (0x370, 0x3FF, 0x1F00, 0x1FFF), 'Chinese': (0x4E00, 0x9FFF, 0x3400, 0x4DBF), 'Arabic': (0x600, 0x6FF, 0x750, 0x77F), 'Hebrew': (0x590, 0x5FF, 0x590, 0x5FF),
          'Japanese': (0x3040, 0x30FF, 0x4E00, 0x9FFF), 'Tibetan': (0xF00, 0xFFF, 0xF00, 0xFFF), 'Persian': (0x600, 0x6FF, 0x750, 0x77F), 'Syriac': (0x700, 0x74F, 0x700, 0x74F), 'Korean': (0xAC00, 0xD7AF, 0x1100, 0x11FF)}
CONS = re.compile(r'[bcdfghjklmnpqrstvwxzſ]{6,}')
ROMAN = re.compile(r'^[ivxlcdm]+$', re.I)

def words_overlap(a, b):
    A = set(tok(a)); B = set(tok(b)); return len(A & B) / max(1, min(len(A), len(B))) if A and B else 0.0

out = []
for x in recs:
    r, p, o, t, body, w, L = x['r'], x['p'], x['o'], x['t'], x['body'], x['tok'], x['L']
    bk = p['book']; n = max(1, len(body)); d = {}
    lines = [l.strip() for l in body.split('\n') if l.strip()]; lc = C.Counter(lines)
    tplain = strip(t); tw = re.findall(r"[A-Za-z']+", tplain); tsent = [s.strip() for s in re.split(r'(?<=[.!?])\s+', tplain) if len(s.strip()) > 20]
    # size / repetition
    d['ocr_chars'] = len(body); d['tr_chars'] = len(tplain); d['tr_ratio'] = len(tplain) / n; d['ocr_words'] = len(w); d['ocr_lines'] = len(lines)
    d['ocr_zlib'] = len(zlib.compress(body.encode())) / max(1, len(body.encode())); d['tr_zlib'] = len(zlib.compress(tplain.encode())) / max(1, len(tplain.encode()))
    d['max_line_repeat'] = max(lc.values()) if lc else 0; d['dup_line_frac'] = sum(v for v in lc.values() if v > 1) / max(1, len(lines))
    ng = C.Counter(zip(w, w[1:], w[2:], w[3:])); d['max_4gram_repeat'] = max(ng.values()) if ng else 0
    sc = C.Counter(tsent); d['tr_dup_sent'] = sum(v - 1 for v in sc.values())
    d['top_word_share'] = C.Counter(w).most_common(1)[0][1] / len(w) if w else 0
    d['char_entropy'] = ent(body); d['tr_entropy'] = ent(tplain)
    # garbage rules
    d['garbage_cons'] = len(CONS.findall(body.lower())) / max(1, len(w)) * 100
    d['garbage_samechar'] = len(re.findall(r'(.)\1{3,}', body))
    d['mixed_alnum'] = len(re.findall(r'\b(?=\w*\d)(?=\w*[^\W\d])\w+\b', body)) / max(1, len(w)) * 100
    d['oneletter_frac'] = sum(len(z) == 1 for z in w) / max(1, len(w))
    d['pipe_frac'] = body.count('|') / n
    # lexicality, leave-one-book-out
    own = bookv[(L, p['book_id'])]; V = vocab[L]
    if w:
        other = [V[z] - own[z] for z in w]; d['oov_frac'] = sum(c <= 0 for c in other) / len(w); d['mean_logfreq'] = float(sum(math.log1p(max(0, c)) for c in other) / len(other))
    T = tri[L]; OT = booktri[(L, p['book_id'])]; tot = sum(T.values()) - sum(OT.values()); s = re.sub(r'\s+', ' ', body)
    if tot > 1000 and len(s) > 10:
        V3 = len(T) + 1; d['tri_ppl'] = float(sum(-math.log((T[s[i:i+3]] - OT[s[i:i+3]] + 1) / (tot + V3)) for i in range(len(s) - 2)) / (len(s) - 2))
    # script consistency
    letters = [c for c in body if c.isalpha()]
    if L in BLOCKS and letters:
        a1, a2, b1, b2 = BLOCKS[L]; d['in_block'] = sum(a1 <= ord(c) <= a2 or b1 <= ord(c) <= b2 for c in letters) / len(letters)
    d['latin_letter_frac'] = sum(c.isascii() for c in letters) / max(1, len(letters))
    # OCR <-> translation consistency
    on = set(re.findall(r'\d+', body)); tn = set(re.findall(r'\d+', tplain)); d['num_ocr'] = len(on); d['num_tr'] = len(tn); d['num_jacc'] = len(on & tn) / max(1, len(on | tn)) if on | tn else 1
    ws = set(w); d['tr_nonenglish'] = sum(1 for z in tw if z.lower() in ws) / max(1, len(tw))
    d['tr_avg_sent'] = sum(len(s) for s in tsent) / len(tsent) if tsent else 0
    d['tr_notes'] = len(re.findall(r'\[[^\]]{0,200}\]', t)); d['tr_unclear'] = len(re.findall(r'illegible|unclear|uncertain|\[\?|\?\]', t, re.I))
    d['tr_meta_frac'] = sum(len(m) for m in re.findall(r'<meta>.*?</meta>', t, re.S)) / max(1, len(t))
    d['tr_note_frac'] = sum(len(m) for m in re.findall(r'<note>.*?</note>', t, re.S)) / max(1, len(t))
    d['tr_has_text'] = int(len(tplain.strip()) > 0)
    caps_o = len(re.findall(r'\b[A-Z][a-z]{3,}', body)); caps_t = len(re.findall(r'\b[A-Z][a-z]{3,}', tplain)); d['caps_ratio'] = caps_t / max(1, caps_o)
    d['ocr_reasoning'] = int(bool(re.search(r"\b(I cannot|I can't|As an AI|here is the transcription|the image shows|I'm unable)\b", o, re.I)))
    d['tr_reasoning'] = int(bool(re.search(r"\b(I cannot|I can't|As an AI|here is the translation|I'm unable|the image shows)\b", t, re.I)))
    # tags the model wrote about itself
    for k in ('unclear', 'warning', 'margin', 'column-break', 'columns', 'image-desc', 'header', 'sig', 'insert', 'gloss', 'note', 'leaf-break', 'catchword', 'vocab', 'meta', 'page-num', 'footnote', 'table'):
        d['tag_' + k] = len(re.findall(f'<{k}[ >/]', o))
    vocab_words = set(tok(' '.join(re.findall(r'<vocab>(.*?)</vocab>', o, re.S))))
    d['vocab_absent'] = sum(1 for v in vocab_words if v not in ws) / max(1, len(vocab_words)) if vocab_words else 0
    # neighbour seams
    prev, nxt = p.get('prev'), p.get('next')
    if prev and prev.get('ocr_tail') is not None:
        pt = strip(body_of(prev['ocr_tail'])); d['prev_ocr_len'] = prev.get('ocr_len') or 0
        d['seam_prev_overlap'] = words_overlap(pt[-300:], body[:300])
        pw = tok(pt); d['catchword_hit'] = int(bool(pw) and bool(w) and pw[-1] == w[0]) if pw and w else 0
        ptt = strip(prev.get('tr_tail') or ''); d['t5_prev_tr_overlap'] = words_overlap(ptt[-250:], tplain[:250])
        d['prev_ocr_empty'] = int((prev.get('ocr_len') or 0) < 20)
    if nxt and nxt.get('ocr_head') is not None:
        nh = strip(body_of(nxt['ocr_head'])); d['next_ocr_len'] = nxt.get('ocr_len') or 0
        d['seam_next_overlap'] = words_overlap(body[-300:], nh[:300])
        ntt = strip(nxt.get('tr_head') or ''); d['t5_next_tr_overlap'] = words_overlap(tplain[-250:], ntt[:250])
        d['next_ocr_empty'] = int((nxt.get('ocr_len') or 0) < 20)
    if prev and nxt:
        d['len_vs_neighbours'] = len(body) / max(1, ((prev.get('ocr_len') or 0) + (nxt.get('ocr_len') or 0)) / 2)
    pnum = tagval(o, 'page-num'); d['has_page_num'] = int(bool(pnum))
    m = re.search(r'\d+', pnum or ''); d['page_num_delta'] = (int(m.group()) - p['page_number']) if m else float('nan')
    # metadata / difficulty
    y = year_of(bk); d['year'] = y if y else float('nan')
    pc = bk.get('pages_count') or 0; pn = p['page_number']; d['pages_count'] = pc; d['page_pos'] = pn / max(1, pc); d['edge_page'] = int(pn <= 3 or pn >= pc - 2)
    d['img_aspect'] = (p.get('image_width') or 0) / max(1, p.get('image_height') or 1) if p.get('image_width') else float('nan')
    d['img_px'] = (p.get('image_width') or 0) * (p.get('image_height') or 0) / 1e6 if p.get('image_width') else float('nan')
    d['quality_score'] = bk.get('quality_score') if bk.get('quality_score') is not None else float('nan')
    d['split_from_spread'] = int(bool(p.get('split_from_spread')))
    ocr_model = p.get('ocr_model') if x['text_from'] == 'live' else (r.get('ocr_model_at_check') or p.get('ocr_model'))
    cat = {'lang': L, 'ocr_family': model_family(ocr_model), 'tr_family': model_family(p.get('tr_model')), 'script': (p.get('script_type') or 'NA'), 'page_type': (p.get('page_type') or 'NA'),
           'book_class': bk.get('book_class') or 'NA', 'provider': bk.get('provider') or 'NA', 'ocr_prompt': str(p.get('ocr_prompt_version') or 'NA')[:16], 'scan_quality': (tagval(o, 'scan-quality') or 'NA')[:20]}
    out.append(dict(y=int(bool(r['serious'])), book=p['book_id'], page_id=r['page_id'], source=r['source'], method=r['method'], selection=r.get('selection'), exposure=r.get('exposure'), reader=r.get('reader'),
                    stale=r.get('stale'), positive_only=bool(r.get('positive_only')), text_from=x['text_from'], cat=cat, num=d))
json.dump(out, open(f"{DIR}/feats.json", "w"), default=float)
print('wrote', len(out), 'feature rows', file=sys.stderr)
