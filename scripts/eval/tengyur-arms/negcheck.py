#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-pilot-qa/ (PR #5676) and tengyur-ref/ found reversals with model
# judges only; `git grep -il "negation"` in scripts/lib finds note-claims.mjs's negation SKIP (a note
# that negates is not checked), not a detector. Nothing compares source negation with English negation.
"""
negcheck.py — lever E's detector (#5497): does the English negate where the Tibetan does?

  python3 scripts/eval/tengyur-arms/negcheck.py --src <tibetan> --en <english>      (library: flag_page)

Method, per page, $0:
  - Tibetan: the e-text is cut into shad segments; each carries a NEGATION count — whole syllables
    མ / མི / མེད / མིན (and མ་ཡིན, མི་འགྱུར… count once). Lexicalised compounds whose English is normally
    positive are not counted (མ་ལུས "all", མ་འོངས "future", མ་རིག "ignorance" …) and མི is read as "human"
    before a noun-marking syllable (མི་ཡི, མི་རྣམས, མི་ཡུལ …).
  - English: tags that are not translation (<meta>, <summary>, <keywords>, <note>, <gloss>) are removed,
    and the text is cut into sentences and verse lines; each carries an English negation count (not, no,
    never, nor, neither, none, nothing, without, cannot, n't, non-, un-/in-/im- words from a short list,
    -less, "free from", "absence", "lack").
  - ROLE: the page is also flagged when the English makes the Lord the subject of a speech verb more
    often than the Tibetan has him speak (བཀའ་སྩལ / གསུངས / ཞལ་ནས).
  - Both are placed on a 0–1 axis of the page (syllable share vs word share). A window of WIDTH slides by
    STEP; in each window the two counts are compared. A window where the Tibetan negates ≥ T_MIN times
    more than the English (or the English ≥ T_MIN more than the Tibetan) is a MISMATCH. The page is
    FLAGGED if any window mismatches; the flagged English sentences are returned for the second pass.
Parameters were picked on the tengyur-ref judges' inversion labels (in-sample; see the experiment file).
"""
import re, sys, json

WIDTH, STEP, T_MIN = 0.30, 0.04, 4

LEX = ["མ་ལུས", "མ་འོངས", "མ་རིག", "མ་ཚང", "མ་མོ", "མ་དང", "ཡུམ", "མ་ཧཱ", "མ་ཎི", "མ་ཎྜ", "མ་ཧེ", "མ་ལ་ཡ",
       "མི་ཡི", "མི་ཡིས", "མི་རྣམས", "མི་ཡུལ", "མི་དང", "མི་བདག", "མི་ཆོས", "མི་རྒྱལ", "མི་མ་ཡིན", "མི་ལ", "མི་ཡང",
       "མི་ཞིག", "མི་གཅིག", "མི་དག", "མི་ཕམ", "མི་བསྐྱོད"]
NEG = {"མ", "མི", "མེད", "མིན"}
EN_NEG = re.compile(r"\b(not|no|never|nor|neither|none|nothing|nobody|nowhere|without|cannot|absence|absent|lack|lacks|lacking|devoid|free from|non[- ]?\w+|\w+n't|\w+less|un(?!der|til|ity|ion|iverse|iversal|ique|it|its|ite|ited|less|to|veil)\w{3,}|in(?:finite|numerable|conceivable|expressible|exhaustible|destructible|separable|effable|admissible|correct|valid|complete|capable|ert)\w*|im(?:permanent|permanence|possible|measurable|mutable|pure|purity|movable|perishable)\w*|ignoran\w+|beyond)\b", re.I)


LORD = re.compile(r"\b(Blessed One|Bhagavan|Bhagavat|Lord|Buddha|Tathagata|Tathāgata|Teacher)\b[^.\"“]{0,25}?\b(said|says|taught|teaches|spoke|speaks|replied|replies|addressed|addresses|declared|declares|answered|answers|stated|states|asked)\b", re.I)


def strip_en(t):
    t = re.sub(r"<(meta|summary|keywords|note|gloss)[^>]*>[\s\S]*?</\1>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return t


def tib_units(src):
    s = re.sub(r"\{[^}]*\}|\[|\]|#|[༄༅]", "", src)
    for lx in LEX:
        s = s.replace(lx, "་".join(["Ⓛ"] * len(lx.split("་"))))
    out = []
    for seg in re.split(r"[།༎]+", s):
        sy = [x for x in re.split(r"[་\s]+", seg) if x]
        if not sy: continue
        n, i = 0, 0
        while i < len(sy):
            if sy[i] in NEG:
                n += 1
                # a run of negation syllables (མ་ཡིན་ནོ, མི་འགྱུར་མ་ཡིན) counts once per 3 syllables
                i += 2
                continue
            i += 1
        out.append((seg, len(sy), n))
    return out


def en_units(en):
    t = strip_en(en)
    parts = [p.strip() for p in re.split(r"(?<=[.;:?!])\s+|\n+", t) if p.strip()]
    return [(p, len(p.split()), len(EN_NEG.findall(p))) for p in parts]


def axis(units):
    tot = sum(u[1] for u in units) or 1
    pos, out = 0, []
    for u in units:
        out.append((pos / tot, (pos + u[1]) / tot, u))
        pos += u[1]
    return out


def flag_page(src, en, width=WIDTH, step=STEP, t_min=T_MIN):
    T, E = axis(tib_units(src)), axis(en_units(en))
    if not T or not E: return {"flag": False, "windows": [], "sentences": []}
    wins, sents = [], set()
    x = 0.0
    while x < 1.0:
        a, b = x, x + width
        tn = sum(u[2] for s, e, u in T if (s + e) / 2 >= a and (s + e) / 2 < b)
        en_ = [u for s, e, u in E if (s + e) / 2 >= a and (s + e) / 2 < b]
        nn = sum(u[2] for u in en_)
        if abs(tn - nn) >= t_min:
            wins.append({"at": round(a, 2), "tib_neg": tn, "en_neg": nn})
            for u in en_: sents.add(u[0])
        x += step
    # ROLE: the English makes the Lord the speaker more often than the Tibetan has him speak (བཀའ་སྩལ /
    # གསུངས / ཞལ་ནས) — the vocative-as-speaker and addressee-as-speaker shapes the ref judges found.
    t = strip_en(en)
    lord_en = LORD.findall(t)
    lord_tib = len(re.findall(r"བཀའ་སྩལ|གསུངས|ཞལ་ནས", src))
    role = len(lord_en) > lord_tib
    if role:
        for p in re.split(r"(?<=[.;:?!])\s+|\n+", t):
            if LORD.search(p): sents.add(p.strip())
    return {"flag": bool(wins) or role, "negation": bool(wins), "role": role, "windows": wins, "sentences": sorted(sents)[:8],
            "tib_neg_total": sum(u[2] for _, _, u in T), "en_neg_total": sum(u[2] for _, _, u in E)}


if __name__ == "__main__":
    a = sys.argv
    src = open(a[a.index("--src") + 1]).read(); en = open(a[a.index("--en") + 1]).read()
    print(json.dumps(flag_page(src, en), ensure_ascii=False, indent=1))
