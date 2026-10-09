#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/extract-84000-refs.py — reads the 84000 TEI from the data-tei GitHub repo, which (last commit 2025-02-16) carries only 3 Tengyur publications; 84000 now publishes 16 Tengyur texts, readable only through its public reader API (graphql.84000.co, the endpoint its own reader calls, no key). This fetches those passages, nothing else.
# Output is 84000 English (CC BY-NC-ND): evaluation input only, written under /root/tref, never committed, never written to pages.
#   python3 fetch-84000.py  (reads /root/tref/tengyur-published.json: toh, uuid per text, cut from the 84000 lobby by build-reference.py --lobby)
# fetch every passage of each published 84000 Tengyur text (eval-only; CC BY-NC-ND; never committed)
import json,urllib.request,time,os
Q='''query($uuid: ID!,$cursor:String,$limit:Int){work(uuid:$uuid){uuid passages(cursor:$cursor,limit:$limit){nodes{uuid label sort type json} pageInfo{nextCursor hasMoreAfter}}}}'''
def gql(v):
    r=urllib.request.Request("https://graphql.84000.co/api/graphql",data=json.dumps({"query":Q,"variables":v}).encode(),headers={"Content-Type":"application/json","apollo-require-preflight":"true"})
    return json.load(urllib.request.urlopen(r,timeout=180))
for o in json.load(open('/root/tref/tengyur-published.json')):
    fn=f"/root/tref/84000/{o['toh']}.json"
    if os.path.exists(fn): continue
    nodes=[];cur=None
    while True:
        d=gql({"uuid":o['uuid'],"limit":200,"cursor":cur})
        p=d['data']['work']['passages']; nodes+=p['nodes']
        if not p['pageInfo']['hasMoreAfter']: break
        cur=p['pageInfo']['nextCursor']; time.sleep(0.5)
    json.dump(nodes,open(fn,'w'),ensure_ascii=False)
    print(o['toh'],len(nodes),sum(n['type']=='translation' for n in nodes),flush=True)
