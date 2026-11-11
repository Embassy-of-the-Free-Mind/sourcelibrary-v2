# python3 ingest.py <downloaded out-X.json> <RUN> [--team] : Gemini helper output -> $MS/runs/<RUN>/<id>.json (the shape
# run-claude.mjs writes); --team also writes $MS/set/team_proposals.json for the TEAM arm.
# PRIOR ART: round 2's ingest-agy.py + team-proposals.py (l7a scratch), merged.
import json, os, sys
from common import MS, jl, jd
d = jl(sys.argv[1]); run = sys.argv[2]; os.makedirs(MS + 'runs/' + run, exist_ok=True)
for k, v in d['out'].items():
    jd(dict(id=k, arm=run, model=d.get('model'), ok=v.get('ok'), parsed=v.get('parsed'), secs=v.get('secs'), attempt=v.get('attempt'), cls=v.get('cls')), MS + f'runs/{run}/{k}.json')
if '--team' in sys.argv:
    jd({k: v['parsed'] for k, v in d['out'].items() if v.get('parsed')}, MS + 'set/team_proposals.json')
print(run, len(d['out']), 'ok', sum(1 for v in d['out'].values() if v.get('ok')))
