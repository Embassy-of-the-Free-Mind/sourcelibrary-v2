#!/usr/bin/env python3
# PRIOR ART: REFERENCE-READER-BRIEF.example.txt and adjprep.py (this directory: the 7243 reader brief, of which only an
# example was kept, and the adjudication packets). The 7243 readers ran as Agent-tool subagents; this rebuilds the same
# reader brief from pages.json/inputs.json and runs both readers and the adjudicator as headless `claude -p --model opus`
# calls (the scripts/eval/spot-check/run-reviewers.sh shape), so the confirmation run (CONFIRM.md) needs no session to
# orchestrate them.
"""
  JOB_SCRATCH=<dir with pages.json, inputs.json, tiles/> python3 confirm-refs.py readers [--par 8]
  JOB_SCRATCH=... python3 adjprep.py            (writes refwork/adjprompts/, copies identical reads to refwork/final/)
  JOB_SCRATCH=... python3 confirm-refs.py adjudicate [--par 8]
Reads only the tiles; no reader or adjudicator is given a path to any engine output. Per call, a meta json
(claude -p result) lands in refwork/meta/. A call that ends without writing its file is retried once.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

J = os.environ['JOB_SCRATCH']; os.chdir(J)
mode = sys.argv[1]; par = int(sys.argv[sys.argv.index('--par') + 1]) if '--par' in sys.argv else 8
pages = json.load(open('pages.json'))['pages']; inp = {r['slug']: r for r in json.load(open('inputs.json'))['pages']}
for d in ('refwork/R1', 'refwork/R2', 'refwork/final', 'refwork/meta', 'refwork/prompts'): os.makedirs(d, exist_ok=True)


def reader_prompt(p, who):
    s = p['slug']; o = p['observed']
    tiles = '\n'.join(f'  {J}/{t}' for t in inp[s]['tiles'])
    hard = f", hard: {o['hard']}" if o.get('hard') else ''
    return f"""You are making a ground-truth transcription of one page for an OCR evaluation (#7243). Your text will be the reference that OCR engines are scored against, so exactness matters more than speed. Work only from the images; do not search the web or read any other file.

Page {s}. Catalogue: "{p['catalogue']['title']}". By eye: {o['kind']}, language {o['lang']}, layout {o['layout']}{hard}.

Images (open each with the Read tool):
  overview (whole page, orientation only, too small to read): {J}/tiles/{s}-overview.jpg
  tiles in reading order (full resolution):
{tiles}
Neighbouring strips overlap by a few pixels, so a line cut at a tile edge is whole on one of them: transcribe every line exactly once. {'Tiles -c1 are the left column, -c2 the right; read the whole left column, then the right. ' if o.get('cols') == 2 else ''}

Rules:
1. Write exactly what the page shows, character by character, in Unicode Devanagari (Latin-script text as printed). Do NOT correct misprints or scribal errors, expand abbreviations, split or join words differently, or fill anything from memory. Even if you recognise the text (scripture, a famous verse), copy the page, not the text you know.
2. One output line per line on the page. Include the running head, page or folio numbers, verse numbers (Devanagari digits if printed so), footnotes and apparatus, catchwords, superscript footnote markers (as plain digits where they stand), and any stamps or digitiser captions in Devanagari. Skip digitiser captions in Latin script (e.g. "Digitized by eGangotri").
3. Dandas as । and ॥. Vedic accent marks if printed (॑ udātta U+0951, ॒ anudātta U+0952). Avagraha ऽ. Keep virama, nukta, candrabindu ँ vs anusvāra ं exactly as written.
4. Manuscripts: transcribe the main text line by line; additions written between lines or in the margin go on their own line starting "MARGIN: ". Write a scribe's deleted text only if it is still legible and not struck out.
5. Unreadable: write your best reading; where you cannot guess at all, write [?] once per illegible akṣara.
6. Write ONLY the transcription to {J}/refwork/{who}/{s}.txt with the Write tool (UTF-8, no headings, no commentary inside the file).
Then reply with at most 4 lines: line count, overall confidence (high/medium/low), and the specific places you were unsure of."""


def run(prompt, out, meta):
    for attempt in ('', '.retry'):
        with open(meta + attempt + '.json', 'w') as mf, open(meta + attempt + '.err', 'w') as ef:
            subprocess.run(['claude', '-p', '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', 'Write'],
                           input=prompt, text=True, stdout=mf, stderr=ef, cwd=J, timeout=1800)
        if os.path.exists(out) and os.path.getsize(out) > 0: return 'ok'
    return 'FAILED'


jobs = []
if mode == 'readers':
    for p in pages:
        for who in ('R1', 'R2'):
            out = f"refwork/{who}/{p['slug']}.txt"
            if os.path.exists(out) and os.path.getsize(out) > 0: continue
            pr = reader_prompt(p, who); open(f"refwork/prompts/{who}-{p['slug']}.txt", 'w').write(pr)
            jobs.append((pr, out, f"refwork/meta/{who}-{p['slug']}"))
elif mode == 'adjudicate':
    for f in sorted(os.listdir('refwork/adjprompts')):
        s = f[:-4]; out = f'refwork/final/{s}.txt'
        if os.path.exists(out) and os.path.getsize(out) > 0: continue
        jobs.append((open(f'refwork/adjprompts/{f}').read(), out, f'refwork/meta/ADJ-{s}'))
with ThreadPoolExecutor(par) as ex:
    res = list(ex.map(lambda j: (j[1], run(*j)), jobs))
print(len(res), 'calls;', [o for o, r in res if r != 'ok'] or 'all ok')
