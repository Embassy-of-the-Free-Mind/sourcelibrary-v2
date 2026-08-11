/**
 * Export the lemma tables as a citable dataset and (with --publish) deposit
 * to Zenodo for a DOI (#3823).
 *
 * Produces in --out (default scripts/lexicon/output/dataset):
 *   greek-lemma-table.jsonl.gz  {form, lemmas:[{headword, lsj}], count}
 *   latin-lemma-table.jsonl.gz  {form, lemmas:[{headword, ls}]}
 *   README.md                   provenance, method, validation, licenses
 *
 * Greek rows carry corpus attestation counts (the table was enumerated from
 * our books); Latin rows do not (that table is paradigm-generated from Lewis
 * & Short's own grammatical data — see README).
 *
 * Run: set -a; source .env.production.local; set +a   (plus ZENODO_ACCESS_TOKEN)
 *      node scripts/lexicon/export-lemma-datasets.mjs [--publish]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';

const OUT = 'scripts/lexicon/output/dataset';
const COUNTS_TSV = 'scripts/lexicon/output/greek-forms.tsv';
const PUBLISH = process.argv.includes('--publish');
const ZENODO_API = 'https://zenodo.org/api';

const GRAVE_TO_ACUTE = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };
function normGreek(raw) {
  let s = raw.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase();
  s = [...s].map((ch) => GRAVE_TO_ACUTE[ch] ?? ch).join('');
  return s.replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}]/gu, '');
}

async function gzWriteLines(file, iter) {
  const gz = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(file);
  gz.pipe(out);
  let n = 0;
  for await (const line of iter) {
    if (!gz.write(line + '\n')) await new Promise((r) => gz.once('drain', r));
    n++;
  }
  gz.end();
  await new Promise((r) => out.on('finish', r));
  return n;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  // ── Greek ──
  const grcHeads = new Map();
  for await (const e of db.collection('lexicon_entries_grc').find({}, { projection: { key: 1, headword: 1 } })) {
    grcHeads.set(e.key, e.headword);
  }
  const grcForms = new Set();
  for await (const d of db.collection('lexicon_lemma_map_grc').find({}, { projection: { form: 1 } })) {
    grcForms.add(d.form);
  }
  // Attestation counts: normalize the corpus enumeration down onto map forms.
  const counts = new Map();
  if (fs.existsSync(COUNTS_TSV)) {
    const rl = readline.createInterface({ input: fs.createReadStream(COUNTS_TSV) });
    for await (const line of rl) {
      const [raw, c] = line.split('\t');
      const f = normGreek(raw ?? '');
      if (grcForms.has(f)) counts.set(f, (counts.get(f) ?? 0) + Number(c));
    }
  }
  async function* grcRows() {
    const cur = db.collection('lexicon_lemma_map_grc').find({}).sort({ form: 1 });
    for await (const d of cur) {
      const lemmas = d.keys.map((k) => ({ headword: grcHeads.get(k) ?? null, lsj: k })).filter((l) => l.headword);
      if (!lemmas.length) continue;
      yield JSON.stringify({ form: d.form, lemmas, count: counts.get(d.form) ?? null });
    }
  }
  const nGrc = await gzWriteLines(path.join(OUT, 'greek-lemma-table.jsonl.gz'), grcRows());
  console.log(`greek rows: ${nGrc}`);

  // ── Latin ──
  async function* latRows() {
    const cur = db.collection('lexicon_lemma_map').find({}).sort({ form: 1 });
    for await (const d of cur) {
      const lemmas = d.keys.map((k) => ({ headword: k.replace(/[0-9]+$/, ''), ls: k }));
      yield JSON.stringify({ form: d.form, lemmas });
    }
  }
  const nLat = await gzWriteLines(path.join(OUT, 'latin-lemma-table.jsonl.gz'), latRows());
  console.log(`latin rows: ${nLat}`);
  await client.close();

  const readme = `# Early Modern Greek and Latin Lemma Tables

Form-to-lemma lookup tables for Ancient/early modern Greek and Latin, generated
by and for [Source Library](https://sourcelibrary.org) — a digital library of
early modern primary sources (~6,000 Latin and ~1,000 Greek books, 1450–1900).

## Files

- **greek-lemma-table.jsonl.gz** — ${nGrc.toLocaleString()} rows:
  \`{"form": "προσέχειν", "lemmas": [{"headword": "προσέχω", "lsj": "lsj9:91834"}], "count": 2532}\`
  One row per normalized word form attested in the Source Library Greek corpus
  (471,544 OCR pages). \`lemmas\` lists the Liddell-Scott-Jones (9th ed.) entries
  the form can belong to; \`lsj\` references entry ids in the
  [lsj9](https://github.com/ciscoriordan/lsj9) digitization. \`count\` is the
  form's attestation count across the corpus (null if below the enumeration
  threshold).
- **latin-lemma-table.jsonl.gz** — ${nLat.toLocaleString()} rows, same shape
  without counts: \`ls\` references entry keys in the Perseus digitization of
  Lewis & Short (1879). The Latin table is paradigm-generated from each
  entry's own grammatical data (declension, genitive, principal parts) rather
  than corpus-enumerated, and deliberately over-generates: rare or implausible
  forms map to their correct entry and are harmless in lookup use.

## Normalization

Both tables key on normalized forms; apply the same normalization to queries.
Greek: NFD → strip length marks (U+0304/U+0306) → NFC → lowercase → grave→acute
→ fold ς→σ. Latin: strip diacritics → lowercase → æ→ae, œ→oe, ſ→s, j→i, v→u.

## Method

Greek: every distinct word form was enumerated from the corpus (3.86M; forms
attested ≥3× kept), analyzed with the Perseus Project's Morpheus morphological
analyzer (the perseids-tools/morpheus distribution, MPL-2.0, stem libraries
included), and joined to LSJ headwords. Latin: inflected forms generated from
Lewis & Short's per-entry grammatical data plus hand-tabled irregulars.

## Validation

- Greek vs. the UD Ancient Greek (Perseus) treebank, 132,156 hand-verified
  tokens: **88.8% coverage; 96.6% lemma agreement** where covered.
- Latin vs. the UD Latin ITTB treebank (Index Thomisticus / Aquinas), 333,281
  tokens: **91.4% coverage; 95.1% agreement**.
- Remaining disagreements are dominated by headword conventions (Ionic vs.
  Attic, deponent vs. active) rather than errors.

## License & attribution

Published under **CC BY 4.0**. These tables derive from: Morpheus (Perseus
Project / Perseids Project, MPL-2.0); the lsj9 digitization of
Liddell-Scott-Jones (CC BY 4.0); the Perseus digitization of Lewis & Short
(public domain text). Please cite this deposit and credit the Perseus Project
lineage. Generated ${new Date().toISOString().slice(0, 10)}.
`;
  fs.writeFileSync(path.join(OUT, 'README.md'), readme);
  for (const f of fs.readdirSync(OUT)) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(1) + 'MB');

  if (!PUBLISH) return console.log('EXPORT-DONE (no --publish)');

  // ── Zenodo deposit ──
  const H = { Authorization: `Bearer ${process.env.ZENODO_ACCESS_TOKEN}` };
  const dep = await fetch(`${ZENODO_API}/deposit/depositions`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metadata: {
        title: 'Early Modern Greek and Latin Lemma Tables (Source Library)',
        upload_type: 'dataset',
        description:
          '<p>Form-to-lemma lookup tables for Greek (568,918 corpus-attested forms with counts, joined to Liddell-Scott-Jones) and Latin (1.4M paradigm-generated forms joined to Lewis &amp; Short), built from and for the Source Library corpus of early modern books. Validated against the Universal Dependencies gold treebanks: Greek 88.8% coverage / 96.6% lemma agreement (Perseus, 132,156 tokens); Latin 91.4% / 95.1% (Index Thomisticus, 333,281 tokens). See README.md for schema, normalization, method, and attribution. Built on the Perseus Project’s Morpheus analyzer (Perseids distribution, MPL-2.0) and the lsj9 digitization of LSJ (CC BY 4.0).</p>',
        creators: [{ name: 'Lomas, J. Derek', affiliation: 'Source Library' }],
        license: 'cc-by-4.0',
        keywords: ['Ancient Greek', 'Latin', 'lemmatization', 'morphology', 'digital humanities', 'early modern', 'lexicon', 'Morpheus', 'LSJ', 'Lewis and Short'],
        related_identifiers: [{ identifier: 'https://sourcelibrary.org', relation: 'isSupplementTo' }],
      },
    }),
  });
  if (!dep.ok) throw new Error(`deposit create: ${dep.status} ${await dep.text()}`);
  const depo = await dep.json();
  console.log('deposit created:', depo.id);
  for (const f of ['README.md', 'greek-lemma-table.jsonl.gz', 'latin-lemma-table.jsonl.gz']) {
    const buf = fs.readFileSync(path.join(OUT, f));
    const up = await fetch(`${depo.links.bucket}/${f}`, { method: 'PUT', headers: H, body: buf });
    if (!up.ok) throw new Error(`upload ${f}: ${up.status} ${await up.text()}`);
    console.log('uploaded', f);
  }
  const pub = await fetch(`${ZENODO_API}/deposit/depositions/${depo.id}/actions/publish`, { method: 'POST', headers: H });
  if (!pub.ok) throw new Error(`publish: ${pub.status} ${await pub.text()}`);
  const rec = await pub.json();
  console.log(`PUBLISHED-DOI: ${rec.doi} → ${rec.links.record_html}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
