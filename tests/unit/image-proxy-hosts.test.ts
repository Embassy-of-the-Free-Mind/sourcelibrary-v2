import { describe, it, expect } from 'vitest';
import { isAllowedImageHost, isForbiddenAddress, refuseImageUrl } from '@/lib/image-proxy-hosts';

/**
 * `/api/image?url=…` fetches a caller-supplied URL server-side, so this policy
 * is the only thing between a stranger and our outbound network.
 *
 * The bug these pin: the original check was `hostname.endsWith(host)` with no
 * dot boundary, so anyone who registered a domain ending in an allowlisted
 * string owned the proxy. Combined with axios's default redirect-following,
 * that was a route to arbitrary internal addresses.
 */
describe('image proxy host policy', () => {
  describe('legitimate sources still work', () => {
    it.each([
      'archive.org',
      'ia801504.us.archive.org',
      'gallica.bnf.fr',
      'images.sourcelibrary.org',
      'pub-abc123.r2.dev',
      'my-bucket.s3.eu-central-1.amazonaws.com',
      'upload.wikimedia.org',
      'iiif.bodleian.ox.ac.uk',
      'www.e-rara.ch',
    ])('allows %s', host => {
      expect(isAllowedImageHost(host)).toBe(true);
    });
  });

  describe('suffix-glue lookalikes are refused', () => {
    // Every one of these passed the old `endsWith` check.
    it.each([
      'evilarchive.org',
      'xr2.dev',
      'notamazonaws.com',
      'my-archive.org',
      'faker2.dev',
      'attacker-e-rara.ch',
      'notgallica.bnf.fr',
    ])('refuses %s', host => {
      expect(isAllowedImageHost(host)).toBe(false);
    });

    it('refuses a host that merely contains an allowed domain', () => {
      expect(isAllowedImageHost('archive.org.attacker.com')).toBe(false);
    });

    it('is not fooled by a trailing root dot', () => {
      expect(isAllowedImageHost('evilarchive.org.')).toBe(false);
      expect(isAllowedImageHost('archive.org.')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isAllowedImageHost('EvilArchive.ORG')).toBe(false);
      expect(isAllowedImageHost('Archive.ORG')).toBe(true);
    });
  });

  describe('private and metadata addresses are refused', () => {
    it.each([
      '169.254.169.254',   // cloud instance metadata
      '127.0.0.1',
      '10.0.0.5',
      '172.16.4.4',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',        // CGNAT
      '0.0.0.0',
      'localhost',
      'redis.internal',
      '::1',
      'fe80::1',
      '::ffff:169.254.169.254',
    ])('refuses %s', host => {
      expect(isForbiddenAddress(host)).toBe(true);
      expect(isAllowedImageHost(host)).toBe(false);
    });

    it('does not refuse public addresses that merely look adjacent', () => {
      expect(isForbiddenAddress('172.32.0.1')).toBe(false);  // just outside RFC1918
      expect(isForbiddenAddress('169.253.0.1')).toBe(false);
      expect(isForbiddenAddress('11.0.0.1')).toBe(false);
    });
  });

  describe('refuseImageUrl', () => {
    it('accepts a real source URL', () => {
      expect(refuseImageUrl('https://ia801504.us.archive.org/page/n1.jpg')).toBeNull();
    });

    it('refuses non-http protocols', () => {
      expect(refuseImageUrl('file:///etc/passwd')).toBeTruthy();
      expect(refuseImageUrl('gopher://archive.org/')).toBeTruthy();
      expect(refuseImageUrl('data:image/png;base64,AAAA')).toBeTruthy();
    });

    it('refuses malformed input', () => {
      expect(refuseImageUrl('not a url')).toBeTruthy();
      expect(refuseImageUrl('')).toBeTruthy();
    });

    it('refuses credentials-in-host confusion', () => {
      // Parses to host `evil.com`, not `archive.org`.
      expect(refuseImageUrl('https://archive.org@evil.com/x.jpg')).toBeTruthy();
    });

    it('refuses the metadata endpoint outright', () => {
      expect(refuseImageUrl('http://169.254.169.254/latest/meta-data/')).toBeTruthy();
    });
  });
});
