#!/usr/bin/env bash
# Connect the job boxes to each other, safely (#6360). Run from the LAPTOP, the one machine that already
# reaches every box as root. Idempotent: run it again to repair, and with `rotate` to replace every key.
#   scripts/workers/mesh-setup.sh install   keys + restricted authorized_keys entries + pinned host keys
#   scripts/workers/mesh-setup.sh check     every box pings every other box through the mesh
#   scripts/workers/mesh-setup.sh rotate    new mesh keys everywhere, then install
#   scripts/workers/mesh-setup.sh remove    take every mesh entry out again (keys kept, harmless alone)
#
# What it writes on each box, and nothing else:
#   /root/.ssh/id_mesh(.pub)        a key used ONLY for the mesh (never the box's own id_ed25519)
#   /root/.ssh/authorized_keys      one line per OTHER box, ending "mesh@<box>":
#       restrict,from="<that box's PUBLIC addresses; private/Docker ranges are left out>",command="/root/bin/box-rpc.sh" ssh-ed25519 …
#     every earlier mesh@ line is replaced; the file is backed up first (authorized_keys.bak-mesh-<time>)
#   /root/.ssh/known_hosts_mesh     the other boxes' host keys, read from the boxes themselves over the
#     laptop's existing connection rather than accepted on first use
# Requires /root/bin/box-rpc.sh on every box (the installer puts it there after a pull); refuses otherwise,
# because an authorized command that does not exist locks the key out with a confusing error.
set -u
BOXES="main=46.224.122.120 cloudlayer=46.224.208.175 l7a=167.233.32.250"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
names() { for b in $BOXES; do echo "${b%%=*}"; done; }
ip_of() { for b in $BOXES; do [ "${b%%=*}" = "$1" ] && echo "${b#*=}"; done; }
say() { echo "[mesh-setup] $*"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

gather() {  # per box: mesh public key, host key, every global address it may call from
  local b ip rot="${1:-}"
  for b in $(names); do ip=$(ip_of "$b")
    $SSH "root@$ip" "
      [ -x /root/bin/box-rpc.sh ] || { echo NO-RPC; exit 0; }
      [ -n '$rot' ] && rm -f /root/.ssh/id_mesh /root/.ssh/id_mesh.pub
      [ -f /root/.ssh/id_mesh ] || ssh-keygen -q -t ed25519 -N '' -C mesh@$b -f /root/.ssh/id_mesh
      echo PUB \$(cat /root/.ssh/id_mesh.pub)
      echo HOST \$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
      echo ADDR \$(ip -o addr show scope global | awk '{print \$4}' | cut -d/ -f1 | grep -vE '^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|f[cd])' | tr '\n' ' ')" > "$tmp/$b" \
      || { say "cannot reach $b ($ip) from the laptop"; return 1; }
    grep -q NO-RPC "$tmp/$b" && { say "$b has no /root/bin/box-rpc.sh yet: pull + install-claude-job.sh there first"; return 1; }
    grep -q '^PUB ssh-ed25519' "$tmp/$b" && grep -q '^HOST ssh-ed25519' "$tmp/$b" || { say "$b: could not read keys"; return 1; }
  done
}

install() {
  local b a ts; ts=$(date -u +%Y%m%d%H%M)
  for b in $(names); do
    : > "$tmp/$b.auth"; : > "$tmp/$b.kh"
    for a in $(names); do [ "$a" = "$b" ] && continue
      from=$(sed -n 's/^ADDR //p' "$tmp/$a" | tr ' ' '\n' | grep -v '^$' | paste -sd, -)
      echo "restrict,from=\"$from\",command=\"/root/bin/box-rpc.sh\" $(sed -n 's/^PUB //p' "$tmp/$a")" >> "$tmp/$b.auth"
      echo "$(ip_of "$a") $(sed -n 's/^HOST //p' "$tmp/$a")" >> "$tmp/$b.kh"
    done
    $SSH "root@$(ip_of "$b")" "set -e; cd /root/.ssh
      cp -p authorized_keys authorized_keys.bak-mesh-$ts
      grep -v ' mesh@' authorized_keys > authorized_keys.new || true
      cat >> authorized_keys.new
      chmod 600 authorized_keys.new; mv -f authorized_keys.new authorized_keys
      [ \$(grep -c ' mesh@' authorized_keys) -eq 2 ]" < "$tmp/$b.auth" || { say "$b: authorized_keys NOT updated"; return 1; }
    $SSH "root@$(ip_of "$b")" "cat > /root/.ssh/known_hosts_mesh.new && chmod 644 /root/.ssh/known_hosts_mesh.new && mv -f /root/.ssh/known_hosts_mesh.new /root/.ssh/known_hosts_mesh" < "$tmp/$b.kh"
    say "$b: 2 mesh entries, 2 pinned host keys (backup authorized_keys.bak-mesh-$ts)"
  done
}

check() {
  local b bad=0
  for b in $(names); do
    out=$($SSH "root@$(ip_of "$b")" "/root/bin/box.sh others ping" 2>&1)
    echo "$out" | sed "s/^/  $b -> /"
    [ "$(echo "$out" | grep -c '^pong ')" -eq 2 ] || bad=1
  done
  [ $bad -eq 0 ] && say "mesh OK: every box reaches both others" || { say "mesh INCOMPLETE"; return 1; }
}

case "${1:-}" in
  install) gather && install && check ;;
  rotate)  gather rotate && install && check ;;
  check)   check ;;
  remove)
    for b in $(names); do $SSH "root@$(ip_of "$b")" "cd /root/.ssh && cp -p authorized_keys authorized_keys.bak-mesh-remove && grep -v ' mesh@' authorized_keys.bak-mesh-remove > authorized_keys; rm -f known_hosts_mesh" && say "$b: mesh entries removed"; done ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
