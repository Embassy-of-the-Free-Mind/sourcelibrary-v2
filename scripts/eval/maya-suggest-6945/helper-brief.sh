#!/bin/bash
# helper-brief.sh <jobName> <payloadName> <run>... : prints the brief for a Gemini helper job on a box where agy is signed
# in (main; not l7a). CHECKOUT=<path> names that box's Source Library checkout (default /root/sourcelibrary, main's). Each run is uploaded as soon as it finishes, so the l7a job can go on with it.
# PRIOR ART: round 2's helper-brief.sh (l7a scratch); same steps, generalised to N runs.
JOB=$1; PAY=$2; shift 2; C=${CHECKOUT:-/root/sourcelibrary}
cat <<B
Lands: #6903
PR: no

You are a helper for job maya-suggest-6945 (running on l7a, where agy is not signed in). Your ONLY task: run prepared Gemini eval runs with agy on this box and hand the outputs back through Mongo. Do not post on GitHub, do not open a PR, do not write to any book or page, do not touch anything else. The payload is PRIVATE (eval prompts with reference readings): never print prompt text into anything you post, and delete \$JOB_SCRATCH/ms when finished.

Steps (from $C, which has node_modules and .env.production.local):

1. Fetch the payload:
\`\`\`
mkdir -p \$JOB_SCRATCH/ms/img && cd $C && cat > ./_ms_get.mjs <<'X'
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const d = await c.db('bookstore').collection('ops_reports').findOne({ _id: 'eval-scratch:maya-suggest-6945:$PAY' });
for (const [k, v] of Object.entries(d.files)) fs.writeFileSync(process.argv[2] + '/' + k, v);
for (const [k, v] of Object.entries(d.b64 || {})) fs.writeFileSync(process.argv[2] + '/img/' + k, Buffer.from(v, 'base64'));
console.log(Object.keys(d.files), Object.keys(d.b64 || {}).length); await c.close();
X
node --env-file=.env.production.local ./_ms_get.mjs \$JOB_SCRATCH/ms; rm -f ./_ms_get.mjs
\`\`\`
2. Model: run \`agy models\`. If agy is not signed in, STOP: rm -rf \$JOB_SCRATCH/ms, report "agy not signed in" and touch the done file. Use \`gemini-4-argon-high\` (rounds 1 and 2 used it). If it is not listed, STOP and report that (do not substitute).
3. For each run name, in this order: $*
   run it in the foreground (each Bash call <= 10 min: detach with nohup, then wait in the foreground with an until-loop on the log; each call takes 5-10 min):
\`\`\`
cd \$JOB_SCRATCH/ms && AGY_LIB=$C/scripts/lib/agy-cli.mjs nohup node run-agy.mjs \$JOB_SCRATCH/ms gemini-4-argon-high <RUN> 3 > run-<RUN>.log 2>&1 &
\`\`\`
   It is resumable (re-run the same command and it skips finished items). Finished when run-<RUN>.log has a line starting with DONE. On a quota stop (exit 3, "QUOTA" in the log), wait in a bash loop (check every 10 min, up to 6 h) and resume. Do not substitute another model.
   As soon as a run is DONE, upload it (then start the next run):
\`\`\`
cd $C && cat > ./_ms_put.mjs <<'X'
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const id = 'eval-scratch:maya-suggest-6945:out-' + process.argv[3];
await c.db('bookstore').collection('ops_reports').replaceOne({ _id: id }, { _id: id, note: 'PRIVATE eval scratch for #6903/#6945, read by nothing; delete after use', model: 'gemini-4-argon-high', created_at: new Date(), n: Object.keys(out).length, out }, { upsert: true });
console.log('uploaded', Object.keys(out).length); await c.close();
X
node --env-file=.env.production.local ./_ms_put.mjs \$JOB_SCRATCH/ms/out-<RUN>.json <RUN>; rm -f ./_ms_put.mjs
\`\`\`
4. rm -rf \$JOB_SCRATCH/ms. Leave $C clean (\`git status --porcelain\` shows nothing from you). Final message: model used, items ok per run, any quota waits. Then touch the done file.
B
