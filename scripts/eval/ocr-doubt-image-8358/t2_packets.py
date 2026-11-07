#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-error-to-translation-7611/judge.py task shape and its planted controls (misreads planted
# in the TRANSCRIPTION, controls.jsonl.gz, reused here as 12 of the pages). This builds the #8358 test-2 packets: every
# English (text arm, image arm, text arm again) under a blind id, the known error spots, plus judge controls: English
# with a planted wrong number, packets with another page's image, and repeats. Read-only.
#   python3 t2_packets.py <scratch>
import json, os, random, re, sys, hashlib
S = sys.argv[1].rstrip('/')
pages = json.load(open(f'{S}/pages.json')); tasks = json.load(open(f'{S}/t2/tasks.json'))
rng = random.Random(83582)
bid = lambda s: 'x' + hashlib.sha256(('8358' + s).encode()).hexdigest()[:10]
out, key = [], []
def spots_of(t):
    return [f"{i+1}. The page has: {s['image_reading']}\n   The transcription has: {s['quote']}" for i, s in enumerate(t['spots'])]
outputs = {}
for arm in ('text', 'image', 'text2'):
    for t in tasks:
        r = json.load(open(f"{S}/t2/{arm}/{t['key']}.json"))
        outputs[(arm, t['key'])] = r
        k = bid(arm + t['key'])
        out.append({'key': k, 'image': pages[t['page_id']]['image_file'], 'transcription': t['ocr_text'], 'english': r['english'], 'spots': spots_of(t)})
        key.append({'key': k, 'arm': arm, 'task': t['key'], 'kind': t['kind'], 'control': None})
# Planted English: a number changed in 8 outputs (4 text, 4 image) that print one outside tags.
def numbers(e):
    body = re.sub(r'<[^>]+>[^<]*</[^>]+>', lambda m: ' ' * len(m.group(0)), e)
    return [m for m in re.finditer(r'(?<![\w.])\d{1,4}(?![\w.])', body)]
for arm in ('text', 'image'):
    cands = [t for t in tasks if numbers(outputs[(arm, t['key'])]['english'])]
    for t in rng.sample(cands, 4):
        e = outputs[(arm, t['key'])]['english']; m = rng.choice(numbers(e)); old = m.group(0)
        new = str(int(old) + rng.choice([3, 7, 11])) if int(old) > 9 else str((int(old) + rng.choice([3, 4, 5])) % 10 or 6)
        k = bid('plant-en' + arm + t['key'])
        out.append({'key': k, 'image': pages[t['page_id']]['image_file'], 'transcription': t['ocr_text'], 'english': e[:m.start()] + new + e[m.end():], 'spots': spots_of(t)})
        key.append({'key': k, 'arm': arm, 'task': t['key'], 'kind': t['kind'], 'control': {'type': 'planted_english', 'old': old, 'new': new, 'context': e[max(0, m.start() - 60):m.end() + 60]}})
# Wrong page: 2 per arm, another book's image.
for arm in ('text', 'image'):
    for t in rng.sample(tasks, 2):
        other = rng.choice([p for p in pages.values() if p['book_id'] != t['book_id']])
        k = bid('wrong' + arm + t['key'])
        out.append({'key': k, 'image': other['image_file'], 'transcription': t['ocr_text'], 'english': outputs[(arm, t['key'])]['english'], 'spots': spots_of(t)})
        key.append({'key': k, 'arm': arm, 'task': t['key'], 'kind': t['kind'], 'control': {'type': 'wrong_page', 'image_of': other['page_id']}})
# Repeats: 5 outputs judged twice.
for arm, t in rng.sample([(a, t) for a in ('text', 'image') for t in tasks], 5):
    k = bid('rep' + arm + t['key'])
    out.append({'key': k, 'image': pages[t['page_id']]['image_file'], 'transcription': t['ocr_text'], 'english': outputs[(arm, t['key'])]['english'], 'spots': spots_of(t)})
    key.append({'key': k, 'arm': arm, 'task': t['key'], 'kind': t['kind'], 'control': {'type': 'repeat', 'of': bid(arm + t['key'])}})
rng.shuffle(out)
json.dump(out, open(f'{S}/t2/judge-tasks.json', 'w'), ensure_ascii=False)
json.dump(key, open(f'{S}/t2/judge-key.json', 'w'), ensure_ascii=False)
print(len(out), 'packets')
