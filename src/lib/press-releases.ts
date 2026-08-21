/**
 * Press release registry.
 *
 * Each release has a `status` of 'draft' or 'published'. Published releases are
 * listed publicly at /press-releases and indexed by search engines. Drafts are
 * hidden from the public index and marked noindex, but remain reachable by
 * direct URL (and appear in the index when ?preview=1 is present) so they can be
 * shared for review before going live.
 *
 * The release body itself lives as a React component in
 * src/components/press/releases/, keyed by slug in
 * src/app/press-releases/[slug]/page.tsx. This file holds only the metadata used
 * for listing, routing, and SEO.
 */

export type PressReleaseStatus = 'draft' | 'published';

export interface PressReleaseMeta {
  /** URL slug: /press-releases/<slug> */
  slug: string;
  /** Headline shown in the hero and index card */
  title: string;
  /** One-line standfirst */
  subtitle: string;
  /** Human dateline shown under the headline, e.g. "4 June 2026 · Amsterdam" */
  dateline: string;
  /** ISO date used for sorting (newest first) */
  date: string;
  status: PressReleaseStatus;
  /** Short blurb for the index card */
  summary: string;
  /** <meta name="description"> for the detail page */
  metaDescription: string;
  /** Optional OpenGraph image override */
  ogImage?: string;
}

export const PRESS_RELEASES: PressReleaseMeta[] = [
  {
    slug: 'source-library-public-beta-launch',
    title: 'The Embassy of the Free Mind Launches Source Library',
    subtitle:
      'The largest freely available collection of translated historical primary sources ever assembled — free to read beside their originals',
    dateline: '4 June 2026 · Amsterdam, the Netherlands',
    date: '2026-06-04',
    status: 'published',
    summary:
      'The Embassy of the Free Mind announces the public beta of Source Library: an open-access library that opens with 15,000+ books in 55+ languages, 15,000+ translated into English — 6,000+ for the first time ever, roughly 7 billion words in all — each read beside a scan of the original page.',
    metaDescription:
      'The Embassy of the Free Mind launches Source Library, an open-access library of translated historical primary sources. At beta it spans 15,000+ books in 55+ languages, 15,000+ translated into English and 6,000+ first-ever English translations — roughly 7 billion words, about the size of the entire English Wikipedia — each read beside the original page.',
    ogImage: 'https://sourcelibrary.org/og-image.jpg',
  },
  {
    slug: 'embassy-free-mind-announces-source-library',
    title: 'Embassy of the Free Mind Announces Source Library',
    subtitle:
      'The world’s largest collection of translated ancient and early modern texts',
    dateline: 'March 2026 · Amsterdam, the Netherlands',
    date: '2026-03-21',
    status: 'published',
    summary:
      'The original public-beta announcement: a free digital library beginning from the Bibliotheca Philosophica Hermetica, with thousands of works translated into English for the first time.',
    metaDescription:
      "The Embassy of the Free Mind announces the public beta of Source Library, the world's largest collection of translated ancient and early modern texts.",
    ogImage: 'https://sourcelibrary.org/og-image.jpg',
  },
];

/** Releases visible to the public, newest first. */
export function publishedReleases(): PressReleaseMeta[] {
  return PRESS_RELEASES.filter((r) => r.status === 'published').sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

/** All releases (published + draft), newest first — for the preview index. */
export function allReleases(): PressReleaseMeta[] {
  return [...PRESS_RELEASES].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPressRelease(slug: string): PressReleaseMeta | undefined {
  return PRESS_RELEASES.find((r) => r.slug === slug);
}

/** Newest published release, used as the redirect target for the legacy /press-release URL. */
export function latestPublishedRelease(): PressReleaseMeta | undefined {
  return publishedReleases()[0];
}
