# PRIOR ART: scripts/eval/mongol-synth-5664/judge.mjs (claude -p call with the API key stripped, adapted).
# Test 3: can Opus produce the Beijing Kanjur's Mongolian title from the Tibetan (+ Sanskrit)?  claude -p, subscription.
import json,subprocess,os,sys,concurrent.futures as cf
items=[json.loads(l) for l in open('items.jsonl')]
P="""You are a specialist in the Mongolian Buddhist canon. For each text below you are given the Tibetan title (Wylie) and, where known, the Sanskrit title, of a text in the Kanjur. Give the Mongolian title of the same text AS PRINTED in the Beijing Mongolian Kanjur of 1718-1720 (the red-ink xylograph): the classical Mongolian translation of the title, in its 18th-century orthography.
Give it twice: (1) in Unicode traditional Mongolian script (U+1800 block), words separated by spaces, case suffixes as separate words where the script writes them separately; (2) in standard scholarly transliteration (Poppe/Lessing style: q, γ, k, g, č, ǰ, ö, ü).
Do not refuse and do not explain; if unsure, give your best reconstruction.
Return ONLY a JSON object mapping each id to {"script": "...", "translit": "..."}.

"""
def call(batch):
    body="\n".join(f'{it["k"]}: Tibetan: {it["tib"]}' + (f' | Sanskrit: {it["skt"]}' if it['skt'] else '') for it in batch)
    env={k:v for k,v in os.environ.items() if k not in('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN')}
    r=subprocess.run([os.path.expanduser('~/.local/bin/claude'),'-p','--model','opus','--tools','','--strict-mcp-config','--no-session-persistence','--output-format','json'],input=P+body,capture_output=True,text=True,env=env,timeout=900)
    t=json.loads(r.stdout)['result']
    s=t[t.index('{'):t.rindex('}')+1]
    return json.loads(s)
out={}
with cf.ThreadPoolExecutor(4) as ex:
    for d in ex.map(call,[items[i:i+10] for i in range(0,40,10)]): out.update(d)
json.dump(out,open('opus.json','w'),ensure_ascii=False,indent=1)
print(len(out))
