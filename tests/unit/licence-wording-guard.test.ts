import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { CONTENT_LICENSE, CONTENT_LICENSE_NAME, dcRightsForBook } from '@/lib/license-info';

// Source Library's own text is CC BY-NC-SA 4.0 since 2026-11-05 (/terms, #8217).
// Until #8488 about 40 surfaces still said CC BY-SA, so the site gave a reader,
// a library or a company two answers. This guard fails when "BY-SA" without
// "NC" appears in src/ or public/ outside the places that name SOMEONE ELSE'S
// licence (a holding library, Wikisource, Kanripo, a Wikimedia photo) or the
// licence picker that has to keep offering it for editions already minted.
//
// A new hit is almost always our licence written the old way: change it to
// CONTENT_LICENSE (src/lib/license-info.ts). If it really is a third party's
// licence, add the file here with its count and the reason.
const repoRoot = path.resolve(__dirname, '..', '..');

// "BY-SA" / "BY SA" / "by_sa" as a token, the deed URL, or the long name.
// "BY-NC-SA" and "NonCommercial-ShareAlike" do not match. Letter lookarounds,
// not \b: "by saṃvara" in a Jain quotation is not a licence.
const BY_SA = /(?<![\p{L}\d])by[- _]sa(?![\p{L}\d])|by-sa\/|attribution-sharealike/iu;

const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/app/terms/page.tsx': { count: 1, why: 'says copies obtained before 2026-11-05 stay under CC BY-SA' },
  'src/app/licensing/page.tsx': { count: 1, why: 'says copies obtained before 2026-11-05 stay under CC BY-SA' },
  'src/lib/license-info.ts': { count: 2, why: 'reads the old backfilled dc_rights value as the current licence' },
  'src/app/ai-partners/content.ts': { count: 1, why: "a holding library's licence class for scans" },
  'src/app/research/quality/page.tsx': { count: 3, why: 'licences of Wikisource, Perseus/First1KGreek and Kanripo reference texts' },
  'src/app/articles/trees-of-life/page.tsx': { count: 1, why: 'credit line of a Wikimedia Commons photo' },
  'src/components/articles/PageFigure.tsx': { count: 1, why: 'which outside image licences an article may use' },
  'src/app/artwork/[slug]/page.tsx': { count: 1, why: "comment on a stored artwork's free-text licence" },
  'src/app/api/import/hab/route.ts': { count: 1, why: "Herzog August Bibliothek's licence for its scans" },
  'src/app/api/import/iiif/route.ts': { count: 1, why: "parses a source manifest's licence URL" },
  'src/lib/import-utils.ts': { count: 3, why: "parses a source's licence statement" },
  'src/lib/types/image-source.ts': { count: 2, why: 'names of image licences a source may state' },
  'src/app/api/iiif/[id]/manifest/route.ts': { count: 1, why: "maps a stored image licence id to its URI" },
  'src/components/seo/schema-utils.ts': { count: 1, why: 'maps a stored edition/image licence id to its URI' },
  'src/lib/zenodo.ts': { count: 1, why: 'maps a stored edition licence to Zenodo; minted editions keep CC BY-SA' },
  'src/app/api/books/[id]/editions/route.ts': { count: 1, why: 'edition licence options; minted editions keep CC BY-SA' },
  'src/app/api/[tenant]/books/[id]/editions/route.ts': { count: 1, why: 'edition licence options; minted editions keep CC BY-SA' },
  'src/components/editions/PublishEditionButton.tsx': { count: 1, why: 'edition licence options; default is CC BY-NC-SA' },
  'src/components/pipeline/PipelineConfig.tsx': { count: 1, why: 'edition licence options; default is CC BY-NC-SA' },
};

function hitsByFile(): Record<string, number> {
  const files = execFileSync('git', ['ls-files', 'src', 'public'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(tsx?|jsx?|mjs|json|md|txt|xml|html)$/.test(f));
  const hits: Record<string, number> = {};
  for (const f of files) {
    const n = readFileSync(path.join(repoRoot, f), 'utf8').split('\n').filter((l) => BY_SA.test(l)).length;
    if (n) hits[f] = n;
  }
  return hits;
}

describe('licence wording (#8488)', () => {
  it('matches BY-SA but not BY-NC-SA', () => {
    expect(BY_SA.test('CC BY-SA 4.0')).toBe(true);
    expect(BY_SA.test("'CC-BY-SA-4.0'")).toBe(true);
    expect(BY_SA.test('https://creativecommons.org/licenses/by-sa/4.0/')).toBe(true);
    expect(BY_SA.test('Creative Commons Attribution-ShareAlike 4.0')).toBe(true);
    expect(BY_SA.test('CC BY-NC-SA 4.0')).toBe(false);
    expect(BY_SA.test('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(false);
    expect(BY_SA.test('Attribution-NonCommercial-ShareAlike')).toBe(false);
    expect(BY_SA.test('stopped by saṃvara')).toBe(false);
  });

  it('src/ and public/ say CC BY-SA only where it names a licence other than ours', () => {
    const hits = hitsByFile();
    const unexpected = Object.entries(hits)
      .filter(([f, n]) => !ALLOWED[f] || n > ALLOWED[f].count)
      .map(([f, n]) => `${f}: ${n} line(s) say BY-SA${ALLOWED[f] ? ` (allowed ${ALLOWED[f].count})` : ''}`);
    expect(unexpected, 'Our text is CONTENT_LICENSE (CC BY-NC-SA 4.0); see the header of this test').toEqual([]);
  });

  it('keeps the allowlist honest: every entry still has its hits', () => {
    const hits = hitsByFile();
    const stale = Object.entries(ALLOWED)
      .filter(([f, { count }]) => (hits[f] ?? 0) < count)
      .map(([f, { count }]) => `${f}: allowed ${count}, found ${hits[f] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it('our licence is CC BY-NC-SA 4.0, and the old backfilled dc_rights reads as it', () => {
    expect(CONTENT_LICENSE.url).toBe('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(CONTENT_LICENSE_NAME).toBe('CC BY-NC-SA 4.0');
    expect(dcRightsForBook('CC BY-SA 4.0')).toBe('CC BY-NC-SA 4.0');
    expect(dcRightsForBook(undefined)).toBe('CC BY-NC-SA 4.0');
    expect(dcRightsForBook('Open access')).toBe('Open access');
    expect(dcRightsForBook('PDM 1.0')).toBe('PDM 1.0');
  });
});
