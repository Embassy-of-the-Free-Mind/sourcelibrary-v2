#!/bin/bash
# PRIOR ART: none — the follower is new (lib.mjs); tests/mongo-selfhost-follower.test.ts covers the pure planning, this covers the real servers.
# Run on the database box: bash /opt/sl-follower/e2e-test.sh   (uses ports 27118/27119 and /var/tmp/sl-e2e; touches nothing else)
# End-to-end follower test on scratch instances (source :27118 plays Atlas, target :27119). Throwaway; removes itself.
set -uo pipefail
B=/var/tmp/sl-e2e; rm -rf $B; mkdir -p $B/src $B/dst $B/journal $B/state
for p in src:27118 dst:27119; do n=${p%%:*}; port=${p##*:}
  mongod --dbpath $B/$n --port $port --bind_ip 127.0.0.1 --replSet rs_$n --wiredTigerCacheSizeGB 0.25 --fork --logpath $B/$n.log >/dev/null
  mongosh --quiet --port $port --eval "rs.initiate({_id:'rs_$n',members:[{_id:0,host:'127.0.0.1:$port'}]})" >/dev/null
done
sleep 8
mongosh --quiet --port 27119 --eval 'db.getSiblingDB("admin").createUser({user:"follower",pwd:"e2e",roles:["root"]})' >/dev/null
printf 'e2e' > $B/pw; printf 'mongodb://127.0.0.1:27118/?replicaSet=rs_src&directConnection=true' > $B/uri
# seed both sides with the same "dump" (the follower starts from before it, as in production)
mongosh --quiet --port 27118 --eval 'const b=db.getSiblingDB("bookstore"); b.pages.insertMany([{_id:1,t:"a"},{_id:2,t:"b"},{_id:3,t:"c"}]); b.books.createIndex({slug:1},{unique:true}); b.books.insertMany([{_id:"x",slug:"s1"},{_id:"y",slug:"s2"}]); b.ttl.insertOne({_id:1,at:new Date()}); b.ttl.createIndex({at:1},{expireAfterSeconds:100000});' >/dev/null
START=$(date -u -d '-5 seconds' +%FT%TZ)
mongodump --quiet --port 27118 --db bookstore --archive=$B/seed.archive && mongorestore --quiet --port 27119 --archive=$B/seed.archive
cd /opt/sl-follower
ENV="ATLAS_URI_FILE=$B/uri JOURNAL_DIR=$B/journal STATE_DIR=$B/state LOCAL_PW_FILE=$B/pw LOCAL_HOST=127.0.0.1:27119"
env $ENV START_AT=$START node record.mjs > $B/record.log 2>&1 & RP=$!
env $ENV node apply.mjs > $B/apply.log 2>&1 & AP=$!
sleep 3
mongosh --quiet --port 27118 --eval '
const b=db.getSiblingDB("bookstore");
b.pages.updateOne({_id:1},{$set:{t:"a2",n:1}}); b.pages.deleteOne({_id:2}); b.pages.insertOne({_id:4,t:"d"}); b.pages.replaceOne({_id:3},{t:"c3"});
for (let i=0;i<2000;i++) b.pages.insertOne({_id:100+i, t:"bulk"+i}); b.pages.deleteMany({_id:{$gte:100,$lt:600}});
b.books.updateOne({_id:"x"},{$set:{slug:"tmp"}}); b.books.updateOne({_id:"y"},{$set:{slug:"s1"}}); b.books.updateOne({_id:"x"},{$set:{slug:"s2"}});
b.pages.createIndex({t:1},{name:"t_1"}); b.pages.createIndex({n:1},{name:"n_1",sparse:true}); b.pages.dropIndex("n_1");
b.runCommand({collMod:"ttl", index:{keyPattern:{at:1}, expireAfterSeconds:5000}});
b.createCollection("newc",{capped:true,size:1048576}); b.newc.insertOne({_id:1}); b.newc.createIndex({z:1});
b.oldname.insertMany([{_id:1,v:1},{_id:2,v:2}]); b.oldname.updateOne({_id:1},{$set:{v:11}}); b.oldname.renameCollection("renamed"); b.renamed.insertOne({_id:3,v:3});
b.gone.insertOne({_id:1}); b.gone.drop();
b.createView("v_books","books",[{$match:{slug:"s1"}}]);
'
sleep 15
kill $RP $AP; wait 2>/dev/null
cat > $B/cmp.js <<'JS'
const s = new Mongo("127.0.0.1:27118").getDB("bookstore"), d = new Mongo("127.0.0.1:27119").getDB("bookstore");
const names = (db) => db.getCollectionInfos().filter(c => !c.name.startsWith("system.")).map(c => c.name + ":" + c.type + ":" + JSON.stringify(c.options)).sort();
let ok = true; const chk = (what, a, b) => { const same = JSON.stringify(a) === JSON.stringify(b); if (!same) { ok = false; print("DIFF", what, JSON.stringify(a), JSON.stringify(b)); } };
chk("collections", names(s), names(d));
for (const c of s.getCollectionInfos().filter(c => c.type === "collection" && !c.name.startsWith("system.")).map(c => c.name)) {
  chk(c + " docs", s[c].find().sort({_id:1}).toArray(), d[c].find().sort({_id:1}).toArray());
  const ix = (db) => db[c].getIndexes().map(({v, ns, ...r}) => r).sort((a,b) => a.name < b.name ? -1 : 1);
  chk(c + " indexes", ix(s), ix(d));
}
print(ok ? "E2E PASS" : "E2E FAIL");
JS
mongosh --quiet --nodb $B/cmp.js | tee $B/cmp.out
echo "--- apply log"; grep -vE '^\s*$' $B/apply.log | tail -12; echo "--- record log"; tail -3 $B/record.log; echo "--- alerts"; cat $B/state/alerts.ndjson 2>/dev/null
mongosh --quiet --port 27118 --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; mongosh --quiet --port 27119 --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1
grep -q "^E2E PASS" $B/cmp.out
