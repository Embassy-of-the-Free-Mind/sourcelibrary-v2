"""Cases for mlym.py (#7119). Run: <venv>/bin/python test_mlym.py — exits non-zero on a failure.
PRIOR ART: none — mlym.py had no tests; these pin the spot-check bugs of 2026-10-23 and the Kerala spellings."""
import sys
from mlym import text, line

CASES = [
    # the hole marker is never transliterated (was ‖ഹോലേ‖)
    ('3. -ṣṭā dṛṣṭe tathā py a- ‖hole‖ dṛṣṭe tra-', 'ഹോലേ', False),
    ('3. -ṣṭā dṛṣṭe tathā py a- ‖hole‖ dṛṣṭe tra-', ' ‖ ', True),
    ('7. -ryaṃ dhāryam pra- ‖hole', 'ഹോ', False),
    # bracketed marks pass through untouched
    ('5. draṣṭṛtvam [leaf: draṣṭṛtvam?] akartṛbhāvaś', '[leaf: draṣṭṛtvam?]', True),
    ('1. [illegible] nāsti', '[illegible]', True),
    # word-final t -> chillu l, joined to the next word (the leaf: ...ത്വാൽത്രിഗുണ)
    ('1. saṃghātaparārthatvāt triguṇādiviparyayād adhiṣṭhānāt', 'ത്വാൽത്രിഗുണ', True),
    ('1. saṃghātaparārthatvāt triguṇādiviparyayād adhiṣṭhānāt', 'ഷ്ഠാനാൽ', True),
    ('1. na vimucyate tasyā bandhanāt / nāpi', 'ബന്ധനാൽ', True),
    ('1. avyāptir iti cet-na / ukta', 'ചേൽ-ന', True),
    ('2. ayugapat-', 'യുഗപത്-', True),
    ('2. śeṣavat- śeṣaṃ li', 'ശേഷവൽ-', True),
    ('2. vartt- ‖ -tate', 'വൎത്ത്-', True),
    # word-final t before a vowel joins the vowel (tat eva -> തതേവ)
    ('1. tat eva', 'തതേവ', True),
    # dot-reph with the consonant after it doubled
    ('1. parārtha', 'പരാൎത്ഥ', True),
    ('1. dharmi', 'ധൎമ്മി', True),
    ('1. prakṛter mahāṃs', 'പ്രകൃതേൎമ്മഹാം', True),
    # ḥ before a sibilant doubles it; ṃ before a stop is the stop's nasal; no spaces between words
    ('1. viṣayaḥ sāmānya', 'വിഷയസ്സാമാന്യ', True),
    ('1. vyaktaṃ tathā', 'വ്യക്തന്തഥാ', True),
    # vowel + vowel across words keeps the independent vowel (not the diphthong ai)
    ('1. puruṣa ityarthaḥ', 'പുരുഷഇത്യൎത്ഥഃ', True),
    # quoted pratīkas are not avagraha
    ("5. -nnāha- 'rūpaiḥ'; ityādi", 'ഽ', False),
    ("5. -nnāha- 'rūpaiḥ'; ityādi", '‘രൂപൈഃ’', True),
    # a real avagraha stays one
    ("1. puruṣo 'sti", 'ഽ', True),
    # labels and tags are not transliterated
    ('**Rows of this leaf**', '**Rows of this leaf**', True),
]

bad = 0
for src, want, present in CASES:
    out = line(src)
    if (want in out) != present:
        bad += 1
        print(f'FAIL {src!r} -> {out!r}: expected {want!r} {"in" if present else "not in"} output')
print(f'{len(CASES) - bad}/{len(CASES)} passed')
sys.exit(1 if bad else 0)
