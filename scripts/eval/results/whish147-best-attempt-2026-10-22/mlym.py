<<<<<<< HEAD
"""IAST -> Malayalam script for the Whish 147 page texts (#7119, Derek's inbox notes of 2026-10-22 23:09).

PRIOR ART: build_editions.py uses the same indic_transliteration package the other way (Devanagari -> IAST). This
converts only the Sanskrit reading: <tags>, **labels**, [bracketed marks], row numbers, ‖ and the warning stay as
they are. r before a consonant is written as the dot-reph ൎ (U+0D4E), as this scribe (and Fable's own reads) do;
no other scribal habit is imitated.
=======
"""IAST -> Malayalam script for the Whish 147 page texts (#7119, Derek's inbox notes of 2026-10-22 23:09–23:13).

PRIOR ART: build_editions.py uses the same indic_transliteration package the other way (Devanagari -> IAST). This
converts only the Sanskrit reading: <tags>, **labels**, [bracketed marks], row numbers, ‖ and the warning stay as
they are. Kerala spellings applied, all mechanical and all seen on this leaf (Derek's note, 23:13):
  - r before a consonant -> dot-reph ൎ, and the consonant after it doubled (dharmi -> ധൎമ്മി);
  - ḥ before s/ś/ṣ -> the sibilant doubled (viṣayaḥ sāmānya -> വിഷയസ്സാമാന്യ);
  - ṃ (or word-final m) before a stop -> the nasal of that stop (vyaktaṃ tathā -> വ്യക്തന്തഥാ);
  - word-final m -> ം; word-final n, r, l, ḷ, ṇ -> chillu;
  - words within a row run together (scriptio continua).
No other scribal habit is imitated.
>>>>>>> origin/job-whish147-best
Reads JSON {key: text} on stdin, writes JSON {key: malayalam_text} on stdout. Run with the job venv.
"""
import json, re, sys
from indic_transliteration import sanscript

PROTECT = re.compile(r'(\[[^\]]*\]|<[^>]+>|‖|\*\*[^*]+\*\*|\.\.\.|…|\?)')
CONS = 'ക-ഹ'
<<<<<<< HEAD

def conv(seg):
    seg = seg.replace('||', ' ॥ ').replace('//', ' ॥ ').replace('/', ' । ').replace('|', '।')
    out = sanscript.transliterate(seg.lower(), sanscript.IAST, sanscript.MALAYALAM)
    out = re.sub(f'ർ(?=[{CONS}])', 'ൎ', out)
    out = re.sub(f'ര്(?=[{CONS}])', 'ൎ', out)
    return re.sub(r'  +', ' ', out)
=======
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
    return out


def conv(seg):
    seg = seg.replace('||', ' ॥ ').replace('//', ' ॥ ').replace('/', ' । ').replace('|', ' । ')
    lead = ' ' if seg[:1].isspace() else ''
    trail = ' ' if seg[-1:].isspace() else ''
    # trailing punctuation is its own token, so a word-final m / ḥ is still seen as final
    toks = re.sub(r'(?<=\w)([.,;:]+)(?=\s|$)', r' \1', seg.lower()).split()
    out, run = [], []
    def flush():
        # The whole run is written as one word, so a nasal or consonant at a word end joins the next word's cluster;
        # chillu and anusvāra apply only at the end of the run.
        if run:
            out.append(conv_word(''.join(sandhi_words(run))))
            run.clear()
    for t in toks:
        if t in ('।', '॥') or re.fullmatch(r'[\d\-–—,;:.]+', t):
            flush()
            out.append(sanscript.transliterate(t, sanscript.IAST, sanscript.MALAYALAM) if t.isdigit() else t)
        else:
            run.append(t)
    flush()
    return lead + ' '.join(out) + trail

>>>>>>> origin/job-whish147-best

def line(l):
    s = l.strip()
    if not s or s.startswith('<') or re.fullmatch(r'\*\*[^*]+\*\*', s) or s == '---':
        return l
    m = re.match(r'^(\s*\d+\.\s+)(.*)$', l)
    head, body = (m.group(1), m.group(2)) if m else ('', l)
    return head + ''.join(p if PROTECT.fullmatch(p) else conv(p) for p in PROTECT.split(body))

<<<<<<< HEAD
def text(t):
    return '\n'.join(line(l) for l in t.split('\n'))

=======

def text(t):
    return '\n'.join(line(l) for l in t.split('\n'))


>>>>>>> origin/job-whish147-best
if __name__ == '__main__':
    print(json.dumps({k: text(v) for k, v in json.load(sys.stdin).items()}, ensure_ascii=False))
