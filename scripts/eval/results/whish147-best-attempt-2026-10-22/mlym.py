"""IAST -> Malayalam script for the Whish 147 page texts (#7119, Derek's inbox notes of 2026-10-22 23:09–23:13).

PRIOR ART: build_editions.py uses the same indic_transliteration package the other way (Devanagari -> IAST). This
converts only the Sanskrit reading: <tags>, **labels**, [bracketed marks], row numbers, ‖ and the warning stay as
they are. Kerala spellings applied, all mechanical and all seen on this leaf (Derek's note, 23:13):
  - r before a consonant -> dot-reph ൎ, and the consonant after it doubled (dharmi -> ധൎമ്മി);
  - ḥ before s/ś/ṣ -> the sibilant doubled (viṣayaḥ sāmānya -> വിഷയസ്സാമാന്യ);
  - ṃ (or word-final m) before a stop -> the nasal of that stop (vyaktaṃ tathā -> വ്യക്തന്തഥാ);
  - word-final m -> ം; word-final n, r, l, ḷ, ṇ -> chillu;
  - word-final t -> the chillu ൽ, as this scribe writes it (…ത്വാൽത്രിഗുണ; spot check of 2026-10-23, #7119);
  - words within a row run together (scriptio continua), except vowel + vowel, which keeps the independent vowel.
No other scribal habit is imitated. Never transliterated: [bracketed marks], the hole marker (‖hole‖ -> ‖), and the
edition's quotation marks around a pratīka ('rūpaiḥ'; -> ‘രൂപൈഃ’;), which IAST would otherwise read as avagraha.
Tests: test_mlym.py (python test_mlym.py with the job venv).
Reads JSON {key: text} on stdin, writes JSON {key: malayalam_text} on stdout. Run with the job venv.
"""
import json, re, sys
from indic_transliteration import sanscript

PROTECT = re.compile(r'(\[[^\]]*\]|<[^>]+>|‖|‘|’|\*\*[^*]+\*\*|\.\.\.|…|\?)')
# The hole marker: an earlier page shape wrote the string hole as ‖hole‖, and transliterating it gave ‖ഹോലേ‖ (#7119).
HOLE = re.compile(r'\s*‖\s*hole\s*‖\s*|\s*‖\s*hole\b\s*|\s*\bhole\s*‖\s*', re.I)


def unhole(s):
    """‖hole‖ (and a half-written ‖hole) -> a bare ‖ with a space either side."""
    return HOLE.sub(' ‖ ', s)


def quotes(s):
    """The edition quotes its pratīkas as 'rūpaiḥ'; — an apostrophe that IAST would read as avagraha. A closing quote
    is an apostrophe after a letter and before a non-letter (an avagraha always comes before a letter); its opener is
    the nearest earlier apostrophe that starts a word. Both become ‘ ’ and are kept out of the transliteration."""
    cs = list(s)
    for i, ch in enumerate(cs):
        if ch == "'" and i > 0 and cs[i - 1].isalpha() and (i + 1 == len(cs) or not cs[i + 1].isalpha()):
            for j in range(i - 1, -1, -1):
                if cs[j] == "'" and (j == 0 or not cs[j - 1].isalpha()) and j + 1 < len(cs) and cs[j + 1].isalpha():
                    cs[j], cs[i] = '‘', '’'
                    break
    return ''.join(cs)
CONS = 'ക-ഹ'
# IAST consonants, digraphs first
CONSONANTS = ['kh', 'gh', 'ch', 'jh', 'ṭh', 'ḍh', 'th', 'dh', 'ph', 'bh', 'k', 'g', 'ṅ', 'c', 'j', 'ñ', 'ṭ', 'ḍ', 'ṇ', 't', 'd', 'n', 'p', 'b', 'm', 'y', 'r', 'l', 'v', 'ś', 'ṣ', 's', 'h', 'ḷ']
NASAL = {**dict.fromkeys(['k', 'g'], 'ṅ'), **dict.fromkeys(['c', 'j'], 'ñ'), **dict.fromkeys(['ṭ', 'ḍ'], 'ṇ'), **dict.fromkeys(['t', 'd'], 'n'), **dict.fromkeys(['p', 'b'], 'm')}
VOWELS = set('aāiīuūṛṝeoḷ')
NO_DOUBLE = {'ś', 'ṣ', 's', 'h', 'r'}
CHILLU = {'ന്': 'ൻ', 'ര്': 'ർ', 'ല്': 'ൽ', 'ള്': 'ൾ', 'ണ്': 'ൺ'}


def first_cons(w):
    for c in CONSONANTS:
        if w.startswith(c):
            return c
    return None


def geminate_after_r(w):
    """r + consonant -> r + doubled consonant, unless already doubled or a sibilant/h/r."""
    out, i = [], 0
    while i < len(w):
        out.append(w[i])
        if w[i] == 'r' and (i == 0 or w[i - 1] not in 'ṛ'):
            c = first_cons(w[i + 1:])
            if c and c not in NO_DOUBLE:
                base = c[0] if len(c) == 2 and c[1] == 'h' else c
                rest = w[i + 1 + len(c):]
                already = w[i + 1:].startswith(base + c) or (len(c) == 1 and rest.startswith(c))
                if not already:
                    out.append(base)
        i += 1
    return ''.join(out)


def sandhi_words(words):
    """Apply the cross-word spellings (ḥ+sibilant, ṃ+stop, final m) to a list of IAST words."""
    ws = list(words)
    for i, w in enumerate(ws):
        nxt = ws[i + 1] if i + 1 < len(ws) else ''
        if nxt[:1] in VOWELS and w.endswith('ṃ'):
            w = w[:-1] + 'm'          # ṃ before a vowel is written m and joins the vowel
        elif w.endswith('m') and nxt[:1] not in VOWELS:
            w = w[:-1] + 'ṃ'
        if w.endswith('ḥ') and nxt[:1] in ('s', 'ś', 'ṣ'):
            w = w[:-1] + nxt[0]
        if w.endswith('ṃ'):
            c = first_cons(nxt)
            if c and c[0] in NASAL:
                w = w[:-1] + NASAL[c[0]]
        ws[i] = w
    return ws


def conv_word(w):
    w = geminate_after_r(w)
    out = sanscript.transliterate(w, sanscript.IAST, sanscript.MALAYALAM)
    out = re.sub(f'ർ(?=[{CONS}])', 'ൎ', out)
    out = re.sub(f'ര്(?=[{CONS}])', 'ൎ', out)
    for k, v in CHILLU.items():
        if out.endswith(k):
            out = out[: -len(k)] + v
    return out.replace(T_FINAL, 'ൽ')


T_FINAL = '\ue000'   # stands for a word-final t until after transliteration, then becomes the chillu ൽ


def runs(ws):
    """Split a row's words into the stretches written as one Malayalam word. Words join (scriptio continua) except
    where a vowel ends one word and a vowel begins the next: joined in IAST, a + i would read as the diphthong ai
    (puruṣa ityarthaḥ must not become puruṣaityarthaḥ), so there the independent vowel is kept."""
    out, cur = [], []
    for i, w in enumerate(ws):
        if cur and cur[-1][-1:] in VOWELS and w[:1] in VOWELS:
            out.append(cur)
            cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return out


def final_t(ws):
    """A word-final t is written as the chillu ൽ (the leaf: ...ത്വാൽത്രിഗുണ), except before a vowel, where it
    joins the next word's first syllable."""
    out = []
    for i, w in enumerate(ws):
        nxt = ws[i + 1] if i + 1 < len(ws) else ''
        out.append(w[:-1] + T_FINAL if w.endswith('t') and nxt[:1] not in VOWELS else w)
    return out


def conv(seg):
    seg = seg.replace('||', ' ॥ ').replace('//', ' ॥ ').replace('/', ' । ').replace('|', ' । ')
    lead = ' ' if seg[:1].isspace() else ''
    trail = ' ' if seg[-1:].isspace() else ''
    # trailing punctuation is its own token, so a word-final m / ḥ / t is still seen as final
    toks = re.sub(r'(?<=\w)([.,;:]+)(?=\s|$)', r' \1', seg.lower()).split()
    out, run = [], []
    def flush():
        # A run of words is written without spaces; chillu and anusvāra apply at the end of each written word.
        if run:
            # a t before a dash (cet-na, śeṣavat- śeṣaṃ) is word-final too; a t before a hyphen that ends the row or
            # the segment before a hole is a word broken there, and stays ത്
            ws = final_t(sandhi_words(run))
            ws = [re.sub(r't-(?=\w)', T_FINAL + '-', w) if i == len(ws) - 1 else re.sub(r't-(?=\w|$)', T_FINAL + '-', w)
                  for i, w in enumerate(ws)]
            out.append(''.join(conv_word(''.join(r)) for r in runs(ws)))
            run.clear()
    for t in toks:
        if t in ('।', '॥') or re.fullmatch(r'[\d\-–—,;:.]+', t):
            flush()
            t = sanscript.transliterate(t, sanscript.IAST, sanscript.MALAYALAM) if t.isdigit() else t
            if re.fullmatch(r'[.,;:]+', t) and out:
                out[-1] += t      # a full stop or comma sits on the word before it
            else:
                out.append(t)
        else:
            run.append(t)
    flush()
    return lead + ' '.join(out) + trail


def line(l):
    s = l.strip()
    if not s or s.startswith('<') or re.fullmatch(r'\*\*[^*]+\*\*', s) or s == '---':
        return l
    m = re.match(r'^(\s*\d+\.\s+)(.*)$', l)
    head, body = (m.group(1), m.group(2)) if m else ('', l)
    body = quotes(unhole(body))
    return head + ''.join(p if PROTECT.fullmatch(p) else conv(p) for p in PROTECT.split(body))


def text(t):
    return '\n'.join(line(l) for l in t.split('\n'))


if __name__ == '__main__':
    print(json.dumps({k: text(v) for k, v in json.load(sys.stdin).items()}, ensure_ascii=False))
