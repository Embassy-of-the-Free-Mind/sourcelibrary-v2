'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { catalogueHref } from '@/lib/tenant-global-paths';

/** A link into the catalogue from a page that also renders on partner hosts, where /library does not answer. */
export default function CatalogueLink({ query = '', className, children }: { query?: string; className?: string; children: ReactNode }) {
  return <Link href={`${catalogueHref(useIsEmbedded())}${query}`} className={className}>{children}</Link>;
}
