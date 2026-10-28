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
import json,sys
for x in json.load(open(sys.argv[1])):
    if x['action'] in ('first_new_badge','prior_credit','first_confirmed_search_added'): print(x['book_id'])
" "$DIR/ingest-log.json" > "$DIR/revalidate-ids.txt"
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
