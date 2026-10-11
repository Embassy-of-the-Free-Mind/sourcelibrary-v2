# PRIOR ART: scripts/eval/benchmark-score.mjs (our CER: normAlpha + letters only; ported below as `ours`) and the
# Greif repo's src/benchmarking/txt_accuracy.py (rapidfuzz; not installed on this box). This is a dependency-free
# Levenshtein (Hyyrö's bit-vector algorithm on Python ints) plus the three papers' normalisations, so every paper is
# scored by its own stated definition and by ours (#6547).
import re, random, unicodedata

REFUSAL = re.compile(r"\bI (?:cannot|can't|am unable to) (?:provide|transcribe|reproduce|output)|content (?:safety )?filter|"
                     r"This request was blocked by Gemini's filters", re.I)


def lev(a, b):
    """Levenshtein distance between two sequences (str or list of hashables). Bit-parallel, O(len(a)*len(b)/wordsize)."""
    if len(a) < len(b):
        a, b = b, a
    m = len(b)
    if m == 0:
        return len(a)
    peq = {}
    for i, c in enumerate(b):
        peq[c] = peq.get(c, 0) | (1 << i)
    mask = (1 << m) - 1
    hi = 1 << (m - 1)
    pv, mv, score = mask, 0, m
    for c in a:
        eq = peq.get(c, 0)
        xv = eq | mv
        xh = (((eq & pv) + pv) ^ pv) | eq
        ph = mv | (~(xh | pv) & mask)
        mh = pv & xh
        if ph & hi:
            score += 1
        elif mh & hi:
            score -= 1
        ph = ((ph << 1) | 1) & mask
        mh = (mh << 1) & mask
        pv = mh | (~(xv | ph) & mask)
        mv = ph & xv
    return score


def unwrap(raw):
    """(text, problem). The reply between <<<BEGIN>>> and <<<END>>> (END optional, as cli-chatter.mjs unwrapSentinels).
    No marker: the whole reply, flagged; a short marker-less refusal is a failed read."""
    t = (raw or '').strip()
    m = re.search(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)', t)
    if m:
        body = m.group(1)
    else:
        if not t:
            return '', 'empty'
        if REFUSAL.search(t) and len(t) < 600:
            return '', 'refusal'
        body = t
    body = re.sub(r'^\s*```[a-z]*\s*\n|\n\s*```\s*$', '', body.strip())
    if not body.strip():
        return '', 'empty'
    return body.strip(), (None if m else 'no_sentinel')


def failed_kind(row):
    """None when the row is a read; else the kind of failure (counted, never scored: #6523 rule)."""
    if row is None:
        return 'missing'
    if not row.get('text'):
        e = (row.get('error') or 'empty').split(':')[0]
        return e
    _, prob = unwrap(row['text'])
    return prob if prob in ('empty', 'refusal') else None


# ---- normalisations -------------------------------------------------------------------------------------------
def greif_strict(t):  # txt_accuracy.py clean_text_nonorm
    t = t.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def greif_norm(t):  # txt_accuracy.py clean_text_normalized
    t = greif_strict(t).encode('ascii', errors='ignore').decode('ascii').lower()
    t = re.sub(r'[^a-z0-9 ]+', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def humphries_strict(t):  # "any capitalization, punctuation, or spelling difference counted" (2411.03340 §3)
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', t)).strip()


def humphries_modified(t):  # capitals and punctuation ignored (historical-spelling expansion is not automatable)
    t = unicodedata.normalize('NFC', t).lower()
    t = re.sub(r'[^\w\s]|_', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def ours(t):  # benchmark-score.mjs normAlpha + lettersOnly (no 6,000-char cap: a Greif document is 3 pages)
    t = unicodedata.normalize('NFC', t).lower().replace('ſ', 's')
    t = re.sub(r'[‐‑‒–—―¬]', '-', t)
    t = re.sub(r'(\w)-\s*\n\s*', r'\1', t)
    return re.sub(r'[\W_]+', '', t)


NORMS = {'greif_strict': greif_strict, 'greif_norm': greif_norm, 'humphries_strict': humphries_strict,
         'humphries_modified': humphries_modified, 'ours': ours}


def counts(hyp, ref, norm):
    """(char_dist, ref_chars, word_dist, ref_words) under one normalisation."""
    h, r = NORMS[norm](hyp), NORMS[norm](ref)
    cd = lev(h, r)
    if norm == 'ours':
        return cd, len(r), None, None
    hw, rw = h.split(), r.split()
    return cd, len(r), lev(hw, rw), len(rw)


def _tok(t):
    return re.sub(r'[^\w]', '', unicodedata.normalize('NFC', t).lower())


def plant_verdict(out_text, plant):
    """Did a planted error survive correction? Find the site in the output by the plant's left context (up to 3 tokens)
    and, failing that, its right context (2 tokens); read the token there. A bigram check is not enough: in a
    directory, 'Peter, Lohnkutscher' can be a real entry two lines further down (#6547 pilot)."""
    toks = [_tok(x) for x in out_text.split()]
    toks = [x for x in toks if x]
    planted, orig = _tok(plant['planted']), _tok(plant['orig'])
    left = [x for x in (_tok(y) for y in plant.get('left', [plant['prev']])) if x]
    right = [x for x in (_tok(y) for y in plant.get('right', [plant['next']])) if x]
    seen = []
    for k in range(len(left), 0, -1):  # longest left context first
        ctx = left[-k:]
        for i in range(len(toks) - k):
            if toks[i:i + k] == ctx:
                seen.append(toks[i + k])
        if seen:
            break
    if not seen and right:
        for k in range(len(right), 0, -1):
            ctx = right[:k]
            for i in range(1, len(toks) - k + 1):
                if toks[i:i + k] == ctx:
                    seen.append(toks[i - 1])
            if seen:
                break
    if planted in seen:
        return 'survived'
    if orig in seen:
        return 'corrected'
    return 'other' if seen else 'site_not_found'


def plant_ambiguous(plant, ref_text):
    """A plant whose site cannot be told apart from a real line: its left context occurs more than once in the
    reference (a directory repeats 'Friedrichs Joh. Peter,'), so the planted word may be a real entry there."""
    toks = [x for x in (_tok(y) for y in ref_text.split()) if x]
    left = [x for x in (_tok(y) for y in plant.get('left', [plant['prev']])) if x]
    k = len(left)
    return k > 0 and sum(toks[i:i + k] == left for i in range(len(toks) - k + 1)) > 1


def ratio_ci(units, B=10000, seed=6547):
    """units: list of (num, den). Pooled ratio sum(num)/sum(den) with a 95% percentile interval, resampled by unit."""
    units = [u for u in units if u[1]]
    if not units:
        return None, None, None
    pt = sum(n for n, _ in units) / sum(d for _, d in units)
    rng = random.Random(seed)
    k = len(units)
    bs = []
    for _ in range(B):
        s = [units[rng.randrange(k)] for _ in range(k)]
        bs.append(sum(n for n, _ in s) / sum(d for _, d in s))
    bs.sort()
    return pt, bs[int(0.025 * B)], bs[int(0.975 * B) - 1]
