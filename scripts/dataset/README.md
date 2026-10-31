# scripts/dataset — the sellable dataset (#7823)

`build-sellable-manifest.mjs` builds the licensable part of the live corpus from Mongo, read-only: a per-book
manifest with the rights tier of its images, the exclusions with reasons, the Claude-written pages to re-translate,
a datasheet and a 5,000-page Tier A sample. Rules and field definitions are in the script header and in the
`DATASHEET.md` it writes.

**No page text is committed here (#7822).** The outputs live in R2:

```
datasets/sellable/v0/<token>/manifest.jsonl.gz
datasets/sellable/v0/<token>/excluded.jsonl.gz
datasets/sellable/v0/<token>/claude-pages.jsonl.gz
datasets/sellable/v0/<token>/sample-5000.jsonl.gz
datasets/sellable/v0/<token>/DATASHEET.md
datasets/sellable/v0/<token>/release.json      (date, commit, counts, sha256 of each file)
```

The bucket is served publicly by `images.sourcelibrary.org`, so `<token>` (32 hex characters) is the only thing
keeping the set unlisted. It is never written to this repository or to an issue. To find it, list the prefix with
the R2 credentials:

```
node --env-file=.env.production.local -e "
const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'auto', endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: 'datasets/sellable/' }));
for (const o of r.Contents ?? []) console.log(o.Key, o.Size);"
```

## Re-run (quarterly refresh)

On the job box (about an hour; pages are read in five concurrent lanes):

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/dataset/build-sellable-manifest.mjs \
  --out=$JOB_SCRATCH/sellable-v1
# check the counts and a few sample rows, then:
node --env-file=/root/sourcelibrary/.env.production.local scripts/dataset/build-sellable-manifest.mjs \
  --out=$JOB_SCRATCH/sellable-v1 --upload-only            # a new token; or --r2-token=<old> to overwrite
```

Bump `VERSION` in the script for a new release. `--limit-books=N --sample=200` makes a quick test build.
The build reads open `contained` issues with `gh`; pass `--contained-ids=<file>` where `gh` is not logged in.
