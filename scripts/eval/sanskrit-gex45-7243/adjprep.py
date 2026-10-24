# PRIOR ART: none (adjudication briefs for #7243: the line-level R1/R2 differences handed to an Opus adjudicator). python3 adjprep.py in $JOB_SCRATCH.
import json, os, difflib, subprocess
J = os.environ['JOB_SCRATCH']
d = json.load(open('pages.json')); inp = {r['slug']: r for r in json.load(open('inputs.json'))['pages']}
same = []
for p in d['pages']:
    s = p['slug']; a = open(f'refwork/R1/{s}.txt').read().strip().split('\n'); b = open(f'refwork/R2/{s}.txt').read().strip().split('\n')
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False); blocks = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal': continue
        blocks.append('\n'.join([f'  R1 line {i1+1+k}: {a[i1+k]}' for k in range(i2 - i1)] + [f'  R2 line {j1+1+k}: {b[j1+k]}' for k in range(j2 - j1)]))
    if not blocks: same.append(s); continue
    tiles = '\n'.join(f'  {J}/{t}' for t in inp[s]['tiles'])
    o = p['observed']
    txt = f"""You are the adjudicator for the ground-truth transcription of one page in an OCR evaluation (#7243). Two readers transcribed the page independently from the same images; you settle every place where they differ by looking at the image, and write the final reference. Work only from the images and the two files; do not search the web or open any other file.

Page {s}. Catalogue: "{p['catalogue']['title']}". By eye: {o['kind']}, language {o['lang']}, layout {o['layout']}{', hard: ' + o['hard'] if o['hard'] else ''}.
Overview (orientation only): {J}/tiles/{s}-overview.jpg
Tiles in reading order (full resolution; neighbouring tiles overlap slightly; -c1 = left column/leaf, -c2 = right; -h1/-h2 = left/right pieces of the same strip):
{tiles}
Reader 1: {J}/refwork/R1/{s}.txt
Reader 2: {J}/refwork/R2/{s}.txt

The lines where they differ ({len(blocks)} places):
""" + '\n\n'.join(blocks) + f"""

How to decide:
1. For each difference, zoom on that line in the tiles and choose what the page shows: R1, R2, or a third reading if both are wrong. Do not average or guess from grammar or memory: a misprint or scribal error on the page stays; a famous text is copied as THIS page has it.
2. Keep the conventions both readers were given: every line as on the page in reading order (running head, numbers, verse numbers, footnotes, apparatus); superscript footnote markers as plain digits where they stand; dandas । ॥; Vedic accents (॑ ॒) only if printed; text in another script (Latin, Bengali) in that script, as printed; manuscript additions between lines or in margins on their own line starting "MARGIN: "; [?] once per akṣara nobody can read.
3. Also glance over the lines where both readers agree: if you see a shared error, fix it.
4. Write the final transcription to {J}/refwork/final/{s}.txt with the Write tool (only the text).
Then reply with at most 4 lines: how many differences you resolved to R1 / R2 / neither, your confidence in the final text (high/medium/low), and any place still doubtful."""
    open(f'refwork/adjprompts/{s}.txt', 'w').write(txt)
for s in same:
    open(f'refwork/final/{s}.txt', 'w').write(open(f'refwork/R1/{s}.txt').read())
print('identical (R1 taken):', same); print('to adjudicate:', len(os.listdir('refwork/adjprompts')))
