import { describe, it, expect } from 'vitest';
import { iaTextLicence, iaProvenance } from '../../scripts/lib/ia-ocr-meta.mjs';

/**
 * Pins the rights record on Archive-OCR pages (#4763). The rule is the US 95-year term counted from
 * the run date, so the boundary moves each January; a writer must never guess a status it cannot
 * derive from the publication year.
 */
describe('iaTextLicence', () => {
  const in2026 = new Date('2026-10-23T00:00:00Z');

  it('marks an edition published 1930 or earlier public domain in 2026', () => {
    const l = iaTextLicence({}, 1930, in2026);
    expect(l.status).toBe('publicdomain');
    expect(l.licence_url).toMatch(/publicdomain\/mark/);
  });

  it('does not mark 1931 public domain until 2027', () => {
    expect(iaTextLicence({}, 1931, in2026).status).toBe('not_recorded');
    expect(iaTextLicence({}, 1931, new Date('2027-01-01T00:00:00Z')).status).toBe('publicdomain');
  });

  it('records an unknown year as not_recorded, with no licence url', () => {
    const l = iaTextLicence({}, null, in2026);
    expect(l.status).toBe('not_recorded');
    expect(l.licence_url).toBeNull();
  });

  it('keeps what the item itself says beside the verdict', () => {
    const l = iaTextLicence({ rights: 'Public Domain', licenseurl: 'http://x', copyright_status: 'NOT_IN_COPYRIGHT', access_restricted: true }, 1900, in2026);
    expect(l).toMatchObject({ ia_rights: 'Public Domain', ia_licenseurl: 'http://x', ia_copyright_status: 'NOT_IN_COPYRIGHT', ia_access_restricted: true });
  });

  it('is part of every ocr.ia block', () => {
    expect(iaProvenance('item', {}, { year: 1905 }).licence.status).toBe('publicdomain');
    expect(iaProvenance('item', {}).licence.status).toBe('not_recorded');
  });
});
