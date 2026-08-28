'use client';

import FacetList, { type FacetOption } from './FacetList';
import RangeFacet, { type HistogramBucket, type RangePreset } from './RangeFacet';
import ToggleFacet from './ToggleFacet';
import {
  TEXT_ROLES,
  TEXT_ROLE_LABELS,
  toggleValue,
  type CatalogFilters,
} from '@/lib/catalog-query';
import type { CatalogFacetsProp } from './catalog-types';

const YEAR_PRESETS: RangePreset[] = [
  { label: 'Pre-1500', min: null, max: 1499 },
  { label: '1500s', min: 1500, max: 1599 },
  { label: '1600s', min: 1600, max: 1699 },
  { label: '1700s', min: 1700, max: 1799 },
  { label: '1800+', min: 1800, max: null },
];

const LENGTH_PRESETS: RangePreset[] = [
  { label: 'Under 100', min: null, max: 99 },
  { label: '100–500', min: 100, max: 500 },
  { label: 'Over 500', min: 501, max: null },
];

interface FilterRailProps {
  filters: CatalogFilters;
  facets: CatalogFacetsProp;
  collectionNames: Record<string, string>;
  categoryNames: Record<string, string>;
  providerNames: Record<string, string>;
  apply: (patch: Partial<CatalogFilters>) => void;
}

/**
 * Every filter the library offers, all visible at once.
 *
 * A rail rather than a row of dropdowns: with eight dimensions, a dropdown per
 * dimension means the reader can never see what they have narrowed without
 * opening things one at a time, and each open menu covers the results it is
 * describing. A rail states the whole query at a glance and costs nothing but
 * width, which a cover grid has to spare.
 */
export default function FilterRail({
  filters, facets, collectionNames, categoryNames, providerNames, apply,
}: FilterRailProps) {
  const languageOptions: FacetOption[] = facets.languages.map((l) => ({
    value: l.value, label: l.value, count: l.count,
  }));
  const categoryOptions: FacetOption[] = facets.categories
    .filter((c) => categoryNames[c.value])
    .map((c) => ({ value: c.value, label: categoryNames[c.value], count: c.count }));
  const collectionOptions: FacetOption[] = facets.collections
    .filter((c) => collectionNames[c.value])
    .map((c) => ({ value: c.value, label: collectionNames[c.value], count: c.count }));
  const providerOptions: FacetOption[] = facets.providers
    .filter((p) => providerNames[p.value])
    .map((p) => ({ value: p.value, label: providerNames[p.value], count: p.count }));
  const roleCount = (role: string) => facets.textRoles.find((r) => r.value === role)?.count;

  const yearBuckets: HistogramBucket[] = facets.decades.map((d) => ({
    key: d.year, count: d.count, min: d.year, max: d.year + 49,
  }));

  return (
    <div className="flex flex-col gap-7">
      <FacetList
        label="Language"
        options={languageOptions}
        selected={filters.languages}
        onToggle={(v) => apply({ languages: toggleValue(filters.languages, v) })}
        onClear={() => apply({ languages: [] })}
        placeholder="Find a language…"
      />

      <FacetList
        label="Subject"
        options={categoryOptions}
        selected={filters.categories}
        onToggle={(v) => apply({ categories: toggleValue(filters.categories, v) })}
        onClear={() => apply({ categories: [] })}
        placeholder="Find a subject…"
      />

      <FacetList
        label="Collection"
        options={collectionOptions}
        selected={filters.collections}
        onToggle={(v) => apply({ collections: toggleValue(filters.collections, v) })}
        onClear={() => apply({ collections: [] })}
        placeholder="Find a collection…"
      />

      <RangeFacet
        label="Printed"
        min={filters.yearMin}
        max={filters.yearMax}
        onChange={(min, max) => apply({ yearMin: min, yearMax: max })}
        presets={YEAR_PRESETS}
        buckets={yearBuckets}
        fromPlaceholder="From"
        toPlaceholder="To"
      />

      <ToggleFacet
        label="What we hold"
        onClear={() => apply({ hasTranslation: false, hasOcr: false, firstTranslation: false, hasDoi: false })}
        rows={[
          {
            key: 'hasTranslation',
            label: 'Readable in English',
            count: facets.translated,
            on: filters.hasTranslation,
            onChange: (on) => apply({ hasTranslation: on }),
            hint: 'At least one page translated into English',
          },
          {
            key: 'hasOcr',
            label: 'Transcribed',
            count: facets.transcribed,
            on: filters.hasOcr,
            onChange: (on) => apply({ hasOcr: on }),
            hint: 'At least one page transcribed from the scan',
          },
          {
            key: 'firstTranslation',
            label: 'First translation',
            count: facets.firstTranslations,
            on: filters.firstTranslation,
            onChange: (on) => apply({ firstTranslation: on }),
            hint: 'Books carrying the first-translation claim on their card',
          },
          {
            key: 'hasDoi',
            label: 'Has a DOI',
            count: facets.withDoi,
            on: filters.hasDoi,
            onChange: (on) => apply({ hasDoi: on }),
            hint: 'Citable with a registered identifier',
          },
        ]}
      />

      <ToggleFacet
        label="Edition"
        onClear={() => apply({ textRoles: [] })}
        rows={TEXT_ROLES.map((role) => ({
          key: role,
          label: TEXT_ROLE_LABELS[role],
          count: roleCount(role),
          on: filters.textRoles.includes(role),
          onChange: () => apply({ textRoles: toggleValue(filters.textRoles, role) }),
        }))}
      />

      <FacetList
        label="Held by"
        options={providerOptions}
        selected={filters.providers}
        onToggle={(v) => apply({ providers: toggleValue(filters.providers, v) })}
        onClear={() => apply({ providers: [] })}
        placeholder="Find a library…"
        rows={6}
      />

      <RangeFacet
        label="Length"
        min={filters.pagesMin}
        max={filters.pagesMax}
        onChange={(min, max) => apply({ pagesMin: min, pagesMax: max })}
        presets={LENGTH_PRESETS}
        fromPlaceholder="Min pages"
        toPlaceholder="Max"
      />
    </div>
  );
}
