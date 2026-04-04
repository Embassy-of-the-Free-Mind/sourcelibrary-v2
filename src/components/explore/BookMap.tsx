'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface BookLocation {
  city: string;
  country: string | null;
  lat: number;
  lng: number;
  type: 'publication' | 'author_birth' | 'author_death';
  books: Array<{
    id: string;
    title: string;
    display_title?: string;
    author: string;
    year: number | null;
    slug: string;
  }>;
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

  const [selected, setSelected] = useState<BookLocation | null>(null);
  const [filters, setFilters] = useState({
    types: new Set(['publication', 'author_birth', 'author_death']),
    minBooks: 1,
    yearFrom: 800,
    yearTo: 2025,
  });
  const [zoom, setZoom] = useState(5);

  // Filter by type
  const typeFiltered = useMemo(() => {
    return locations.filter((loc) => filters.types.has(loc.type));
  }, [locations, filters.types]);

  // Merge by city NAME (not coords) to fix duplicate pin issue
  const cityPins = useMemo(() => {
    const byCity = new Map<string, {
      city: string; country: string | null; lat: number; lng: number;
      books: BookLocation['books']; types: Set<string>; totalBooks: number;
    }>();

    for (const loc of typeFiltered) {
      const key = `${loc.city}|${loc.country || ''}`;
      const existing = byCity.get(key);
      if (existing) {
        const existingIds = new Set(existing.books.map(b => b.id));
        for (const b of loc.books) {
          if (!existingIds.has(b.id) && existing.books.length < 200) {
            existing.books.push(b);
          }
        }
        existing.types.add(loc.type);
        existing.totalBooks += loc.books.length;
        if (loc.type === 'publication') {
          existing.lat = loc.lat;
          existing.lng = loc.lng;
        }
      } else {
        byCity.set(key, {
          city: loc.city, country: loc.country, lat: loc.lat, lng: loc.lng,
          books: [...loc.books], types: new Set([loc.type]), totalBooks: loc.books.length,
        });
      }
    }

    const result: Array<typeof byCity extends Map<string, infer V> ? V : never> = [];
    for (const pin of byCity.values()) {
      const yearFiltered = pin.books.filter(b => {
        if (!b.year) return true;
        return b.year >= filters.yearFrom && b.year <= filters.yearTo;
      });
      if (yearFiltered.length < filters.minBooks) continue;
      result.push({ ...pin, books: yearFiltered, totalBooks: yearFiltered.length });
    }

    return result.sort((a, b) => b.totalBooks - a.totalBooks);
  }, [typeFiltered, filters.minBooks, filters.yearFrom, filters.yearTo]);

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

  const handleSelect = useCallback((loc: BookLocation) => setSelected(loc), []);

  // Render city pins
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersRef.current;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();

    const minBooksForZoom = zoom <= 3 ? 20 : zoom <= 4 ? 5 : 1;

    for (const pin of cityPins) {
      if (pin.totalBooks < minBooksForZoom) continue;
      const dominantType = pin.types.has('publication') ? 'publication'
        : pin.types.has('author_birth') ? 'author_birth' : 'author_death';

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createLocationIcon(dominantType, pin.totalBooks),
      });

      const typeLabels = [...pin.types].map(t => TYPE_CONFIG[t]?.label || t).join(' · ');
      marker.bindTooltip(
        `<strong>${pin.city}</strong>${pin.country ? `<br/><span style="opacity:0.7">${pin.country}</span>` : ''}<br/>${pin.totalBooks} book${pin.totalBooks !== 1 ? 's' : ''}<br/><span style="opacity:0.5;font-size:10px">${typeLabels}</span>`,
        { direction: 'top', offset: [0, -6], className: 'book-tooltip' }
      );

      marker.on('click', () => {
        handleSelect({
          city: pin.city, country: pin.country,
          lat: pin.lat, lng: pin.lng, type: dominantType,
          books: pin.books.slice(0, 200),
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
          {bookCount.toLocaleString()} books across {cityPins.length.toLocaleString()} cities
        </h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {(['publication', 'author_birth', 'author_death'] as const).map((type) => {
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
                  {type === 'publication' ? 'Published' : type === 'author_birth' ? 'Born' : 'Died'}
                </span>
              </button>
            );
          })}

          <span className="w-px h-4" style={{ background: 'rgba(0,0,0,0.08)' }} />

          {/* Year range */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={filters.yearFrom}
              onChange={(e) => setFilters(f => ({ ...f, yearFrom: Number(e.target.value) || 800 }))}
              className="w-16 rounded-md px-2 py-1 text-xs text-center"
              style={{ border: '1px solid rgba(0,0,0,0.08)', color: 'var(--text-secondary)', background: 'transparent' }}
              min={800} max={2025}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
            <input
              type="number"
              value={filters.yearTo}
              onChange={(e) => setFilters(f => ({ ...f, yearTo: Number(e.target.value) || 2025 }))}
              className="w-16 rounded-md px-2 py-1 text-xs text-center"
              style={{ border: '1px solid rgba(0,0,0,0.08)', color: 'var(--text-secondary)', background: 'transparent' }}
              min={800} max={2025}
            />
          </div>

          <span className="w-px h-4 hidden sm:block" style={{ background: 'rgba(0,0,0,0.08)' }} />

          <select
            value={filters.minBooks}
            onChange={(e) => setFilters((f) => ({ ...f, minBooks: Number(e.target.value) }))}
            className="rounded-md px-2 py-1 text-xs"
            style={{ border: '1px solid rgba(0,0,0,0.08)', color: 'var(--text-secondary)', background: 'transparent' }}
          >
            {[1, 2, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n === 1 ? 'All' : `${n}+`}</option>
            ))}
          </select>
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
                {selected.books.length} book{selected.books.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="px-5 py-3 space-y-0.5">
              {selected.books.slice(0, 50).map((book, i) => (
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
              {selected.books.length > 50 && (
                <p className="text-[11px] px-2.5 py-2" style={{ color: 'var(--text-muted)' }}>and {selected.books.length - 50} more</p>
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
