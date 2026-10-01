#!/usr/bin/env node
/**
 * deposit-quality-dataset.mjs — Zenodo DRAFT of the quality dataset bundle (#5531).
 *
 * PRIOR ART: deposit-ft-dataset.mjs — same Zenodo record-API flow (create draft → init/upload/commit
 * each file). It does not fit as-is: its title, description and CC BY 4.0 licence are the FT corpus's,
 * and it uploads only top-level files, while this bundle has a references/ subdirectory and mixed
 * licences. This sibling packs the bundle into ONE archive (what a reader downloads) and uploads that,
 * plus README.md and LICENSES.md so Zenodo previews them.
 *
 * DRAFT ONLY. There is deliberately no --publish: minting a DOI is public and irreversible, so publishing
 * is a human click in the Zenodo UI after review.
 *
 *   node scripts/eval/build-quality-dataset.mjs --check     # the committed bundle must match a rebuild
 *   node --env-file=.env.production.local scripts/eval/deposit-quality-dataset.mjs [--dry-run]
 *   ZENODO_SANDBOX=true ...                                  # rehearse against sandbox.zenodo.org
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = 'v1';
const DIR = resolve(__dirname, 'dataset', `quality-${VERSION}`);
const DRY = process.argv.includes('--dry-run');
if (process.argv.includes('--publish')) { console.error('This script never publishes. Review the draft and publish from the Zenodo UI.'); process.exit(1); }

const SANDBOX = process.env.ZENODO_SANDBOX === 'true';
const ZENODO_API = SANDBOX ? 'https://sandbox.zenodo.org/api' : 'https://zenodo.org/api';
const ZENODO_URL = SANDBOX ? 'https://sandbox.zenodo.org' : 'https://zenodo.org';
const GH_DIR = `https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/dataset/quality-${VERSION}`;
const PAPER = 'https://sourcelibrary.org/research/quality';

if (!existsSync(join(DIR, 'checksums.txt'))) { console.error(`No bundle at ${DIR}; run build-quality-dataset.mjs first.`); process.exit(1); }
// The deposit must be exactly what the repository regenerates.
execFileSync(process.execPath, [join(__dirname, 'build-quality-dataset.mjs'), '--check'], { stdio: 'inherit' });

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname }).toString().trim();
const today = new Date().toISOString().slice(0, 10);

// One reproducible archive: sorted names, fixed mtime/owner, gzip without a timestamp.
const tmp = mkdtempSync(join(tmpdir(), 'quality-dataset-'));
const archiveName = `source-library-quality-${VERSION}.tar.gz`;
const tarPath = join(tmp, archiveName.replace(/\.gz$/, ''));
execFileSync('tar', ['--sort=name', '--mtime=2026-10-01 00:00Z', '--owner=0', '--group=0', '--numeric-owner', '-cf', tarPath, '-C', dirname(DIR), `quality-${VERSION}`]);
execFileSync('gzip', ['-n', '-9', tarPath]);
const uploads = [
  { key: archiveName, body: readFileSync(`${tarPath}.gz`) },
  { key: 'README.md', body: readFileSync(join(DIR, 'README.md')) },
  { key: 'LICENSES.md', body: readFileSync(join(DIR, 'LICENSES.md')) },
];

const description = `
<p>The per-page evidence behind the draft paper <a href="${PAPER}">How page quality is measured</a>
(Source Library, sourcelibrary.org), which asks of a translated historical page: does this English say
what is printed on this leaf? With this archive and no access to our database, a reader can recompute
every figure the paper takes from these sources.</p>
<ul>
<li><b>Translation audit</b>: 311 random interior pages from 311 books in 15 languages, with the served
transcription and English, a Claude Opus fidelity rating (1–5) with typed defects, a second judge on 107
pages, and 45 blinded swap/drop/repeat controls. Measure: judged (no reference, no image).</li>
<li><b>Eye check</b>: 20 audited pages read against the scan by a model (Claude). Measure: accuracy.</li>
<li><b>Two-read screen</b>: 327 pages, served OCR against three fresh reads, with the judge's garble label.
Measure: agreement.</li>
<li><b>OCR accuracy cells</b>: character error rate against published references for the cells the paper
quotes, with the per-page Latin rows.</li>
<li><b>Reference windows</b>, split by licence: CC BY-SA and public-domain windows included; CC BY-NC-SA
and unrecorded licences as pointers (source URL, revision, sha256) only.</li>
</ul>
<p>See README.md (datasheet: measure vocabulary per file, collection, known limits including
memorisation risk and the judge's blindness to the scan) and LICENSES.md. Our data is CC BY-SA 4.0;
third-party reference windows keep their own licences, listed per file. Contains no personal or reader
data. Includes a canary GUID (CANARY.txt): do not train on this data.</p>
<p>Generated from git ${sha} by <code>scripts/eval/build-quality-dataset.mjs</code> in the
<a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2">sourcelibrary-v2</a> repository
(AGPL-3.0). Directory: <a href="${GH_DIR}">${GH_DIR}</a>.</p>
`.trim();

const metadata = {
  resource_type: { id: 'dataset' },
  title: `Source Library quality dataset ${VERSION}: OCR and translation quality evidence for historical primary sources`,
  publication_date: today,
  creators: [
    { person_or_org: { type: 'personal', family_name: 'Lomas', given_name: 'J. Derek', identifiers: [] }, affiliations: [{ name: 'Source Library / Embassy of the Free Mind' }] },
    { person_or_org: { type: 'organizational', name: 'Source Library / Embassy of the Free Mind' } },
  ],
  description,
  rights: [{ id: 'cc-by-sa-4.0' }],
  subjects: ['digital libraries', 'OCR', 'machine translation', 'evaluation', 'historical documents', 'large language models'].map((subject) => ({ subject })),
  version: VERSION,
  publisher: 'Source Library / Embassy of the Free Mind',
  related_identifiers: [
    { identifier: PAPER, scheme: 'url', relation_type: { id: 'issupplementto' } },
    { identifier: GH_DIR, scheme: 'url', relation_type: { id: 'issupplementedby' } },
  ],
};

if (DRY) {
  console.log(JSON.stringify({ metadata: { ...metadata, description: `${description.slice(0, 200)}…` }, uploads: uploads.map((u) => ({ key: u.key, bytes: u.body.length })) }, null, 1));
  process.exit(0);
}
if (!process.env.ZENODO_ACCESS_TOKEN) { console.error('ZENODO_ACCESS_TOKEN is not set.'); process.exit(1); }

const headers = (extra = {}) => ({ Authorization: `Bearer ${process.env.ZENODO_ACCESS_TOKEN}`, ...extra });
async function ok(resp, context) {
  if (resp.ok) return resp;
  throw new Error(`Zenodo ${context}: HTTP ${resp.status} — ${(await resp.text()).slice(0, 400)}`);
}

const draft = await (await ok(await fetch(`${ZENODO_API}/records`, {
  method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ access: { record: 'public', files: 'public' }, files: { enabled: true }, metadata }),
}), 'create draft')).json();
console.log(`Draft created: ${draft.id}`);

for (const { key, body } of uploads) {
  await ok(await fetch(`${ZENODO_API}/records/${draft.id}/draft/files`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify([{ key }]) }), `file init (${key})`);
  await ok(await fetch(`${ZENODO_API}/records/${draft.id}/draft/files/${encodeURIComponent(key)}/content`, { method: 'PUT', headers: headers({ 'Content-Type': 'application/octet-stream' }), body: new Uint8Array(body) }), `file upload (${key})`);
  await ok(await fetch(`${ZENODO_API}/records/${draft.id}/draft/files/${encodeURIComponent(key)}/commit`, { method: 'POST', headers: headers() }), `file commit (${key})`);
  console.log(`  uploaded ${key} (${(body.length / 1e6).toFixed(2)} MB)`);
}

console.log(`\nDRAFT ONLY (no DOI minted). Review and publish at:\n  ${ZENODO_URL}/uploads/${draft.id}`);
