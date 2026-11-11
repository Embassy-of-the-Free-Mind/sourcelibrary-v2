import { resolveBookProvenance } from '@/lib/book-provenance';
import { displayedImageRights, libraryRightsUri, type LibraryRightsStatement } from '@/lib/types/image-source';

export const BASE_URL = 'https://sourcelibrary.org';

/**
 * Creative Commons Public Domain Mark. A rights statement, never a default: use it only
 * where a source said so. See `imageRightsFields`.
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

export interface ImageRightsSource {
  provider?: string | null;
  provider_name?: string | null;
  contributing_library?: string | null;
  sponsor?: string | null;
  license?: string | null;
  attribution?: string | null;
  rights_normalized?: LibraryRightsStatement | null;
}

/** A licence URI for a record no library has spoken for: only a value someone actually gave. */
function unverifiedLicenseUrl(src: ImageRightsSource | null | undefined, stored?: string | null): string | undefined {
  if (src?.rights_normalized?.status === 'assumed-by-importer') return undefined;
  const raw = src?.license || stored;
  // `publicdomain` with no statement behind it is the importer's default, not a finding.
  if (!raw || raw === 'unknown' || raw === 'publicdomain') return undefined;
  const url = getLicenseUrl(raw);
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** Who made the scan, by name. Stored `provider` values are keys such as `internet_archive`. */
function digitizedBy(src: ImageRightsSource | null | undefined): string | undefined {
  const p = resolveBookProvenance(src ?? undefined);
  const name = (p.digitiserIsFunder ? undefined : p.digitiser) || p.host || p.holder;
  return name ? `Digitized by ${name}` : undefined;
}

/**
 * The schema.org rights fields for an image. They state only what a source said. Search
 * engines show `license` as a fact about the picture, and a crop of a public-domain page
 * adds no copyright but does not clear the library's terms either, so a record nobody
 * verified carries no licence and no notice rather than a public-domain default.
 */
export function imageRightsFields(
  src: ImageRightsSource | null | undefined,
  { published, licensePage, storedLicense }: { published?: string; licensePage?: string; storedLicense?: string | null },
): { license?: string; acquireLicensePage?: string; copyrightNotice?: string; creditText?: string } {
  const statedUri = libraryRightsUri(src);
  const shown = displayedImageRights(src);
  const license = statedUri === undefined ? unverifiedLicenseUrl(src, storedLicense) : statedUri ?? undefined;
  const creditText = shown.credit || digitizedBy(src);
  return {
    ...(license && { license }),
    ...(license && licensePage && { acquireLicensePage: licensePage }),
    ...(shown.fromLibrary && shown.license && {
      copyrightNotice: `${shown.license.name}.${published ? ` Original published ${published}.` : ''}`,
    }),
    ...(creditText && { creditText }),
  };
}
