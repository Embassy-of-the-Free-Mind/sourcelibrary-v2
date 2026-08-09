#!/usr/bin/env node
/**
 * deposit-ft-dataset.mjs — deposit an FT dataset snapshot on Zenodo (#3798).
 *
 * Takes a snapshot directory produced by export-ft-dataset.mjs, creates a
 * Zenodo DRAFT record (resource type: dataset, CC BY 4.0), and uploads every
 * file. It does NOT publish: minting a DOI is public and irreversible, so the
 * default stops at the draft and prints its URL for human review. Publish from
 * the Zenodo UI after review, or re-run with --publish once the draft has been
 * reviewed.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/deposit-ft-dataset.mjs --dir scripts/output/ft-dataset-2026-08-09
 *   ... --publish            # actually publish (mints the DOI) — requires human sign-off first
 *   ZENODO_SANDBOX=true ...  # rehearse against sandbox.zenodo.org
 *
 * Reuses the Zenodo record API flow of scripts/batch/batch-mint-doi.mjs
 * (create draft → init/upload/commit files → publish).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Files above this size are uploaded gzipped (Zenodo uploads time out on large plain files). */
const GZIP_THRESHOLD = 2 * 1024 * 1024;

const ZENODO_API = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org/api'
  : 'https://zenodo.org/api';
const ZENODO_URL = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org'
  : 'https://zenodo.org';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DIR = getArg('--dir');
const PUBLISH = args.includes('--publish');

if (!DIR) {
  console.error('Usage: deposit-ft-dataset.mjs --dir <snapshot dir> [--publish]');
  process.exit(1);
}
if (!process.env.ZENODO_ACCESS_TOKEN) {
  console.error('ZENODO_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const dir = resolve(DIR);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
console.log(`Depositing ${manifest.dataset} v${manifest.version} (git ${manifest.git_sha.slice(0, 8)}) → ${ZENODO_URL}`);

function headers(extra = {}) {
  return { Authorization: `Bearer ${process.env.ZENODO_ACCESS_TOKEN}`, ...extra };
}

async function fail(resp, context) {
  const text = await resp.text();
  throw new Error(`Zenodo ${context}: HTTP ${resp.status} — ${text.slice(0, 400)}`);
}

const description = `
<p>The first-translation verification corpus of Source Library (sourcelibrary.org):
documented <b>evidence of absence at scale</b>. ${manifest.counts.attempts.toLocaleString('en-US')} recorded
verification attempts with per-attempt provenance (instrument, sources consulted, verbatim
queries, result, evidence grade), graded verdicts on ${manifest.counts.verdict_books.toLocaleString('en-US')} books
under an 8-verdict taxonomy, durable screening decisions, and the composition of the
bibliographic reference set every catalogue-tier absence claim is asserted against.</p>
<p>Each "first English translation" claim on the site derives from this ledger; the dataset
makes every such claim independently auditable. See <code>DATASHEET.md</code> inside the
deposit for motivation, composition, collection process, known biases (measured reference-set
recall, instrument fabrication rates, the post-1950 blind spot), and recommended uses.</p>
<p>Snapshot ${manifest.version}, generated from git ${manifest.git_sha} by
<code>scripts/eval/export-ft-dataset.mjs</code> in the
<a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2">sourcelibrary-v2</a>
repository (AGPL-3.0). Data license: CC BY 4.0. Contains no personal or reader data.</p>
`.trim();

const metadata = {
  resource_type: { id: 'dataset' },
  title: `Source Library First-Translation Verification Corpus (snapshot ${manifest.version})`,
  publication_date: manifest.version,
  creators: [
    {
      person_or_org: {
        type: 'personal',
        family_name: 'Lomas',
        given_name: 'J. Derek',
        identifiers: [],
      },
      affiliations: [{ name: 'Source Library / Embassy of the Free Mind' }],
    },
    {
      person_or_org: { type: 'organizational', name: 'Source Library / Embassy of the Free Mind' },
    },
  ],
  description,
  rights: [{ id: 'cc-by-4.0' }],
  subjects: [
    { subject: 'digital libraries' },
    { subject: 'translation studies' },
    { subject: 'bibliography' },
    { subject: 'large language models' },
    { subject: 'metadata quality' },
    { subject: 'evidence of absence' },
  ],
  version: manifest.version,
  publisher: 'Source Library / Embassy of the Free Mind',
  related_identifiers: [
    {
      identifier: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2',
      scheme: 'url',
      relation_type: { id: 'issupplementedby' },
    },
  ],
};

// 1. Create the draft.
const draftResp = await fetch(`${ZENODO_API}/records`, {
  method: 'POST',
  headers: headers({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ access: { record: 'public', files: 'public' }, files: { enabled: true }, metadata }),
});
if (!draftResp.ok) await fail(draftResp, 'create draft');
const draft = await draftResp.json();
console.log(`Draft created: ${draft.id}`);

// 2. Upload every file in the snapshot. Large data files go up gzipped —
// plain multi-MB uploads hit the client's header timeout, and .gz is kinder
// to downloaders anyway. manifest.json checksums refer to the UNCOMPRESSED
// files; `gunzip *.gz` restores byte-identical content.
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort();
for (const f of files) {
  const raw = readFileSync(join(dir, f));
  const compress = raw.length > GZIP_THRESHOLD;
  const key = compress ? `${f}.gz` : f;
  const body = compress ? new Uint8Array(gzipSync(raw, { level: 9 })) : new Uint8Array(raw);
  const initResp = await fetch(`${ZENODO_API}/records/${draft.id}/draft/files`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify([{ key }]),
  });
  if (!initResp.ok) await fail(initResp, `file init (${key})`);
  const upResp = await fetch(
    `${ZENODO_API}/records/${draft.id}/draft/files/${encodeURIComponent(key)}/content`,
    { method: 'PUT', headers: headers({ 'Content-Type': 'application/octet-stream' }), body },
  );
  if (!upResp.ok) await fail(upResp, `file upload (${key})`);
  const commitResp = await fetch(
    `${ZENODO_API}/records/${draft.id}/draft/files/${encodeURIComponent(key)}/commit`,
    { method: 'POST', headers: headers() },
  );
  if (!commitResp.ok) await fail(commitResp, `file commit (${key})`);
  console.log(`  uploaded ${key} (${(body.length / 1e6).toFixed(1)} MB${compress ? `, from ${(raw.length / 1e6).toFixed(1)} MB` : ''})`);
}

if (!PUBLISH) {
  console.log(`\nDRAFT ONLY (no DOI minted). Review and publish at:\n  ${ZENODO_URL}/uploads/${draft.id}`);
  process.exit(0);
}

// 3. Publish — mints the DOI. Only on explicit --publish.
const pubResp = await fetch(`${ZENODO_API}/records/${draft.id}/draft/actions/publish`, {
  method: 'POST',
  headers: headers(),
});
if (!pubResp.ok) await fail(pubResp, 'publish');
const published = await pubResp.json();
const doi = published.pids?.doi?.identifier || published.doi;
console.log(`\nPUBLISHED: https://doi.org/${doi}\n  ${ZENODO_URL}/records/${published.id}`);
