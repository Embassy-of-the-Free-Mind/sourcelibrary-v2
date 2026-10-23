"""IAST -> Malayalam script for the Whish 147 page texts (#7119, Derek's inbox notes of 2026-10-22 23:09).

PRIOR ART: build_editions.py uses the same indic_transliteration package the other way (Devanagari -> IAST). This
converts only the Sanskrit reading: <tags>, **labels**, [bracketed marks], row numbers, ‖ and the warning stay as
they are. r before a consonant is written as the dot-reph ൎ (U+0D4E), as this scribe (and Fable's own reads) do;
no other scribal habit is imitated.
Reads JSON {key: text} on stdin, writes JSON {key: malayalam_text} on stdout. Run with the job venv.
"""
import json, re, sys
from indic_transliteration import sanscript

PROTECT = re.compile(r'(\[[^\]]*\]|<[^>]+>|‖|\*\*[^*]+\*\*|\.\.\.|…|\?)')
CONS = 'ക-ഹ'

def conv(seg):
    seg = seg.replace('||', ' ॥ ').replace('//', ' ॥ ').replace('/', ' । ').replace('|', '।')
    out = sanscript.transliterate(seg.lower(), sanscript.IAST, sanscript.MALAYALAM)
    out = re.sub(f'ർ(?=[{CONS}])', 'ൎ', out)
    out = re.sub(f'ര്(?=[{CONS}])', 'ൎ', out)
    return re.sub(r'  +', ' ', out)

def line(l):
    s = l.strip()
    if not s or s.startswith('<') or re.fullmatch(r'\*\*[^*]+\*\*', s) or s == '---':
        return l
    m = re.match(r'^(\s*\d+\.\s+)(.*)$', l)
    head, body = (m.group(1), m.group(2)) if m else ('', l)
    return head + ''.join(p if PROTECT.fullmatch(p) else conv(p) for p in PROTECT.split(body))

def text(t):
    return '\n'.join(line(l) for l in t.split('\n'))

if __name__ == '__main__':
    print(json.dumps({k: text(v) for k, v in json.load(sys.stdin).items()}, ensure_ascii=False))
