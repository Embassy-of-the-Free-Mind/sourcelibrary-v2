export const BASE_URL = 'https://sourcelibrary.org';

/**
 * Creative Commons Public Domain Mark — the default `license` for facsimiles
 * of our pre-1900 originals. A stored per-book/per-edition license overrides.
 */
export const PUBLIC_DOMAIN_MARK_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

export function getLicenseUrl(license: string): string {
  const licenseUrls: Record<string, string> = {
    'publicdomain': 'https://creativecommons.org/publicdomain/mark/1.0/',
    'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
    'CC-BY-NC-SA-4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  };
  return licenseUrls[license] || license;
}
