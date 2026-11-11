"""Malayalam script -> IAST, mechanical, for the fresh Opus reads of Whish 147 (#7119).
PRIOR ART: ../whish147-line-strips-2026-10-22/score-lines.py mal2iast(fix) — the same mapping (dot reph and chillu
letters as consonant + virama, the single e/o signs as e/o); here bracketed marks, ‖ and row numbers are kept.
Reads JSON {key: text} on stdin, writes JSON {key: iast} on stdout. Run with the job venv."""
import json, re, sys
from indic_transliteration import sanscript as s
PROTECT = re.compile(r'(\[[^\]]*\]|<[^>]+>|‖|\*\*[^*]+\*\*)')
def conv(seg):
    for a, b in (('ൎ', 'ര്'), ('ൽ', 'ല്'), ('ൻ', 'ന്'), ('ർ', 'ര്'), ('ൾ', 'ള്'), ('ൺ', 'ണ്')): seg = seg.replace(a, b)
    return s.transliterate(seg, s.MALAYALAM, s.IAST).replace('è', 'e').replace('ò', 'o')
def line(l):
    m = re.match(r'^(\s*\d+\.\s+)(.*)$', l)
    head, body = (m.group(1), m.group(2)) if m else ('', l)
    return head + ''.join(p if PROTECT.fullmatch(p) else conv(p) for p in PROTECT.split(body))
print(json.dumps({k: '\n'.join(line(l) for l in v.split('\n')) for k, v in json.load(sys.stdin).items()}, ensure_ascii=False))
