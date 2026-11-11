#!/usr/bin/env bash
# Run rearchive-iiif-fullres.mjs over a long book list in waves, for weeks, unattended (#3186).
#
# Written for the Siku Quanshu re-fetch: 17.9K Internet Archive `.cn` books, 2.56M pages held at
# ≤800 px, ~11 s per page from the Archive, so ~40 days at 8 pages in flight. Each wave hands the
# next WAVE books of the list to the tool, which checkpoints one JSON line per finished book in
# <dir>/done.jsonl, so a re-run resumes where the last stopped. Between waves:
#   - <dir>/progress.json is rewritten (books, pages, bytes per page, rate, ETA);
#   - BYTES CAP: once 2,000 pages are measured, if the R2 bytes added per page run over CAP_KB
#     (default 806 = 672 KB audited + 20%), stop and page: the storage price was approved on that number;
#   - HOST: a wave that wrote nothing while every book in it failed means the host is down. Wait
#     30 min and try once more; a second such wave in a row stops the run and pages (never more
#     than two tries at a down host);
#   - <dir>/STOP stops the run after the current wave.
# When the list is exhausted, one gap pass retries the books that finished with failed pages
# (done-gap.jsonl); --max-held-width means only their still-small pages are fetched.
# It pages ntfy on finish, on any stop, and if it dies.
#
# Usage (from the main checkout, under systemd-run so it outlives the shell):
#   scripts/maintenance/rearchive-fullres-waves.sh run    <dir>   # <dir>/books.jsonl: ordered, one {"id",...,"low":N} per line
#   scripts/maintenance/rearchive-fullres-waves.sh status <dir>
#
# PRIOR ART: scripts/maintenance/page-frame-sweep-waves.sh — the wave/STOP/ntfy shape this copies;
# it drives a different writer and gates each wave on a by-eye review, which a pure image re-fetch
# with a per-page leaf guard does not need.
set -u

main() {
  local cmd=${1:?run|status}
  DIR=${2:?state dir}
  ENVF=${ENVF:-/root/sourcelibrary/.env.production.local}
  NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
  WAVE=${WAVE:-40}
  CAP_KB=${CAP_KB:-806}
  TOOL_ARGS=${TOOL_ARGS:---max-held-width 800 --page-guard --concurrency 2 --page-concurrency 4}
  BOOKS=$DIR/books.jsonl DONE=$DIR/done.jsonl STOP=$DIR/STOP
  case "$cmd" in
    status) status; cat "$DIR/progress.json"; echo ;;
    run) run ;;
    *) echo "unknown command $cmd" >&2; return 2 ;;
  esac
}

log() { echo "$(date -u +%FT%TZ) $1" | tee -a "$DIR/waves.log"; }
quit() { trap - EXIT; exit "$1"; }  # an exit we chose: no "died" page on top of the one already sent
say() {
  log "$1"
  curl -s -m 20 -H "Title: siku full-res re-fetch (#3186)" -H "Priority: high" -d "$1 — $(hostname):$DIR" "$NTFY" >/dev/null || true
}

# progress.json from books.jsonl + done.jsonl (+ done-gap.jsonl). Prints one summary line.
status() {
  DIR="$DIR" CAP_KB="$CAP_KB" node -e '
    const fs = require("fs"); const D = process.env.DIR;
    const rd = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
    const books = rd(D + "/books.jsonl"), done = [...rd(D + "/done.jsonl"), ...rd(D + "/done-gap.jsonl")];
    const ids = new Set(done.map(d => d.id));
    const s = { books: books.length, books_done: ids.size, pages_selected: books.reduce((a, b) => a + (b.low || 0), 0),
      pages_updated: 0, pages_failed: 0, pages_off_leaf: 0, books_error: 0, books_skipped: 0, bytes_new: 0, bytes_old: 0, bytes_pages: 0 };
    for (const d of done) {
      if (d.error) s.books_error++;
      if (typeof d.skipped === "string") s.books_skipped++;
      s.pages_updated += d.updated || 0; s.pages_failed += d.failed || 0; s.pages_off_leaf += (d.offLeaf || []).length;
      if (d.bytes) { s.bytes_new += d.bytes.new; s.bytes_old += d.bytes.old; s.bytes_pages += d.bytes.pages; }
    }
    s.kb_added_per_page = s.bytes_pages ? Math.round((s.bytes_new - s.bytes_old) / s.bytes_pages / 1024) : null;
    s.over_cap = s.bytes_pages >= 2000 && s.kb_added_per_page > Number(process.env.CAP_KB);
    const day = Date.now() - 864e5, recent = done.filter(d => Date.parse(d.at) > day);
    s.pages_last_24h = recent.reduce((a, d) => a + (d.updated || 0), 0);
    const left = Math.max(0, s.pages_selected - s.pages_updated);
    s.eta_days = s.pages_last_24h ? Math.round(left / s.pages_last_24h * 10) / 10 : null;
    s.at = new Date().toISOString();
    fs.writeFileSync(D + "/progress.json", JSON.stringify(s, null, 1));
    console.log(`${s.books_done}/${s.books} books, ${s.pages_updated}/${s.pages_selected} pages, ${s.pages_failed} failed, ${s.pages_off_leaf} off-leaf, ${s.kb_added_per_page} KB/page added, ${s.pages_last_24h} pages/24h, ETA ${s.eta_days} d`);
  '
}

# The next WAVE ids of <list> not yet in <done>, into $DIR/wave.txt. Prints the count.
next_wave() {
  LIST="$1" DONEF="$2" WAVE="$WAVE" OUT="$DIR/wave.txt" node -e '
    const fs = require("fs"); const e = process.env;
    const done = new Set(fs.existsSync(e.DONEF) ? fs.readFileSync(e.DONEF, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
    const ids = fs.readFileSync(e.LIST, "utf8").split("\n").filter(Boolean).map(l => l.startsWith("{") ? JSON.parse(l).id : l.trim()).filter(id => !done.has(id)).slice(0, Number(e.WAVE));
    fs.writeFileSync(e.OUT, ids.join("\n") + (ids.length ? "\n" : ""));
    console.log(ids.length);
  '
}

# Did the last wave (the last N lines of <done>) write nothing while every book failed?
wave_host_down() {
  DONEF="$1" N="$2" node -e '
    const fs = require("fs"); const rows = fs.readFileSync(process.env.DONEF, "utf8").split("\n").filter(Boolean).slice(-Number(process.env.N)).map(l => JSON.parse(l));
    const wrote = rows.some(r => (r.updated || 0) > 0), allFailed = rows.length > 0 && rows.every(r => r.error || (r.failed || 0) > 0 || r.skipped === "info-json-fail");
    process.exit(!wrote && allFailed ? 0 : 1);
  '
}

pass() {  # $1 list, $2 done file, $3 label
  local list=$1 donef=$2 label=$3 n before downs=0 rc
  while :; do
    [ -e "$STOP" ] && { say "stopped by $STOP ($label). $(status)"; quit 0; }
    n=$(next_wave "$list" "$donef") || { say "could not read the book list"; quit 2; }
    [ "$n" -gt 0 ] || return 0
    before=$( [ -f "$donef" ] && wc -l <"$donef" || echo 0 )
    log "$label wave: $n books"
    node --env-file="$ENVF" scripts/maintenance/rearchive-iiif-fullres.mjs --book-ids-file "$DIR/wave.txt" --done-file "$donef" $TOOL_ARGS >>"$DIR/run.log" 2>&1
    rc=$?
    [ $rc -eq 0 ] || { say "the tool exited $rc ($label); last lines in $DIR/run.log. $(status)"; quit 3; }
    local after; after=$( [ -f "$donef" ] && wc -l <"$donef" || echo 0 )
    [ "$after" -gt "$before" ] || { say "a wave checkpointed nothing ($label); stopping rather than loop. $(status)"; quit 3; }
    log "$(status)"
    if node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).over_cap ? 0 : 1)' "$DIR/progress.json"; then
      say "PAUSED: R2 bytes added per page are over ${CAP_KB} KB (audit 672 KB + 20%). Needs a decision before resuming. $(status)"; quit 4
    fi
    if wave_host_down "$donef" "$((after - before))"; then
      downs=$((downs + 1))
      if [ $downs -ge 2 ]; then say "the Archive failed two waves running; stopped. $(status)"; quit 5; fi
      log "every book in that wave failed; waiting 30 min before one more try"
      sleep 1800
    else
      downs=0
    fi
  done
}

run() {
  mkdir -p "$DIR"
  [ -s "$BOOKS" ] || { echo "no $BOOKS" >&2; exit 2; }
  node --check scripts/maintenance/rearchive-iiif-fullres.mjs || { say "preflight: the tool does not parse"; exit 2; }
  echo $$ >"$DIR/pid"
  trap 'say "the runner died unexpectedly (pid $$). $(status)"' EXIT
  trap 'say "the runner was signalled to stop (pid $$). $(status)"; quit 143' TERM INT
  log "start: $(wc -l <"$BOOKS") books, wave $WAVE, args: $TOOL_ARGS"
  pass "$BOOKS" "$DONE" main
  # Gap pass: books that finished with failed pages, once.
  DONEF="$DONE" OUT="$DIR/gap.jsonl" node -e '
    const fs = require("fs"); const rows = fs.readFileSync(process.env.DONEF, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    fs.writeFileSync(process.env.OUT, rows.filter(r => r.error || (r.failed || 0) > 0).map(r => r.id).join("\n") + "\n");'
  if [ -s "$DIR/gap.jsonl" ] && [ "$(wc -w <"$DIR/gap.jsonl")" -gt 0 ]; then pass "$DIR/gap.jsonl" "$DIR/done-gap.jsonl" gap; fi
  say "FINISHED. $(status)"
  quit 0
}

main "$@"; exit
