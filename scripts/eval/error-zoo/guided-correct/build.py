#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/repair-pilot/ (the #7809 set: 35 German pages with audit findings, an Opus blind
correction of each, and the frozen stored text; its gate STOPPED, nothing was written) and
scripts/batch/ocr-convergence/correct.mjs (the corrector; its --instruction-file appends one text to the prompt for a
whole run, so a per-page instruction means one run per page). No correction route reads the audits' findings: every
repair so far is a blind re-read. This builds the paired test of telling the corrector what was found.

Per page, two arms on the same frozen draft:
  A  blind: correct.mjs as the pilot ran it, one page a call, fresh
  B  guided: the same, plus the page's audit findings as reports that may be wrong, plus ONE planted false report
     (a decoy): a word the stored text and the blind correction both read the same, claimed to read as a one-letter
     variant. Applying the decoy puts an error into the text by construction; its acceptance rate is the cost of
     guiding.

build.py <pilot set dir> <out dir>   (writes out/draft/<id>.txt, out/{A,B}/<id>/manifest.jsonl, out/B/<id>/instruction.txt,
                                      out/decoys.jsonl). Reads files only.
"""
import json, os, re, sys, random, unicodedata
SET, OUT = sys.argv[1:3]
rng = random.Random(7809)
SWAP = {'e': 'c', 'c': 'e', 'n': 'u', 'u': 'n', 'i': 'l', 'l': 'i', 'h': 'b', 'b': 'h', 'a': 'o', 'o': 'a', 't': 'r', 'r': 't', 'm': 'n'}
MODERN = [(r'ff\b', 'f'), (r'ey', 'ei'), (r'th', 't'), (r'^vn', 'un'), (r'ck', 'k'), (r'ß', 'ss'), (r'ae', 'ä'), (r'tz', 'z')]
man = {json.loads(l)['page_id']: json.loads(l) for l in open(f'{SET}/manifest.jsonl')}
finds = {json.loads(l)['page_id']: json.loads(l) for l in open(f'{SET}/findings.jsonl')}
os.makedirs(f'{OUT}/draft', exist_ok=True)
INTRO = ("AUDIT REPORTS FOR THIS PAGE. An earlier proofreader compared this transcription with the image and reported the "
         "possible errors below. Some reports are wrong. Check each one against the image yourself: change the text "
         "only where the image shows the reported reading, and leave the text as it is where it does not. These reports "
         "do not replace your own reading of the whole page.\n")
decoys = []
for pid, m in man.items():
    stored = open(f'{SET}/stored/{pid}.txt').read()
    blind = open(f'{SET}/reads/{pid}.txt').read() if os.path.exists(f'{SET}/reads/{pid}.txt') else stored
    open(f'{OUT}/draft/{pid}.txt', 'w').write(stored)
    claims = []
    for lab in finds.get(pid, {}).get('labels', []):
        for e in lab['errors']:
            p = (e.get('problem') or '').strip()
            if p and p not in claims: claims.append(p)
    # decoy: a word of 6+ letters appearing exactly once in each of stored and blind, not named in any claim
    words = sorted(w for w in set(re.findall(r'\b[^\W\d_]{6,}\b', re.sub(r'<[^>]*>[^<]{0,40}</[^>]*>|<[^>]*>', ' ', stored))) if stored.count(w) == 1 and blind.count(w) == 1
             and not any(w.lower() in c.lower() for c in claims))
    rng.shuffle(words)
    decoy = None
    # Half the pages (alternating) get a plausible decoy: the word in modern spelling, the error a normalising reader
    # makes and a real wrong report looks like ("auff" reported as "auf"). The rest get a visual-confusion non-word.
    if len(decoys) % 2 == 0:
        for w in words:
            for pat, rep in MODERN:
                fake = re.sub(pat, rep, w, count=1)
                if fake != w and fake not in stored and fake not in blind:
                    decoy = dict(page_id=pid, word=w, fake=fake, kind='modernised'); break
            if decoy: break
    for w in ([] if decoy else words):
        idx = [i for i, ch in enumerate(w) if ch in SWAP and 0 < i < len(w) - 1]
        if not idx: continue
        i = rng.choice(idx); fake = w[:i] + SWAP[w[i]] + w[i + 1:]
        if fake in stored or fake in blind: continue
        decoy = dict(page_id=pid, word=w, fake=fake, kind='visual'); break
    if decoy:
        decoys.append(decoy); claims.append(f"'{decoy['word']}' — image '{decoy['fake']}'")
    rng.shuffle(claims)
    for arm in ('A', 'B'):
        os.makedirs(f'{OUT}/{arm}/{pid}', exist_ok=True)
        open(f'{OUT}/{arm}/{pid}/manifest.jsonl', 'w').write(json.dumps(m, ensure_ascii=False) + '\n')
    open(f'{OUT}/B/{pid}/instruction.txt', 'w').write(INTRO + '\n'.join(f'- {c}' for c in claims) + '\n')
with open(f'{OUT}/decoys.jsonl', 'w') as f:
    for d in decoys: f.write(json.dumps(d, ensure_ascii=False) + '\n')
print(f'{len(man)} pages; {len(decoys)} with a decoy; {sum(1 for p in man if finds.get(p))} with findings')
