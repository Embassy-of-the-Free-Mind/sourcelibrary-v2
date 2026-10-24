#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/parse_rkts.py (reads rKTs' Unicode strings as they are; converts nothing);
corpus.py there (cleans Unicode lines; no Latin input). Nothing in the repo turns a scholarly Latin transliteration of
Classical Mongolian into Unicode Mongolian script.

Latin transliteration of Classical Mongolian (the Poppe/Kara/Ligeti convention used by Muzraeva, Mirzaeva and the rKTs
Glass databank: γ ǰ č š ö ü, q/k, Galik digraphs) -> Unicode Mongolian script, in the convention the synthetic training
labels use (#5664): q,k -> U+182C; γ,g -> U+182D; o U+1823, u U+1824, ö U+1825, ü U+1826; a hyphenated suffix is joined
with NNBSP (U+202F); a detached final a/e (ner-e, dady-a) with MVS (U+180E); ':' -> U+1803, '::' -> U+1804.

It is a graphemic mapping, not a spelling normaliser: it writes what the editor transliterated. Galik letters are kept
where the transliteration marks them (h -> U+183E, so dh/bh/kh come out as d+HAA etc.; z, ž, c, x as below).

  python3 translit.py "qutuγ-tu nasun kiged čaγlasi ügei"     -> Unicode
"""
import re, sys, unicodedata

NNBSP, MVS = ' ', '᠎'
DIGRAPH = {'ng': 'ᠩ'}
LETTER = {
    'a': 'ᠠ', 'e': 'ᠡ', 'i': 'ᠢ', 'o': 'ᠣ', 'u': 'ᠤ', 'ö': 'ᠥ', 'ü': 'ᠦ',
    'n': 'ᠨ', 'b': 'ᠪ', 'p': 'ᠫ', 'q': 'ᠬ', 'k': 'ᠬ', 'x': 'ᠬ', 'γ': 'ᠭ',
    'g': 'ᠭ', 'm': 'ᠮ', 'l': 'ᠯ', 's': 'ᠰ', 'š': 'ᠱ', 't': 'ᠲ', 'd': 'ᠳ',
    'č': 'ᠴ', 'c': 'ᠴ', 'ǰ': 'ᠵ', 'j': 'ᠵ', 'y': 'ᠶ', 'r': 'ᠷ', 'w': 'ᠸ',
    'v': 'ᠸ', 'f': 'ᠹ', 'h': 'ᠾ', 'z': 'ᠽ', 'ž': 'ᡁ',
    # Sanskrit/Galik diacritics that the print does not distinguish
    'ā': 'ᠠᠠ', 'ī': 'ᠢ', 'ū': 'ᠤ', 'ō': 'ᠣ', 'ñ': 'ᠨ', 'ň': 'ᠨ', 'ṇ': 'ᠨ',
    'ṅ': 'ᠩ', 'ṭ': 'ᠲ', 'ḍ': 'ᠳ', 'ś': 'ᠱ', 'ṣ': 'ᠱ', 'ṛ': 'ᠷᠢ', 'ṃ': 'ᠨ',
    'ḥ': '',
}
DROP = set("’‘'`ʼ")


def letters(seg):
    out, i, s = [], 0, seg.lower()
    while i < len(s):
        if s[i:i + 2] in DIGRAPH and not (i + 2 < len(s) and s[i + 2] in 'aeiouöü' and s[i + 1] == 'g' and False):
            out.append(DIGRAPH[s[i:i + 2]]); i += 2; continue
        ch = s[i]
        if ch in DROP:
            i += 1; continue
        if ch in LETTER:
            out.append(LETTER[ch])
        elif unicodedata.category(ch).startswith('L'):
            base = unicodedata.normalize('NFD', ch)[0]
            out.append(LETTER.get(base, ''))
        i += 1
    return ''.join(out)


def word(w):
    """One space-delimited transliterated word -> Unicode (hyphen parts joined by NNBSP / MVS)."""
    parts = [p for p in w.split('-') if p != '']
    if not parts:
        return ''
    out = letters(parts[0])
    for p in parts[1:]:
        u = letters(p)
        if not u:
            continue
        out += (MVS if p.lower() in ('a', 'e') else NNBSP) + u
    return out


def to_mong(text):
    """A transliterated string -> Unicode Mongolian. Punctuation: '::' -> ᠄, ':' or '.' -> ᠃, ',' -> ᠂."""
    toks = re.findall(r'::|:|[.,;]|[^\s:.,;]+', text)
    out = []
    for t in toks:
        if t == '::':
            out.append('᠄')
        elif t in (':', '.', ';'):
            out.append('᠃')
        elif t == ',':
            out.append('᠂')
        else:
            u = word(t)
            if u:
                out.append(u)
    # punctuation attaches to the word before it, as in the print and in the training labels
    s = ' '.join(out)
    return re.sub(r' ([᠂᠃᠄])', r'\1', s)


if __name__ == '__main__':
    print(to_mong(' '.join(sys.argv[1:]) if len(sys.argv) > 1 else sys.stdin.read()))
