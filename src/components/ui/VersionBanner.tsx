'use client';

interface VersionBannerProps {
  version: string;
  versionLabel?: string;
  publishedAt: string; // ISO date string
  isCurrentVersion: boolean;
  doi?: string;
  doiUrl?: string;
  bookUrl: string; // URL without ?v= to link to current version
}

export default function VersionBanner({
  version,
  versionLabel,
  publishedAt,
  isCurrentVersion,
  doi,
  doiUrl,
  bookUrl,
}: VersionBannerProps) {
  const date = new Date(publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const label = versionLabel ? `${versionLabel} (v${version})` : `v${version}`;

  if (isCurrentVersion) {
    return (
      <div className="bg-stone-100 border-b border-stone-200 px-4 py-2 text-center text-sm text-stone-600">
        Edition {label} &middot; Published {date}
        {doiUrl && (
          <>
            {' '}&middot;{' '}
            <a href={doiUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-900">
              DOI
            </a>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
      You are viewing edition {label}, published {date}. The translation has since been updated.{' '}
      <a href={bookUrl} className="underline font-medium hover:text-amber-950">
        View current edition &rarr;
      </a>
      {doiUrl && (
        <>
          {' '}&middot;{' '}
          <a href={doiUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-950">
            DOI
          </a>
        </>
      )}
    </div>
  );
}
