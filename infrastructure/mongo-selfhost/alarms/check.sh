#!/bin/bash
# Alarms for the self-hosted MongoDB box (#346), every 5 minutes from sl-alarms.timer, to ntfy.
# PRIOR ART: scripts/maintenance/*-alarm*.sh and the uptime lanes page the same ntfy topic for Atlas-era
# services; none checks a mongod, a follower, mongot or PBM, so this is new.
#
# Each condition pages once when it starts, again every REPEAT_H hours while it lasts, and once when it
# clears. State: /var/lib/sl-alarms/<name>.firing.
# Test a condition on purpose: ALARM_TEST=<name> check.sh   (names below; it fires that one and clears it)
set -uo pipefail
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
ST=/var/lib/sl-alarms; mkdir -p "$ST"
REPEAT_H=${REPEAT_H:-6}
HOST=$(hostname -s)
TEST=${ALARM_TEST:-}
now=$(date +%s)

notify() { # notify <priority> <title> <body>
  curl -s -m 20 -H "Title: $HOST: $2" -H "Priority: $1" -H "Tags: rotating_light" \
    -d "$3 — owner: self-hosted MongoDB (v3 #346), runbook infrastructure/mongo-selfhost/README.md" "$NTFY" >/dev/null || true; }
# cond <name> <priority> <is-firing 0/1> <message>
cond() { local n=$1 p=$2 on=$3 msg=$4 f="$ST/$1.firing"
  [ "$TEST" = "$n" ] && { on=1; msg="TEST FIRING (on purpose): $msg"; }
  if [ "$on" = 1 ]; then
    if [ ! -f "$f" ] || [ $(( now - $(stat -c %Y "$f") )) -ge $(( REPEAT_H * 3600 )) ]; then notify "$p" "$n" "$msg"; echo "$msg" > "$f"; fi
    echo "FIRING $n: $msg"
  elif [ -f "$f" ]; then notify 2 "$n cleared" "was: $(cat "$f")"; rm -f "$f"; echo "cleared $n"; fi
  [ "$TEST" = "$n" ] && [ "$3" != 1 ] && { notify 2 "$n cleared" "test over"; rm -f "$f"; }
  return 0; }
q() { # mongosh as the monitor user (read-only roles); password read inside mongosh
  timeout 60 mongosh --quiet "mongodb://127.0.0.1:27017/?directConnection=true" \
    --eval "db.getSiblingDB('admin').auth('monitor', fs.readFileSync('/etc/sl-mongo/monitor.pw','utf8').trim()); void 0" --eval "$1" 2>/dev/null; }
age() { [ -f "$1" ] && echo $(( now - $(date -d "$(python3 -c "import json,sys;print(json.load(open('$1'))['$2'])" 2>/dev/null || echo 1970-01-01)" +%s) )) || echo 999999999; }

# mongod
ok=$(q 'print(db.adminCommand({ping:1}).ok)')
[ "$ok" = 1 ] && down=0 || down=1
cond mongod-down 5 $down "mongod does not answer on 127.0.0.1:27017 (systemctl status mongod)"

# the set (2026-11-17, three members): reported by the PRIMARY only, so one event pages once; with no
# primary at all every member reports it. STARTUP2 (initial sync) counts as healthy, not behind.
set=$(q 'const s=rs.status(); const me=s.members.find(m=>m.self); const p=s.members.find(m=>m.state===1);
  if (!p) { print("NOPRIMARY"); } else if (me.state===1) { const bad=[], slow=[];
    for (const m of s.members) { if (m.health!==1 || ![1,2,5,7].includes(m.state)) bad.push(m.name+":"+m.stateStr);
      else if (m.state===2) { const lag=(p.optimeDate-m.optimeDate)/1000; if (lag>300) slow.push(m.name+":"+Math.round(lag)+"s"); } }
    print("BAD="+bad.join(",")+";SLOW="+slow.join(",")); } else { print("SECONDARY"); }')
case "$set" in
  NOPRIMARY) cond member-down 5 1 "replica set has NO primary (rs.status() from $HOST)" ;;
  BAD=*) bad=${set#BAD=}; bad=${bad%%;*}; slow=${set##*SLOW=}
    cond member-down 5 $([ -n "$bad" ] && echo 1 || echo 0) "replica set member(s) not healthy: $bad"
    cond member-behind 4 $([ -n "$slow" ] && echo 1 || echo 0) "secondary more than 5 min behind the primary: $slow" ;;
  *) cond member-down 5 0 ""; cond member-behind 4 0 "" ;;   # a secondary, or no answer (mongod-down covers that)
esac

# follower and backups run on one box only (README); members skip those checks
if [ -f /etc/systemd/system/sl-follower-apply.service ]; then
# follower: both halves running, heartbeats fresh, not behind, no gap, not stopped on an event
R=/var/lib/sl-follower/journal/recorder-state.json; A=/var/lib/sl-follower/apply-state.json
rs=$(systemctl is-active sl-follower-record); as=$(systemctl is-active sl-follower-apply)
rage=$(age $R heartbeat); aage=$(age $A heartbeat)
stopped=0; why=""
[ "$rs" != active ] && { stopped=1; why+="recorder $rs; "; }
[ "$as" != active ] && { stopped=1; why+="applier $as; "; }
[ "$rage" -gt 180 ] && { stopped=1; why+="recorder heartbeat ${rage}s old; "; }
[ "$aage" -gt 180 ] && { stopped=1; why+="applier heartbeat ${aage}s old; "; }
cond follower-stopped 5 $stopped "follower not running: ${why:-ok}"
behind=$(python3 -c "import json;print(json.load(open('$A')).get('behind_s',0))" 2>/dev/null || echo 0)
# events Atlas has that the recorder has not seen show as recorder lag; the applier's own backlog as behind_s
last_ev=$(age $R last_event_t)
cond follower-behind 4 $([ "${behind:-0}" -gt 300 ] && echo 1 || echo 0) "follower ${behind}s behind the journal (5 min allowed); last Atlas event seen ${last_ev}s ago"
gap=$(python3 -c "import json;s=json.load(open('$R'));print(1 if s.get('gap_open') else 0)" 2>/dev/null || echo 0)
stopr=$(python3 -c "import json;print(json.load(open('$A')).get('stopped_reason') or '')" 2>/dev/null)
cond follower-gap 5 $([ "$gap" = 1 ] || [ -n "$stopr" ] && echo 1 || echo 0) "follower reports a gap or stopped on an event it will not guess at: ${stopr:-oplog history lost (README, Gap)}"
# warnings the applier logged (e.g. a search index change on Atlas), each paged once
AL=/var/lib/sl-follower/alerts.ndjson; seen=$ST/alerts.seen
if [ -f "$AL" ]; then n=$(wc -l < "$AL"); s=$(cat "$seen" 2>/dev/null || echo 0)
  [ "$n" -gt "$s" ] && { notify 4 "follower warning" "$(tail -n $(( n - s )) "$AL" | head -c 600)"; echo "$n" > "$seen"; }; fi
fi

# disk
pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
cond disk-75 4 $([ "$pct" -gt 75 ] && echo 1 || echo 0) "disk / at ${pct}% (alarm above 75%; STOP rule: under 60 GB free)"

# oplog window
win=$(q 'const o=db.getSiblingDB("local").oplog.rs; const f=o.find({},{ts:1}).sort({$natural:1}).limit(1).next().ts, l=o.find({},{ts:1}).sort({$natural:-1}).limit(1).next().ts; print(Math.floor((l.getHighBits()-f.getHighBits())/3600))')
# a freshly built set has a short window because it is young, not because the oplog is small
born=$(q 'print(Math.floor(db.getSiblingDB("local").oplog.rs.find({},{ts:1}).sort({$natural:1}).limit(1).next().ts.getHighBits()))')
young=$([ -n "$born" ] && [ $(( now - born )) -lt 90000 ] && echo 1 || echo 0)
cond oplog-window 4 $([ -n "$win" ] && [ "$win" -lt 24 ] && [ "$young" = 0 ] && echo 1 || echo 0) "oplog window ${win:-?} h (under 24 h): raise oplogSizeMB or find the write storm"

# backups (only on the box whose timers take them)
if systemctl is-enabled -q sl-backup-fallback.timer 2>/dev/null; then
# both kinds: the PBM backup (PITR base) and the mongodump fallback (the one the restore test restores)
bage=$(age /var/lib/sl-backup/last-backup.json at); fage=$(age /var/lib/sl-backup/last-fallback.json at)
[ "$fage" -gt "$bage" ] && { bage=$fage; bwhich="fallback dump (journalctl -u sl-backup-fallback)"; } || bwhich="PBM backup (journalctl -u sl-backup-daily)"
cond backup-old 4 $([ "$bage" -gt $(( 26 * 3600 )) ] && echo 1 || echo 0) "newest good $bwhich is $(( bage / 3600 )) h old (26 h allowed)"
rt=/var/lib/sl-backup/restore-test.json
rtok=$(python3 -c "import json;print(1 if json.load(open('$rt'))['ok'] else 0)" 2>/dev/null || echo 1)
cond restore-test-failed 4 $([ "$rtok" = 0 ] && echo 1 || echo 0) "last restore test failed: $(python3 -c "import json;print(json.load(open('$rt'))['note'][:200])" 2>/dev/null)"
fi

# mongot and the four search indexes
h=$(curl -s -m 10 127.0.0.1:8080/health)
cond mongot-down 4 $(echo "$h" | grep -q SERVING && echo 0 || echo 1) "mongot health: ${h:-no answer} (systemctl status mongot)"
notready=$(q 'const want={books:"books_search",pages:"pages_search",gallery_images:"gallery_search",entities:"entities_search"}; const bad=[];
for (const [c,n] of Object.entries(want)) { let s; try { s=db.getSiblingDB("bookstore").getCollection(c).aggregate([{$listSearchIndexes:{name:n}}]).toArray()[0]; } catch(e) { s=null; }
  if (!s || s.status!=="READY") bad.push(n+":"+(s?s.status:"missing")); if (!s) break; } print(bad.length ? bad.join(" ") : "OK")')
# an empty answer is a failed or timed-out query (each lookup takes ~20 s to fail while mongot is down), not "all READY"
[ "$notready" = OK ] && notready="" || notready=${notready:-"no answer from \$listSearchIndexes"}
[ -f "$ST/search-expected" ] || notready=""   # armed once the indexes are first built (README, Search)
cond search-not-ready 4 $([ -n "$notready" ] && echo 1 || echo 0) "search index not READY: $notready"
exit 0
