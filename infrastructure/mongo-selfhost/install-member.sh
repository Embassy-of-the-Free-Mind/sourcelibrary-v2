#!/bin/bash
# Build a replica-set member box the way sl-db-1 was built (#346; README "Build a box", steps 1-4, 6, 7), on
# the box itself, as root. It does NOT add the member to the set (do that from the primary, README "Joining
# members") and it does not start mongot or pbm-agent until the member has data.
# PRIOR ART: none as a script — sl-db-1 was built by hand from the README on 2026-11-16; this is those steps.
#
# Before running, put on the box (copied from an existing member, streamed over ssh, never printed):
#   /etc/mongod.keyfile                      the set's keyfile
#   /etc/sl-mongo/{admin,mongot,pbm,monitor}.pw
#   /etc/sl-mongo/s3.env                     only on a member that runs backups or restore tests
#   /opt/percona-backup-mongodb_2.17.0-1.noble_arm64.deb, /opt/mongot-dl/mongot_community_1.70.6_linux_aarch64.tgz
#   /var/tmp/sl-mongo-selfhost.tgz           this directory (infrastructure/mongo-selfhost), tarred
#   /var/tmp/aws-cli.tgz                     /usr/local/aws-cli from an existing member (optional)
set -euo pipefail
V=9.0.7
PBM_DEB=/opt/percona-backup-mongodb_2.17.0-1.noble_arm64.deb
PBM_SHA=a5e25085694c0405c9b230fb6ee5b368fafdc0c8b906f2f9842e872df5379047
MONGOT_TGZ=/opt/mongot-dl/mongot_community_1.70.6_linux_aarch64.tgz
MONGOT_SHA=03246fb387a1785a5788527694234ac2471bece6a56113b9e4b4c27e5e755e7c
for f in /etc/mongod.keyfile /etc/sl-mongo/admin.pw /etc/sl-mongo/mongot.pw /etc/sl-mongo/pbm.pw "$PBM_DEB" "$MONGOT_TGZ" /var/tmp/sl-mongo-selfhost.tgz; do
  [ -s "$f" ] || { echo "missing $f" >&2; exit 1; }; done
echo "$PBM_SHA  $PBM_DEB" | sha256sum -c --quiet
echo "$MONGOT_SHA  $MONGOT_TGZ" | sha256sum -c --quiet
SRC=/opt/sl-mongo/src; rm -rf "$SRC"; mkdir -p "$SRC"; tar -xzf /var/tmp/sl-mongo-selfhost.tgz -C "$SRC"
# the private-network interface (Hetzner: enp7s0); never the public address
# the private-network address: the first 10.x address (Hetzner private networks; the public one is never 10.x)
PRIVATE_IP=$(ip -4 -o addr show | awk '$4 ~ /^10\./ {sub(/\/.*/, "", $4); print $4; exit}')
[ -n "$PRIVATE_IP" ] || { echo "no private-network (10.x) address on this box" >&2; exit 1; }

# needrestart must never restart the database services by itself (2026-11-17)
install -m 644 "$SRC/conf/needrestart-sl-mongo.conf" /etc/needrestart/conf.d/sl-mongo.conf

# 1. packages, held at the version Atlas runs
export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://pgp.mongodb.com/server-9.asc | gpg --batch --yes -o /usr/share/keyrings/mongodb-server-9.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-9.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/9.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-9.0.list
if [ ! -s /usr/share/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --batch --yes -o /usr/share/keyrings/nodesource.gpg --dearmor
fi
printf 'Types: deb\nURIs: https://deb.nodesource.com/node_22.x\nSuites: nodistro\nComponents: main\nArchitectures: arm64\nSigned-By: /usr/share/keyrings/nodesource.gpg\n' > /etc/apt/sources.list.d/nodesource.sources
apt-get update -q
apt-get install -y -q mongodb-org=$V mongodb-org-server=$V mongodb-org-mongos=$V mongodb-org-database=$V mongodb-org-tools=$V \
  mongodb-org-shell=$V mongodb-org-database-tools-extra=$V mongodb-mongosh mongodb-database-tools nodejs zstd jq python3 sysstat
apt-mark hold mongodb-org mongodb-org-server mongodb-org-mongos mongodb-org-database mongodb-org-tools mongodb-org-shell >/dev/null
dpkg -i "$PBM_DEB" >/dev/null
if [ -s /var/tmp/aws-cli.tgz ] && [ ! -x /usr/local/bin/aws ]; then
  tar -xzf /var/tmp/aws-cli.tgz -C /usr/local; ln -sf /usr/local/aws-cli/v2/current/bin/aws /usr/local/bin/aws
  ln -sf /usr/local/aws-cli/v2/current/bin/aws_completer /usr/local/bin/aws_completer
fi

# 2. mongod: same set, same keyfile; bound to loopback and the private address
systemctl stop mongod 2>/dev/null || true
chown mongodb:mongodb /etc/mongod.keyfile; chmod 400 /etc/mongod.keyfile
chmod 750 /etc/sl-mongo; chmod 600 /etc/sl-mongo/*.pw
sed "s/\${PRIVATE_IP}/$PRIVATE_IP/" "$SRC/conf/mongod.conf" > /etc/mongod.conf
install -m 644 "$SRC/conf/logrotate-sl-mongo" /etc/logrotate.d/sl-mongo
mkdir -p /var/lib/mongodb /var/log/mongodb; chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb
systemctl enable mongod >/dev/null; systemctl start mongod
cat > /usr/local/sbin/sl-mongosh <<'EOF'
#!/bin/bash
# mongosh as admin on this box (#346); the password is read inside mongosh, never in argv
exec mongosh --quiet "mongodb://127.0.0.1:27017/?directConnection=true" --eval "db.getSiblingDB('admin').auth('admin', fs.readFileSync('/etc/sl-mongo/admin.pw','utf8').trim()); void 0" --shell "$@"
EOF
chmod 700 /usr/local/sbin/sl-mongosh

# 3. mongot (installed, enabled, started after the member has synced: README "Joining members")
id mongot >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mongot --shell /usr/sbin/nologin mongot
mkdir -p /opt/mongot-1.70.6 /var/lib/mongot /var/log/mongot /etc/mongot/secrets
tar -xzf "$MONGOT_TGZ" -C /opt/mongot-1.70.6
ln -sfn "/opt/mongot-1.70.6/$(tar -tzf "$MONGOT_TGZ" | head -1 | cut -d/ -f1)" /opt/mongot
install -m 640 -o root -g mongot "$SRC/conf/mongot-config.yml" /etc/mongot/config.yml
install -m 400 -o mongot -g mongot /etc/sl-mongo/mongot.pw /etc/mongot/secrets/passwordFile
chown root:mongot /etc/mongot /etc/mongot/secrets; chmod 750 /etc/mongot /etc/mongot/secrets
chown -R mongot:mongot /var/lib/mongot /var/log/mongot
install -m 644 "$SRC/systemd/mongot.service" /etc/systemd/system/mongot.service

# 4. PBM agent: connects to THIS member directly (an agent pointed at the set would follow the primary).
# A single host with no replicaSet is a direct connection; an explicit `directConnection=true` makes PBM 2.17
# exit on a 9.0 secondary with "get config server connection URI: no documents in result" (2026-11-17).
mkdir -p /etc/systemd/system/pbm-agent.service.d
install -m 644 "$SRC/systemd/pbm-agent.override.conf" /etc/systemd/system/pbm-agent.service.d/override.conf
(umask 077; printf 'PBM_MONGODB_URI="mongodb://pbm:%s@127.0.0.1:27017/?authSource=admin"\n' "$(tr -d '\n' < /etc/sl-mongo/pbm.pw)" > /etc/default/pbm-agent)

# 6/7. scripts and alarms (the follower itself runs on one member only)
mkdir -p /opt/sl-mongo; rm -rf /opt/sl-mongo/backup /opt/sl-mongo/alarms
cp -r "$SRC/backup" "$SRC/alarms" /opt/sl-mongo/; chmod +x /opt/sl-mongo/backup/*.sh /opt/sl-mongo/alarms/*.sh
mkdir -p /opt/sl-follower; cp "$SRC/follower/package.json" /opt/sl-follower/
(cd /opt/sl-follower && npm install --omit=dev --no-audit --no-fund -q >/dev/null)
for u in sl-alarms.service sl-alarms.timer; do install -m 644 "$SRC/systemd/$u" /etc/systemd/system/$u; done
systemctl daemon-reload
echo "built $(hostname -s): mongod $(mongod --version | sed -n 's/^db version v//p') on 127.0.0.1 + $PRIVATE_IP; next: rs.add from the primary"
