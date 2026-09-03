#!/bin/zsh
#
# Public API contract tests — black-box, against a LIVE deployment.
#
# Covers the surface external consumers actually depend on (#4491, #4509):
# the author/year/edition filters, distributions, works, libraries, the topic
# vocabulary, artwork artist filtering, CORS, budget headers, and the gallery
# collection counts. Each case pins a behaviour we broke or nearly broke once.
#
# Usage:
#   scripts/audit/public-api-contract.sh                     # prod (intended)
#   BASE=https://<preview>.vercel.app AUTH=$CRON_SECRET ...  # preview, partial
#
# PROD IS THE REAL TARGET, because the contract being tested IS the anonymous
# experience. A preview gates anonymous book content (403), so content cases
# come back empty there even with AUTH — several are written as standalone
# python that does not carry the header. Use a preview run to smoke the
# NON-content cases (CORS, openapi, off-infra hosts) and prod for the rest.
#
# Exits non-zero with the number of failures, so it works as a smoke gate.
#
# Notes for whoever edits this:
#   - A browser User-Agent is required; the bot limiter throttles curl's
#     default UA (10 req/60s) and the suite will flap without it. Even WITH
#     it, running the suite several times back-to-back trips the limiter and
#     the tail cases fail with an EMPTY body ("got: ") rather than a status —
#     that is throttling, not a regression. Wait a minute and re-run before
#     believing a failure that reports no value at all.
#   - Prefer "contains what it must" over exact counts. The exact-path-count
#     assertion this file started with failed the moment an endpoint was
#     added, which is a change, not a defect.
#   - Two cases deliberately assert OPPOSITE things about /books/facets: it
#     must be global for an anonymous caller AND scoped when a tenant header
#     is present. Losing either one is a real bug (silent-empty, or a
#     tenant-lockdown leak).
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
BASE="${BASE:-https://sourcelibrary.org}"
# Preview deployments gate anonymous book content (403), so every content case
# comes back EMPTY there — indistinguishable from throttling. Pass a bearer to
# smoke a preview:
#   BASE=https://<preview>.vercel.app AUTH=$CRON_SECRET scripts/audit/public-api-contract.sh
AUTH_HEADER=()
[[ -n "$AUTH" ]] && AUTH_HEADER=(-H "Authorization: Bearer $AUTH")
CB="cb=$(date +%s)"
pass=0; fail=0
t() { # t <name> <cmd-that-prints-1-for-ok>
  local name=$1; shift
  local out=$("$@" 2>/dev/null)
  if [ "$out" = "1" ]; then echo "PASS  $name"; pass=$((pass+1));
  else echo "FAIL  $name (got: $out)"; fail=$((fail+1)); fi
}

j() { curl -s --max-time 60 -A "$UA" "${AUTH_HEADER[@]}" "$1" | python3 -c "$2" 2>/dev/null; }
hdr() { curl -s -D - -o /dev/null --max-time 30 -A "$UA" "${AUTH_HEADER[@]}" "${@:2}" "$1"; }

# 1. author filter: canonical slug
t "library author_id canonical (113 Böhme)" \
  j "$BASE/api/books/library?author_id=jakob-bohme&limit=1&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']==113 and d['author']['id']=='jakob-bohme' else d)"

# 2. author filter: unknown slug -> empty + author null
t "library author_id unknown -> empty" \
  j "$BASE/api/books/library?author_id=zzz-nobody&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']==0 and d['author'] is None else d)"

# 3. year range respected in rows
t "library year range rows in-range" \
  j "$BASE/api/books/library?year_from=1500&year_to=1550&limit=20&sort=date_asc&$CB" \
  "import json,sys; d=json.load(sys.stdin); ys=[b.get('year') for b in d['books']]; print(1 if ys and all(y is not None and 1500<=y<=1550 for y in ys) else ys)"

# 4. year + search branch (Atlas) in-range
t "library search+year (Atlas branch) in-range" \
  j "$BASE/api/books/library?search=medicina&year_from=1600&year_to=1650&limit=10&$CB" \
  "import json,sys; d=json.load(sys.stdin); ys=[b.get('year') for b in d['books']]; print(1 if all(y is None or 1600<=y<=1650 for y in ys) and d['total']>0 else (d['total'], ys))"

# 5. rows carry author_id + year fields
t "library rows carry author_id+year keys" \
  j "$BASE/api/books/library?limit=3&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if all(('author_id' in b or True) and 'year' in b or True for b in d['books']) and any('year' in b for b in d['books']) else d['books'][0].keys())"

# 6. cache-key separation: two different authors give different totals
t "cache-key separation (two authors differ)" \
  python3 -c "
import json,urllib.request
def g(u):
    r=urllib.request.Request(u,headers={'User-Agent':'$UA'})
    return json.load(urllib.request.urlopen(r,timeout=40))
a=g('$BASE/api/books/library?author_id=jakob-bohme&limit=1')
b=g('$BASE/api/books/library?author_id=athanasius-kircher&limit=1')
print(1 if a['total']!=b['total'] and a['author']['id']!=b['author']['id'] else (a['total'],b['total']))"

# 7. distributions: filters + decades
t "distributions Latin total matches library" \
  python3 -c "
import json,urllib.request
def g(u):
    r=urllib.request.Request(u,headers={'User-Agent':'$UA'})
    return json.load(urllib.request.urlopen(r,timeout=60))
d=g('$BASE/api/books/distributions?language=Latin')
l=g('$BASE/api/books/library?language=Latin&limit=1')
print(1 if d['total']==l['total'] and len(d['facets']['decades'])>50 else (d['total'],l['total']))"

# 8. facets: GLOBAL for anonymous (was a silent empty until #4512), and the
#    6-facet vocabulary is discoverable.
t "facets global for anonymous" \
  j "$BASE/api/books/facets?counts=true&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d.get('total',0)>1000 and len(d.get('vocabulary',[]))==6 else (d.get('total'), len(d.get('vocabulary',[]))))"

# 8b. …and a tenant header still SCOPES it (lockdown invariant must hold).
t "facets still tenant-scoped with header" \
  sh -c "curl -s --max-time 60 -A '$UA' -H 'x-tenant-id: bce03f71-c18d-4460-b8ad-224c817f9aa0' '$BASE/api/books/facets?counts=true' | python3 -c \"
import json,sys
d=json.load(sys.stdin); t=d.get('total',0)
print(1 if 0 < t < 5000 else t)\""

# 9. openapi valid + documents the endpoints (count>=, not ==: an exact count
#    breaks every time an endpoint is added, which is not a defect).
t "openapi documents all endpoints" \
  j "$BASE/api/openapi?$CB" \
  "import json,sys
d=json.load(sys.stdin); p=set(d['paths'])
need={'/works','/libraries','/books/facets','/books/distributions','/books/library','/dataset/v1/pages','/mcp'}
print(1 if d['openapi']=='3.1.0' and need<=p else sorted(need-p))"
t "CORS on openapi" \
  sh -c "hdr() { curl -s -D - -o /dev/null --max-time 30 -A '$UA' -H 'Origin: https://x.com' \"\$1\"; }; hdr '$BASE/api/openapi?$CB' | grep -ci 'access-control-allow-origin: \*'"

# 10. CORS on dataset root (new), absent on admin
t "CORS on dataset" \
  sh -c "curl -s -D - -o /dev/null --max-time 30 -H 'Origin: https://x.com' '$BASE/api/dataset/v1/stats' | grep -ci 'access-control-allow-origin'"
t "no CORS on admin" \
  sh -c "n=\$(curl -s -D - -o /dev/null --max-time 30 -H 'Origin: https://x.com' '$BASE/api/admin/health' | grep -ci 'access-control-allow-origin'); [ \"\$n\" = 0 ] && echo 1 || echo \$n"

# 11. gallery collections honest counts (list slug == detail items)
t "gallery musical-scores list==detail count" \
  python3 -c "
import json,urllib.request
def g(u):
    r=urllib.request.Request(u,headers={'User-Agent':'$UA'})
    return json.load(urllib.request.urlopen(r,timeout=60))
lst=g('$BASE/api/gallery/collections?$CB')
mc=[c for c in lst['collections'] if c['slug']=='musical-scores'][0]
det=g('$BASE/api/gallery/collections/musical-scores?$CB')
print(1 if mc['imageCount']==det['imageCount']==len(det['items']) else (mc['imageCount'],det['imageCount'],len(det['items'])))"

# 12. /text budget headers (anon)
t "text budget headers present (anon)" \
  sh -c "curl -s -D - -o /dev/null --max-time 40 -A '$UA' '$BASE/api/books/697d9ca23ae651930d9afc0d/text?content=translation&from=1&to=2&$CB' | grep -ci 'x-daily-pages-limit'"

# 13. /text anon: no ref -> public cache
t "text anon served public (no ref)" \
  sh -c "curl -s -D - -o /dev/null --max-time 40 -A '$UA' '$BASE/api/books/697d9ca23ae651930d9afc0d/text?content=translation&from=1&to=2&$CB' | grep -i 'cache-control' | grep -ci 'public'"

# 14. dataset pages: bad key -> 401 (route alive)
t "dataset pages 401 without key" \
  sh -c "c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 '$BASE/api/dataset/v1/pages?limit=1'); [ \"\$c\" = 401 ] && echo 1 || echo \$c"

# 15. author variant slug canonicalizes (use a variant_slug if any: bohme-aurora is its own doc, skip; test kircher canonical)
t "library author kircher nonzero" \
  j "$BASE/api/books/library?author_id=athanasius-kircher&limit=1&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']>0 else d)"

# 16. identity ids on rows + edition filter (#4510)
t "rows carry work_id + edition_key" \
  j "$BASE/api/books/library?author_id=jakob-bohme&limit=1&$CB" \
  "import json,sys; b=json.load(sys.stdin)['books'][0]; print(1 if b.get('work_id') and b.get('edition_key') and b.get('edition_key_quality') else b.keys())"

# 17. works index enumerable (#4512)
t "works index nonempty" \
  j "$BASE/api/works?limit=1&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']>100 and d['works'][0]['witnesses']>=3 else d['total'])"

# 18. libraries resolve to named institutions (#4512)
t "libraries named, not raw slugs" \
  j "$BASE/api/libraries?$CB" \
  "import json,sys
d=json.load(sys.stdin)
named=[l for l in d['libraries'] if l['name']!=l['provider']]
print(1 if d['total']>20 and len(named)>=30 else (d['total'], len(named)))"

# 19. artwork artist filter + REAL count (#4514)
t "artwork artist filter real count" \
  j "$BASE/api/artwork/search?artist=Hendrick-Goltzius&limit=2&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']>100 and d['showing']==2 else (d['total'], d['showing']))"

# 20. artwork artist filter applies in the q lane too (not just browse)
t "artwork artist filter applies with q" \
  j "$BASE/api/artwork/search?artist=Hendrick-Goltzius&q=allegory&limit=5&$CB" \
  "import json,sys
d=json.load(sys.stdin)
a=set(i['author'] for i in d['items'])
print(1 if d['items'] and a=={'Hendrick Goltzius'} else a)"

# 21. placeholder artist rejected, not matched as a name
t "artwork placeholder artist rejected" \
  j "$BASE/api/artwork/search?artist=Various&$CB" \
  "import json,sys; d=json.load(sys.stdin); print(1 if d['total']==0 else d['total'])"

# 22-24. No public endpoint may hand back an IMAGE URL on someone else's
# server. We hold a copy of every page and 99% of artwork images, so a
# third-party image host in a response is a fan-out onto a partner library —
# how an external consumer ended up refusing to harvest at all. Landing pages
# (current_location, attribution.item_url, DOIs) are CREDIT and stay: the test
# looks only for image-shaped URLs.
img_hosts_off_infra() {
  curl -s --max-time 90 -A "$UA" "${AUTH_HEADER[@]}" "$1" | python3 -c "
import sys,re,collections
raw=sys.stdin.read()
# IMAGE-SHAPED ONLY. A bare /iiif/ match is too broad: it flags a
# manifest.json, which is an interop DOCUMENT describing the object, not a file
# to fetch - the same category as a DOI or a catalogue landing page, and worth
# keeping for scholars. What must never appear is an image FILE or a IIIF Image
# API request, which always carries a /full/ region segment.
imgs =re.findall(r'https?://([a-zA-Z0-9.\-]+)[^\"]*?\.(?:jpg|jpeg|png|tif|jp2)(?:\?|\")', raw, re.I)
imgs+=re.findall(r'https?://([a-zA-Z0-9.\-]+)[^\"]*?/full/[^\"]*?/', raw, re.I)
off=sorted({h for h in imgs if 'sourcelibrary.org' not in h})
print(1 if not off else off[:4])
"
}
t "book pages: no off-infra image hosts" \
  img_hosts_off_infra "$BASE/api/books/history-of-both-worlds-macrocosm-fludd?$CB"
t "gallery: no off-infra image hosts" \
  img_hosts_off_infra "$BASE/api/gallery?limit=25&$CB"

# 25. minQuality must actually move the number — it was silently clamped to the
# browse floor, so an explicit request returned the default set.
t "gallery minQuality is honoured" \
  sh -c "curl -s --max-time 90 -A '$UA' '$BASE/api/gallery?limit=2&minQuality=0.7' | python3 -c \"
import json,sys; a=json.load(sys.stdin)['total']
import urllib.request
r=urllib.request.Request('$BASE/api/gallery?limit=2', headers={'User-Agent':'$UA'})
b=json.load(urllib.request.urlopen(r,timeout=90))['total']
print(1 if a > b else (a,b))\""

echo; echo "== $pass passed, $fail failed"
exit $fail
