import { Search } from 'lucide-react';

/**
 * Graceful in-catalogue landing for when a reading-room URL can't resolve to a
 * readable book or a catalogue record. The catalogue is a finding aid — it must
 * never dead-end on a 404. Used by:
 *   - the catalogue record page ([tenant]/catalog/[ubn]) when no catalogue row
 *     is found, and
 *   - the reading-room book route ([tenant]/book/[slug]) when a catalogued item
 *     is hidden/not-yet-available and has no catalogue entry to redirect to.
 *
 * Server component (no client hooks) so it can render inside either route. The
 * `/catalog` "New search" link is host-relative and proxy-rewritten to the
 * tenant's catalogue search view — never an off-subdomain URL (tenant lockdown).
 */
export default function CatalogueUnavailable({
  heading,
  detail,
}: {
  heading: string;
  detail: string;
}) {
  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-4">
          <a
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            New search
          </a>
        </div>
        <h1 className="text-xl font-semibold text-primary mb-2">{heading}</h1>
        <p className="text-secondary text-sm leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
