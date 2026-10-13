#!/usr/bin/env python3
# PRIOR ART: scripts/eval/second-reader/draw.mjs (draws pages from OUR corpus; these sets are external) and the
# planted-span controls of #6388 (scripts/eval/second-reader/*: planted errors in a READ for an adjudicator to catch;
# here they go into the DRAFT a corrector is given, to measure anchoring). none fits a published external set.
"""
Build the request files for the #6547 replications. Data lives under $JOB_SCRATCH, never in the repo.

  python3 prep.py greif   --root $JOB_SCRATCH   # 30 pages: ocr, corr (Transkribus draft), corr-anchor (planted)
  python3 prep.py bentham  --root $JOB_SCRATCH   # 33 Bentham R0 test pages: one read request per page
  python3 prep.py bentham2 --root $JOB_SCRATCH   # after the pro/flash/opus reads: resolver, correction, anchoring

Writes <root>/<set>/req/*.jsonl ({uid, prompt, image}) and <root>/<set>/plants.json (the anchoring key).
"""
import argparse, glob, json, os, random, re, sys

SENT = ('Write the transcription between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the '
        'markers: no preamble, no plan, no summary, no offers, no questions.')  # cli-chatter.mjs OCR_SENTINEL_INSTRUCTION (#6523)


def plant(draft, gt_norm, rng, n=3):
    """Plant n errors that are not on the page into a correct stretch of the draft: one digit change in a number,
    the rest a word swapped for another word of the same page (in-domain, plausible). A site qualifies only when its
    context bigram is also in the reference, i.e. the draft was right there. Returns (planted_draft, plants)."""
    lines = draft.split('\n')
    sites = []
    for li, line in enumerate(lines):
        toks = line.split(' ')
        for ti in range(1, len(toks)):
            t, prev = toks[ti], toks[ti - 1]
            core = re.sub(r'[^\w]', '', t)
            if not core or len(prev) < 2:
                continue
            if f'{norm(prev)} {norm(t)}' not in gt_norm:
                continue
            if re.fullmatch(r'\d{2,4}', core):
                sites.append(('num', li, ti))
            elif core.isalpha() and len(core) >= 5:
                sites.append(('word', li, ti))
    words = sorted({re.sub(r'[^\w]', '', w) for w in draft.split() if re.sub(r'[^\w]', '', w).isalpha() and len(re.sub(r'[^\w]', '', w)) >= 5})
    rng.shuffle(sites)
    want = ['num'] + ['word'] * (n - 1)
    plants, used_lines = [], set()
    for kind in want:
        pool = [s for s in sites if s[0] == kind and s[1] not in used_lines] or [s for s in sites if s[1] not in used_lines]
        if not pool:
            break
        k, li, ti = pool[0]
        sites.remove(pool[0])
        toks = lines[li].split(' ')
        orig = toks[ti]
        core = re.sub(r'[^\w]', '', orig)
        if k == 'num':
            i = rng.randrange(len(core)); d = rng.choice([c for c in '0123456789' if c != core[i] and not (i == 0 and c == '0')])
            new_core = core[:i] + d + core[i + 1:]
        else:
            cands = [w for w in words if w.lower() != core.lower() and w.lower() not in lines[li].lower() and w[0].isupper() == core[0].isupper()]
            if not cands:
                continue
            new_core = rng.choice(cands)
        new = orig.replace(core, new_core, 1)
        toks[ti] = new
        lines[li] = ' '.join(toks)
        nxt = toks[ti + 1] if ti + 1 < len(toks) else ''
        before = ' '.join(lines[:li]).split() + toks[:ti]
        after = toks[ti + 1:] + ' '.join(lines[li + 1:]).split()
        plants.append({'kind': k, 'line': li, 'prev': toks[ti - 1], 'orig': orig, 'planted': new, 'next': nxt,
                       'left': before[-3:], 'right': after[:2]})  # the scorer finds the site by these, not by a bigram
        used_lines.add(li)
    return '\n'.join(lines), plants


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', s.lower())).strip()


def greif(root):
    repo = os.path.join(root, 'llm_historical_dataset_benchmarking')
    base = open(os.path.join(repo, 'src/prompts/llm_img2txt/gemini-3.1.txt'), encoding='utf-8').read().strip()
    out = os.path.join(root, 'greif', 'req'); os.makedirs(out, exist_ok=True)
    rows = {'ocr': [], 'corr': [], 'corr-anchor': []}
    rng = random.Random(6547)
    anchor_docs = sorted(rng.sample(range(1, 11), 4))  # 4 whole documents = 12 pages, so they can be scored as documents
    plants = {}
    for d in range(1, 11):
        gt_norm = norm(open(os.path.join(repo, f'data/ground_truth/txt/type-{d}.txt'), encoding='utf-8').read())
        for p in (1, 2, 3):
            uid = f'type-{d}-p{p}'
            img = os.path.join(root, 'greif', 'png', f'type-{d}-{p}.png')
            draft = open(os.path.join(repo, f'results/ocr_img2txt/transkribus/type-{d}/run_01/page_by_page/page_{p:04d}.txt'), encoding='utf-8').read()
            rows['ocr'].append({'uid': uid, 'image': img, 'prompt': f'{base}\n\n{SENT}'})
            corr = lambda t: (f"{base}\n\n"
                              "Below is the OCR output from Transkribus so you know how to spell the archaic words. Please use this information to correct any errors and ensure the text is fully compliant with the strict transcription rules.\n"
                              "-- OCR Output (Transkribus) --\n"
                              f"{t}\n\n{SENT}")  # gemini-3.1_with_transkribusOCR.py multimodal_ocr_correction, verbatim + sentinels
            rows['corr'].append({'uid': uid, 'image': img, 'prompt': corr(draft)})
            if d in anchor_docs:
                pd, pl = plant(draft, gt_norm, rng)
                plants[uid] = pl
                rows['corr-anchor'].append({'uid': uid, 'image': img, 'prompt': corr(pd)})
    for k, v in rows.items():
        with open(os.path.join(out, f'{k}.jsonl'), 'w', encoding='utf-8') as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in v)
    json.dump({'anchor_docs': anchor_docs, 'plants': plants}, open(os.path.join(root, 'greif', 'plants.json'), 'w'), ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in rows.items()}, 'anchor docs', anchor_docs, 'plants', sum(len(v) for v in plants.values()))


# Transcription Pearl (github.com/mhumphries2323/Transcription_Pearl, TranscriptionPearl_beta-2024111.py L609-618), the
# prompts of Humphries et al. 2024. Their closing "write 'Transcription:' followed by…" label is replaced by the
# #6523 sentinel line, which the CLI route needs; nothing else is changed.
PEARL_HTR = ('Your task is to accurately transcribe handwritten historical documents, minimizing the CER and WER. Work '
             'character by character, word by word, line by line, transcribing the text exactly as it appears on the page. '
             'To maintain the authenticity of the historical text, retain spelling errors, grammar, syntax, and punctuation '
             'as well as line breaks. Transcribe all the text on the page including headers, footers, marginalia, '
             'insertions, page numbers, etc. If these are present, insert them where indicated by the author (as '
             'applicable).\n\nCarefully transcribe this page from an 18th/19th century document.')
PEARL_CORR = ('Your task is to compare handwritten pages of text with corresponding draft transcriptions, correcting the '
              'transcription to produce an accurate, publishable transcript. Be sure that the spelling, syntax, '
              'punctuation, and line breaks in the transcription match those on the handwritten page to preserve the '
              'historical integrity of the document. Numbers also easily misread, so pay close attention to digits. You '
              'must also ensure that the transcription begins and ends in the same place as the handwritten document. '
              'Include any catchwords at the bottom of the page.\n\nYour task is to use the handwritten page image to '
              'correct the following transcription, retaining the spelling, syntax, punctuation, line breaks, catchwords, '
              'etc of the original.\n\n{text}')
RESOLVE = ('Three independent readers transcribed this handwritten page. The transcription below is the first reader\'s. '
           'Where the other readers disagreed with it, the passage is marked [[A: … | B: … | C: …]], giving each '
           'reader\'s version (A is the first reader; an empty version means that reader had no text there).\n\n'
           'Look at the page image and resolve every marked passage: write what the page actually shows there, which may '
           'be one of the versions or none of them. Leave the unmarked text exactly as it is. Keep the line breaks.\n\n{text}')


def bentham_gt(root):
    import xml.etree.ElementTree as ET
    ns = {'p': 'http://schema.primaresearch.org/PAGE/gts/pagecontent/2010-03-19'}
    base = os.path.join(root, 'bentham', 'BenthamDatasetR0-GT')
    ids = [l.strip() for l in open(os.path.join(base, 'Partitions', 'Test.lst')) if l.strip()]
    gt = {}
    for i in ids:
        # Lines sorted top to bottom by their centre. The file's region order is not reading order: 097_186_001 puts a
        # page's second half in a region before its first (pilot, #6547). An interlinear insertion sorts just above its line.
        t = ET.parse(os.path.join(base, 'PAGE', f'{i}.xml')).getroot()
        lines = []
        for ln in t.findall('.//p:TextLine', ns):
            u = ln.find('./p:TextEquiv/p:Unicode', ns)
            pts = [tuple(map(int, p.split(','))) for p in ln.find('./p:Coords', ns).get('points').split()]
            if u is not None and (u.text or '').strip():
                lines.append((sum(y for _, y in pts) / len(pts), min(x for x, _ in pts), u.text.strip()))
        gt[i] = '\n'.join(t for _, _, t in sorted(lines))
    return gt


def bentham(root):
    gt = bentham_gt(root)
    out = os.path.join(root, 'bentham', 'req'); os.makedirs(out, exist_ok=True)
    json.dump(gt, open(os.path.join(root, 'bentham', 'gt.json'), 'w'), ensure_ascii=False, indent=1)
    with open(os.path.join(out, 'read.jsonl'), 'w', encoding='utf-8') as f:
        for i in gt:
            img = os.path.join(root, 'bentham', 'BenthamDatasetR0-Images', 'Images', 'Pages', f'{i}.jpg')
            f.write(json.dumps({'uid': i, 'image': img, 'prompt': f'{PEARL_HTR}\n\n{SENT}'}) + '\n')
    print('bentham reads', len(gt), 'pages,', sum(len(v) for v in gt.values()), 'chars,', sum(len(v.split()) for v in gt.values()), 'words')


def bentham_stage2(root):
    """After the three reads: the resolver requests (primary + marked disagreements) and the correction requests
    (the Flash read as the draft, the stand-in for an HTR draft), plus 10 anchoring pages with 3 planted errors."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from textmetrics import unwrap, failed_kind
    from disagree import load, disagreement_spans, render_marked
    b = os.path.join(root, 'bentham')
    gt = json.load(open(os.path.join(b, 'gt.json')))
    reads = {k: load(os.path.join(b, 'out', f'{k}.jsonl')) for k in ('pro', 'flash', 'opus')}
    img = lambda i: os.path.join(b, 'BenthamDatasetR0-Images', 'Images', 'Pages', f'{i}.jpg')
    res, corr, anch, plants = [], [], [], {}
    rng = random.Random(6547)
    for i in gt:
        rows = {k: reads[k].get(i) for k in reads}
        if all(not failed_kind(r) for r in rows.values()):
            texts = {k: unwrap(r['text'])[0] for k, r in rows.items()}
            spans = disagreement_spans(texts['pro'], [texts['flash'], texts['opus']])
            if spans:
                res.append({'uid': i, 'image': img(i), 'prompt': RESOLVE.format(text=render_marked(texts['pro'], [texts['flash'], texts['opus']], spans)) + f'\n\n{SENT}'})
        if not failed_kind(rows['flash']):
            draft = unwrap(rows['flash']['text'])[0]
            corr.append({'uid': i, 'image': img(i), 'prompt': PEARL_CORR.format(text=draft) + f'\n\n{SENT}'})
    pool = [r['uid'] for r in corr]
    for i in sorted(rng.sample(pool, min(10, len(pool)))):
        draft = unwrap(reads['flash'][i]['text'])[0]
        pd, pl = plant(draft, norm(gt[i]), rng)
        plants[i] = pl
        anch.append({'uid': i, 'image': img(i), 'prompt': PEARL_CORR.format(text=pd) + f'\n\n{SENT}'})
    for k, v in (('resolve', res), ('corr', corr), ('corr-anchor', anch)):
        with open(os.path.join(b, 'req', f'{k}.jsonl'), 'w', encoding='utf-8') as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in v)
    json.dump({'plants': plants}, open(os.path.join(b, 'plants.json'), 'w'), ensure_ascii=False, indent=1)
    print({'resolve': len(res), 'corr': len(corr), 'corr-anchor': len(anch), 'plants': sum(len(v) for v in plants.values())})


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('set'); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    a = ap.parse_args()
    {'greif': lambda: greif(a.root), 'bentham': lambda: bentham(a.root), 'bentham2': lambda: bentham_stage2(a.root)}.get(a.set, lambda: sys.exit(f'unknown set {a.set}'))()
