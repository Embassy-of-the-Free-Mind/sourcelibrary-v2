'use client';

/**
 * Citation jump box for canon work pages with a registered locus system:
 * type "328b", land on the leaf that carries it (via /work/[slug]/at/[ref]).
 *
 * The miss notice reads ?locus_miss= client-side (useSearchParams inside
 * Suspense) so the server-rendered page stays fully static/ISR — reading
 * searchParams in the server component would force dynamic rendering.
 */
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function MissNotice() {
  const searchParams = useSearchParams();
  const missed = searchParams.get('locus_miss');
  if (!missed) return null;
  return (
    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
      No leaf in our registered editions carries &ldquo;{missed}&rdquo;. The reference may be
      outside the ranges we hold anchors for — nothing is interpolated, so we only land on
      pages where the number was actually printed.
    </p>
  );
}

export default function LocusJumpBox({
  workSlug,
  systemLabel,
  example,
}: {
  workSlug: string;
  /** "Bekker" | "Stephanus" */
  systemLabel: string;
  /** Placeholder reference, e.g. "1094a" or "328b" */
  example: string;
}) {
  const [value, setValue] = useState('');
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const ref = value.trim();
        if (ref) router.push(`/work/${workSlug}/at/${encodeURIComponent(ref)}`);
      }}
      className="rounded-xl border border-stone-200 bg-white p-4"
    >
      <label htmlFor="locus-ref" className="block text-sm font-medium text-stone-700">
        Jump to a {systemLabel} reference
      </label>
      <p className="text-xs text-stone-500 mt-0.5 mb-2">
        Standard citations land on the exact leaf — e.g. {example}.
      </p>
      <div className="flex gap-2">
        <input
          id="locus-ref"
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={example}
          className="flex-1 min-w-0 rounded-lg border border-stone-300 px-3 py-1.5 text-base text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
        />
        <button
          type="submit"
          className="rounded-lg bg-stone-800 hover:bg-stone-700 text-white text-sm px-4 py-1.5 transition-colors"
        >
          Go
        </button>
      </div>
      <Suspense fallback={null}>
        <MissNotice />
      </Suspense>
    </form>
  );
}
