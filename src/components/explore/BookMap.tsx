'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type LocationType = 'publication' | 'author_birth' | 'author_death' | 'origin';

// Type bitmask — a book can have several roles in the same city (published here
// AND author born here). Storing the roles as bits lets the client filter by the
// active type toggles and still count each book once.
export const TYPE_BIT: Record<LocationType, number> = {
  publication: 1, author_birth: 2, author_death: 4, origin: 8,
};
const TYPE_BY_PRIORITY: LocationType[] = ['publication', 'author_birth', 'author_death', 'origin'];

/**
 * Lightweight per-city record shipped to the client. To keep the initial payload
 * small (~0.4 MB vs the old ~7 MB), each book is just its year (`y`, null if
 * undated) and a role bitmask (`m`); the full book list loads lazily from
 * /api/explore/map/city on click. Books are already deduped per city server-side.
 */
export interface BookLocation {
  city: string;
  country: string | null;
  lat: number;
  lng: number;
  books: Array<{ y: number | null; m: number }>;
}

/** Full book record, fetched lazily for the clicked city's sidebar. */
export interface CityBook {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  year: number | null;
  slug: string;
}

interface SelectedCity {
  city: string;
  country: string | null;
  type: LocationType;
  count: number;
}

interface BookMapProps {
  locations: BookLocation[];
  stats: {
    total_books: number;
    total_locations: number;
    by_type: Record<string, number>;
  };
}

const TYPE_CONFIG: Record<string, { color: string; label: string; lightBg: string }> = {
  publication:  { color: '#9e4a3a', label: 'Published here',  lightBg: 'rgba(158,74,58,0.1)' },
  author_birth: { color: '#5a7d8b', label: 'Author born here', lightBg: 'rgba(90,125,139,0.1)' },
  author_death: { color: '#8b7d5a', label: 'Author died here', lightBg: 'rgba(139,125,90,0.1)' },
  origin:       { color: '#6a8a5a', label: 'Tradition origin', lightBg: 'rgba(106,138,90,0.1)' },
};

function createLocationIcon(type: string, bookCount: number) {
  const config = TYPE_CONFIG[type] || { color: '#999' };
  const size = Math.max(8, Math.min(22, 6 + Math.log2(bookCount + 1) * 3));
  return L.divIcon({
    className: 'book-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background: ${config.color}; opacity: 0.85;
      border: 1.5px solid rgba(255,255,255,0.9);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      cursor: pointer;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function BookMap({ locations }: BookMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [selected, setSelected] = useState<SelectedCity | null>(null);
  const [cityBooks, setCityBooks] = useState<CityBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [filters, setFilters] = useState({
    types: new Set(['publication', 'author_birth', 'author_death', 'origin']),
    yearFrom: 800,
    yearTo: 2025,
  });
  // The year fields hold their own editable string so typing/clearing never
  // snaps back to the default mid-edit (the old `Number(value) || 800` bug).
  // Committed to `filters` (clamped) on blur or Enter.
  const [yearFromInput, setYearFromInput] = useState('800');
  const [yearToInput, setYearToInput] = useState('2025');
  const [zoom, setZoom] = useState(5);

  const commitYear = useCallback((which: 'yearFrom' | 'yearTo', raw: string) => {
    const n = parseInt(raw, 10);
    const fallback = which === 'yearFrom' ? 800 : 2025;
    const val = Number.isFinite(n) ? Math.min(2025, Math.max(800, n)) : fallback;
    if (which === 'yearFrom') setYearFromInput(String(val));
    else setYearToInput(String(val));
    setFilters((f) => ({ ...f, [which]: val }));
  }, []);

  // Bitmask of the currently-active type toggles.
  const selectedMask = useMemo(() => {
    let m = 0;
    for (const t of filters.types) m |= TYPE_BIT[t as LocationType] || 0;
    return m;
  }, [filters.types]);

  // Per-city pins: count books whose role is active and whose year is in range
  // (undated always counts), and derive the marker's dominant role. Books are
  // already deduped per city server-side, so each is counted once.
  const cityPins = useMemo(() => {
    const result: Array<{
      city: string; country: string | null; lat: number; lng: number;
      totalBooks: number; dominantType: LocationType; roles: LocationType[];
    }> = [];

    for (const loc of locations) {
      let count = 0;
      let orMask = 0;
      for (const b of loc.books) {
        if (!(b.m & selectedMask)) continue;
        if (b.y != null && (b.y < filters.yearFrom || b.y > filters.yearTo)) continue;
        count++;
        orMask |= b.m & selectedMask;
      }
      if (count === 0) continue;
      const roles = TYPE_BY_PRIORITY.filter((t) => orMask & TYPE_BIT[t]);
      result.push({
        city: loc.city, country: loc.country, lat: loc.lat, lng: loc.lng,
        totalBooks: count, dominantType: roles[0] ?? 'origin', roles,
      });
    }

    return result.sort((a, b) => b.totalBooks - a.totalBooks);
  }, [locations, selectedMask, filters.yearFrom, filters.yearTo]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [46, 10], zoom: 5,
      zoomControl: false, attributionControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; markersRef.current = null; };
  }, []);

  const handleSelect = useCallback((city: SelectedCity) => setSelected(city), []);

  // Lazy-load the clicked city's full book list (kept out of the initial payload).
  // Refetches when the year range or active types change while a city is open,
  // so the sidebar list stays consistent with the markers.
  useEffect(() => {
    if (!selected) { setCityBooks([]); setBooksLoading(false); return; }
    const ctrl = new AbortController();
    setBooksLoading(true);
    const params = new URLSearchParams({
      city: selected.city,
      country: selected.country ?? '',
      from: String(filters.yearFrom),
      to: String(filters.yearTo),
      types: [...filters.types].join(','),
    });
    fetch(`/api/explore/map/city?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .then((d) => setCityBooks(d.books || []))
      .catch(() => { if (!ctrl.signal.aborted) setCityBooks([]); })
      .finally(() => { if (!ctrl.signal.aborted) setBooksLoading(false); });
    return () => ctrl.abort();
  }, [selected, filters.types, filters.yearFrom, filters.yearTo]);

  // Render city pins
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersRef.current;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();

    const minBooksForZoom = zoom <= 3 ? 20 : zoom <= 4 ? 5 : 1;

    for (const pin of cityPins) {
      if (pin.totalBooks < minBooksForZoom) continue;
      const dominantType = pin.dominantType;

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createLocationIcon(dominantType, pin.totalBooks),
      });

      const typeLabels = pin.roles.map(t => TYPE_CONFIG[t]?.label || t).join(' · ');
      marker.bindTooltip(
        `<strong>${pin.city}</strong>${pin.country ? `<br/><span style="opacity:0.7">${pin.country}</span>` : ''}<br/>${pin.totalBooks} book${pin.totalBooks !== 1 ? 's' : ''}<br/><span style="opacity:0.5;font-size:10px">${typeLabels}</span>`,
        { direction: 'top', offset: [0, -6], className: 'book-tooltip' }
      );

      marker.on('click', () => {
        handleSelect({
          city: pin.city, country: pin.country,
          type: dominantType, count: pin.totalBooks,
        });
      });
      layerGroup.addLayer(marker);
    }
  }, [cityPins, zoom, handleSelect]);

  // Track zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, []);

  const bookCount = cityPins.reduce((s, p) => s + p.totalBooks, 0);

  return (
    <div className="relative h-[calc(100vh-64px)] min-h-[500px]">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Floating controls */}
      <div
        className="absolute top-4 left-4 right-4 lg:right-auto z-[1000] rounded-xl px-5 py-3.5 shadow-lg"
        style={{
          background: 'rgba(255,252,247,0.96)',
          border: '1px solid rgba(0,0,0,0.06)',
          backdropFilter: 'blur(12px)',
          maxWidth: '640px',
        }}
      >
        <h1
          className="text-base font-semibold tracking-tight mb-2.5"
          style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-primary)' }}
        >
          {bookCount.toLocaleString('en-US')} books across {cityPins.length.toLocaleString('en-US')} cities
        </h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {(['publication', 'author_birth', 'author_death', 'origin'] as const).map((type) => {
            const active = filters.types.has(type);
            const config = TYPE_CONFIG[type];
            return (
              <button
                key={type}
                onClick={() => {
                  setFilters((f) => {
                    const next = new Set(f.types);
                    if (next.has(type)) next.delete(type); else next.add(type);
                    return { ...f, types: next };
                  });
                }}
                className="flex items-center gap-1.5 text-sm transition-all"
                style={{ opacity: active ? 1 : 0.3 }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: config.color }} />
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {config.label}
                </span>
              </button>
            );
          })}

          <span className="w-px h-4" style={{ background: 'rgba(0,0,0,0.08)' }} />

          {/* Year range — type freely; applied on blur or Enter (no snap-back) */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={yearFromInput}
              onChange={(e) => setYearFromInput(e.target.value)}
              onBlur={(e) => commitYear('yearFrom', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              aria-label="From year"
              className="w-16 rounded-md px-2 py-1 text-xs text-center"
              style={{ border: '1px solid rgba(0,0,0,0.08)', color: 'var(--text-secondary)', background: 'transparent' }}
              min={800} max={2025}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
            <input
              type="number"
              inputMode="numeric"
              value={yearToInput}
              onChange={(e) => setYearToInput(e.target.value)}
              onBlur={(e) => commitYear('yearTo', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              aria-label="To year"
              className="w-16 rounded-md px-2 py-1 text-xs text-center"
              style={{ border: '1px solid rgba(0,0,0,0.08)', color: 'var(--text-secondary)', background: 'transparent' }}
              min={800} max={2025}
            />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {selected && (
        <div
          className="absolute bottom-0 left-0 right-0 max-h-[55vh] lg:top-4 lg:bottom-4 lg:right-4 lg:left-auto lg:w-80 lg:max-h-none lg:rounded-xl overflow-hidden z-[1000] shadow-xl"
          style={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(0,0,0,0.06)', backdropFilter: 'blur(12px)' }}
        >
          <div className="overflow-y-auto h-full">
            <div className="sticky top-0 z-10 px-5 pt-4 pb-3" style={{ background: 'rgba(255,252,247,0.97)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg leading-tight" style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {selected.city}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {selected.country && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{selected.country}</span>
                    )}
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                      style={{ background: TYPE_CONFIG[selected.type]?.lightBg, color: TYPE_CONFIG[selected.type]?.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_CONFIG[selected.type]?.color }} />
                      {TYPE_CONFIG[selected.type]?.label || selected.type}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 -mr-1 rounded-lg hover:bg-black/5 transition-colors" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {selected.count} book{selected.count !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="px-5 py-3 space-y-0.5">
              {booksLoading && cityBooks.length === 0 ? (
                <p className="text-[11px] px-2.5 py-2" style={{ color: 'var(--text-muted)' }}>Loading\u2026</p>
              ) : (
                <>
                  {cityBooks.slice(0, 50).map((book, i) => (
                    <a key={i} href={`/book/${book.slug || book.id}`} className="block px-2.5 py-2 -mx-2.5 rounded-lg hover:bg-black/[0.03] transition-colors">
                      <div className="text-[13px] leading-snug font-medium" style={{ color: 'var(--text-primary)' }}>
                        {(() => { const t = book.display_title || book.title; return t.length > 65 ? t.substring(0, 65) + '\u2026' : t; })()}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {book.author.length > 40 ? book.author.substring(0, 40) + '\u2026' : book.author}
                        {book.year ? `, ${book.year}` : ''}
                      </div>
                    </a>
                  ))}
                  {cityBooks.length > 50 && (
                    <p className="text-[11px] px-2.5 py-2" style={{ color: 'var(--text-muted)' }}>and {cityBooks.length - 50} more</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .book-tooltip { font-family: var(--font-sans); font-size: 12px; line-height: 1.4; padding: 6px 10px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid rgba(0,0,0,0.06); max-width: 200px; }
        .book-tooltip strong { font-weight: 600; color: var(--text-primary); }
        .book-marker { background: none !important; border: none !important; }
        .leaflet-control-zoom a { border-radius: 8px !important; width: 32px !important; height: 32px !important; line-height: 32px !important; font-size: 16px !important; color: var(--text-secondary) !important; border-color: rgba(0,0,0,0.06) !important; background: rgba(255,252,247,0.95) !important; }
        .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important; border-radius: 10px !important; overflow: hidden; }
        .leaflet-container { background: #f5f0e8; }
      `}</style>
    </div>
  );
}
