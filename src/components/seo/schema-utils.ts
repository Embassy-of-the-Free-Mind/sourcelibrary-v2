export const BASE_URL = 'https://sourcelibrary.org';

export function getLicenseUrl(license: string): string {
  const licenseUrls: Record<string, string> = {
    'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
    'CC-BY-NC-SA-4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  };
  return licenseUrls[license] || license;
}
