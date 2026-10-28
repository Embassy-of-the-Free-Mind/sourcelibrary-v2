#!/bin/sh
# Refresh the book pages an ingest changed (#7598), so readers see the notice before the next release.
# The endpoint returns 429 above about one call a second: go one at a time, back off on 429.
# A release rebuilds every page anyway; skip this if one is due within the hour.
#
#   set -a; . ./.env.production.local; set +a; scripts/ft-search/revalidate.sh <dir>
DIR=$1
SEC=${REVALIDATE_SECRET:-$CRON_SECRET}
[ -n "$SEC" ] || { echo "REVALIDATE_SECRET/CRON_SECRET not set"; exit 1; }
python3 -I -c "
import json,os,sys
# ingest.mjs writes ingest-log.json (book_id); held.mjs writes held-log.json (id).
SHOW = ('first_new_badge','prior_credit','first_confirmed_search_added','badge_removed_prior_credited','badge_kept_partial_credited')
for f in ('ingest-log.json','held-log.json'):
    f = os.path.join(sys.argv[1], f)
    if os.path.exists(f):
        for x in json.load(open(f)):
            if x['action'] in SHOW: print(x.get('book_id') or x['id'])
" "$DIR" > "$DIR/revalidate-ids.txt"
: > "$DIR/revalidate-result.txt"
while read -r b; do
  for t in 1 2 3 4; do
    c=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "x-revalidate-secret: $SEC" "https://sourcelibrary.org/api/admin/revalidate-book/$b")
    [ "$c" = 429 ] && { sleep $((t * 5)); continue; }
    break
  done
  echo "$b $c" >> "$DIR/revalidate-result.txt"
  sleep 1
done < "$DIR/revalidate-ids.txt"
awk '{print $2}' "$DIR/revalidate-result.txt" | sort | uniq -c
