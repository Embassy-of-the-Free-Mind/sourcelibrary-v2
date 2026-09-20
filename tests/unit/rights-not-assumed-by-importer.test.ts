import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyStored, readManifestRights } from '../../scripts/lib/rights-normalize.mjs';

/**
 * `image_source.license` records what the HOLDING LIBRARY STATED. Never a guess.
 *
 * Importers used to answer "the manifest said nothing" with what we believed the
 * provider's terms to be, and wrote that belief into the same field a manifest-read
 * value lands in — indistinguishable from one, and 100% populated, so every coverage
 * check passed over it. The 2026-09-19 backfill had to undo three of these:
 *
 *   - `batch-import-istc-bsb.mjs` / `bsb-from-file.mjs` hard-coded `CC-BY-NC-4.0` on
 *     every BSB import. The manifests state PDM on 818 of those 908 books, so the
 *     corpus read as non-commercial where the library had marked it public domain.
 *   - The IIIF import route defaulted Vatican and Bodleian to `CC-BY-NC-4.0` and
 *     Gallica to `publicdomain`. BAV's manifest asserts copyright and names no
 *     licence at all; Gallica's real terms are non-commercial-free with commercial
 *     use licensed by the BnF — terms-of-use, not public domain.
 *   - The IA importers write the literal `'publicdomain'` when an item has no
 *     licenseurl (~20K books), which `classifyStored` now labels `assumed-by-importer`.
 *
 * This is a check rather than a sentence in a doc because the doc version exists and
 * was written by the same person who then quoted the wrong number from it: a populated
 * field reads as a measured one. Silence is not a licence; the honest value is
 * `unknown`, and provider knowledge belongs in the derived, labelled
 * `rights_normalized` lane where `status` can say it was assumed.
 */

const REPO = path.resolve(__dirname, '../..');

describe('the rights vocabulary distinguishes stated from assumed', () => {
  it('labels the IA importer default as assumed, not as a reading', () => {
    const r = classifyStored({ license: 'publicdomain', license_url: null, provider: 'internet_archive' });
    expect(r.class).toBe('public-domain');
    expect(r.status).toBe('assumed-by-importer');
  });

  it('calls a real stated licence stated', () => {
    const r = classifyStored({ license: 'https://creativecommons.org/publicdomain/mark/1.0/', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/', provider: 'bsb' });
    expect(r.class).toBe('public-domain');
    expect(r.status).toBe('stated');
  });

  it('a silent manifest is unknown, never a guess', () => {
    const r = readManifestRights({ label: 'Some book' });
    expect(r.class).toBe('unknown');
    expect(r.status).toBe('manifest-silent');
  });
});

/**
 * Importers that write `image_source`, checked for a hard-coded licence literal.
 *
 * The probe looks for a `license:` line whose value is a quoted CC/PDM/rights string
 * rather than a variable — that is the shape of an assumption. A value read from a
 * manifest is an expression, so it does not match.
 */
const ASSUMED_LICENCE_LINE =
  /^\s*license(_url)?:\s*'(?:CC[-_ ]?BY[-_ ]?N[CD]|https?:\/\/creativecommons\.org\/licenses\/by-n[cd]|https?:\/\/rightsstatements\.org\/vocab\/(?:NoC-NC|InC))/i;

/**
 * Scoped to RESTRICTIVE literals — a hard-coded CC-BY-NC/ND, NoC-NC or In-Copyright.
 * That is the direction that costs us: it asserts a restriction the library never
 * stated, and it is what the BSB and Vatican defaults did.
 *
 * A hard-coded `license: 'publicdomain'` is the opposite error and a weaker one — it
 * appears in ~13 hand-curated single-book importers where an operator looked at the
 * item. Still an assumption in a field meant for observations, still worth fixing, but
 * it does not over-claim against us and it is not this check's job. Tracked separately;
 * `classifyStored` already labels the IA form `assumed-by-importer`.
 */
const ALLOWED: Record<string, string> = {
  'scripts/lib/rights-normalize.mjs': 'the vocabulary itself — these literals are the classification targets',
  'src/lib/import-utils.ts': 'parseLicense maps an OBSERVED manifest/attribution value onto its canonical spelling',
  'src/app/api/import/iiif/route.ts': 'same mapping, route copy; its provider-default block was removed (2026-09-19)',
};

function importerFiles(): string[] {
  let files: string[];
  try {
    files = execFileSync('git', ['grep', '-lE', String.raw`image_source`, '--', 'scripts/import', 'scripts/maintenance', 'src/app/api/import', 'src/lib'], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return files.filter((f) => /\.(mjs|ts|tsx|js)$/.test(f) && !/(^|\/)(_archived|tests)\//.test(f));
}

describe('no importer writes a licence the holding library did not state', () => {
  it('no hard-coded licence literal in an importer', () => {
    const offenders: string[] = [];
    for (const f of importerFiles()) {
      if (ALLOWED[f]) continue;
      const hits = readFileSync(path.join(REPO, f), 'utf8')
        .split('\n')
        .map((l, i) => [l, i + 1] as const)
        .filter(([l]) => ASSUMED_LICENCE_LINE.test(l));
      for (const [l, n] of hits) offenders.push(`${f}:${n}  ${l.trim()}`);
    }

    expect(
      offenders,
      [
        'These importers write a licence string the holding library may never have stated.',
        'Read it from the manifest (readManifestRights) and fall back to `unknown` —',
        'silence is not a licence. Provider knowledge goes in rights_normalized.status,',
        'not in image_source.license.',
      ].join(' '),
    ).toEqual([]);
  });

  it('the probe still matches something — a check that finds nothing proves nothing', () => {
    const files = importerFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('scripts/import/batch-import-istc-bsb.mjs');
    // And the probe genuinely fires on the shape it is meant to catch.
    expect(ASSUMED_LICENCE_LINE.test("        license: 'CC-BY-NC-4.0',")).toBe(true);
    expect(ASSUMED_LICENCE_LINE.test("        license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',")).toBe(true);
    expect(ASSUMED_LICENCE_LINE.test("        license: manifestRights.statement_uri,")).toBe(false);
    expect(ASSUMED_LICENCE_LINE.test("        license: 'unknown',")).toBe(false);
  });
});
