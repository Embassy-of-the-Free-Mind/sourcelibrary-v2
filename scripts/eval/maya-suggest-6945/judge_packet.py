# Blind judge packets (#6903 stage 2): every attempted held-out block from every arm, mixed and shuffled, arm hidden;
# the judge sees Stuart's reading (transliteration, transcription, translation) and the candidate. Same verdict scale as
# rounds 1-2 (match / partial / wrong, for transliteration and gloss); no caption items (Palenque blocks have none).
# Usage: python3 judge_packet.py <tag> <run>...  -> $MS/runs/judge_key_<tag>.json (private map) + judge_prompts_<tag>.json
#        python3 judge_packet.py --tally   -> per-run verdict counts for the Opus and Gemini judges + Krippendorff alpha
# PRIOR ART: round 2's judge_packet.py / judge_tally.py / alpha.py (l7a scratch); same packet shape and alpha.
import json, random, sys, collections, glob
from common import MS, jl, jd
import score

PROMPT = """You are adjudicating machine readings of Maya hieroglyphic blocks from the Cross Group tablets at Palenque against David Stuart's PUBLISHED reading (the reference, 2006). You see only text. For each item decide how well the candidate matches the reference.

Compare cand_translit with ref_translit (one glyph block). Stuart's conventions: logograms UPPERCASE, syllables lowercase, numbers as digits, "?" uncertain, [ ] reconstructed, ( ) underspelled. Orthographic variants count as the same reading: b' / b, j / h, doubled vowels, glottal stops, a number written as a word (WAXAK = 8), a logographic vs syllabic spelling of the same word (K'AN-a-si-ya = K'anasiiy = the month K'ayab; ka-se-wa = Kaseew = K'ayab; mo-lo = Mol). ref_transcription and ref_translation give the reference's meaning.
  translit verdict: "match" = same reading of the block; "partial" = at least one sign/word of the reference is correctly present but the block reading differs (e.g. right period sign, wrong number); "wrong" = nothing of the reference reading is right.
  gloss verdict: does cand_gloss give the meaning this block has in the reference? "match" / "partial" / "wrong".

Judge strictly but fairly; do not reward vagueness ("a name" is wrong, not partial). Output ONLY JSON between the markers:
<<<BEGIN>>>
{"blocks":[{"jid":"b000","translit":"match|partial|wrong","gloss":"match|partial|wrong"}]}
<<<END>>>

ITEMS:
"""

def build(tag, runs):
    B = {b['bid']: b for it in jl(MS + 'set/items.json') for b in it['blocks']}
    items = []
    for run in runs:
        _, R = score.summary(run)
        for r in R:
            if r['role'] != 'heldout' or r['unread']: continue
            b = B[r['bid']]
            items.append(dict(run=run, bid=r['bid'], ref_translit=b['translit'], ref_transcription=b['transcription'], ref_translation=b['translation'],
                              cand_translit=r['cand'], cand_gloss=r['gloss']))
    random.Random(6945).shuffle(items)
    for n, x in enumerate(items): x['jid'] = f'{tag}b{n:03d}'
    jd(items, MS + f'runs/judge_key_{tag}.json')
    keep = ['jid', 'ref_translit', 'ref_transcription', 'ref_translation', 'cand_translit', 'cand_gloss']
    P = [dict(id=f'{tag}J{i // 60:02d}', prompt=PROMPT + json.dumps([{k: x[k] for k in keep} for x in items[i:i + 60]], ensure_ascii=False, indent=0), images=[])
         for i in range(0, len(items), 60)]
    jd(P, MS + f'runs/judge_prompts_{tag}.json'); print(len(items), 'items', len(P), 'packets')

def verdicts(judge):
    V = {}
    for f in glob.glob(MS + f'runs/judge_{judge}_*.json'):
        for p in jl(f).values():
            for b in ((p.get('parsed') or {}).get('blocks') or []): V[b['jid']] = b
    return V

def alpha(pairs):
    n = collections.Counter(v for p in pairs for v in p); N = sum(n.values()); cats = sorted(n)
    if N < 2: return float("nan")
    def d(c, k):
        lo, hi = min(c, k), max(c, k); s = sum(n[g] for g in cats if lo <= g <= hi) - (n[c] + n[k]) / 2; return s * s
    Do = sum(d(a, b) for a, b in pairs) * 2 / N
    De = sum(n[c] * n[k] * d(c, k) for c in cats for k in cats) / (N * (N - 1))
    return 1 - Do / De if De else 1.0

def tally():
    K = [x for f in sorted(glob.glob(MS + 'runs/judge_key_*.json')) for x in jl(f)]; O = verdicts('opus'); G = verdicts('gemini')
    t = collections.defaultdict(collections.Counter)
    for x in K:
        for w, V in (('O', O), ('G', G)):
            v = V.get(x['jid'], {}); t[x['run']][f"{w}_tr_{v.get('translit', 'NA')}"] += 1; t[x['run']][f"{w}_gl_{v.get('gloss', 'NA')}"] += 1
    for run in sorted(t): print(run, dict(sorted(t[run].items())))
    val = {'wrong': 0, 'partial': 1, 'match': 2}
    for f in ('translit', 'gloss'):
        pairs = [(val[O[k][f]], val[G[k][f]]) for k in O if k in G and O[k].get(f) in val and G[k].get(f) in val]
        print(f, 'pairs', len(pairs), 'alpha', round(alpha(pairs), 2), 'agree', sum(a == b for a, b in pairs))
    return t

if __name__ == '__main__':
    if sys.argv[1] == '--tally': tally()
    else: build(sys.argv[1], sys.argv[2:])
