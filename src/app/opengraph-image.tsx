import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Source Library - Rare Historical Texts Digitized & Translated';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1c1917 0%, #292524 50%, #1c1917 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Georgia, serif',
          position: 'relative',
        }}
      >
        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            right: 24,
            bottom: 24,
            border: '2px solid rgba(217, 179, 99, 0.3)',
            borderRadius: 12,
            display: 'flex',
          }}
        />

        {/* Concentric circles logo */}
        <div style={{ display: 'flex', marginBottom: 24 }}>
          <svg width="100" height="100" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="#d9b363" strokeWidth="0.6" />
            <circle cx="12" cy="12" r="7" fill="none" stroke="#d9b363" strokeWidth="0.6" />
            <circle cx="12" cy="12" r="4" fill="none" stroke="#d9b363" strokeWidth="0.6" />
            <circle cx="12" cy="12" r="1.5" fill="#d9b363" />
          </svg>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 400,
            color: '#fafaf9',
            letterSpacing: '-0.02em',
            marginBottom: 16,
            display: 'flex',
          }}
        >
          Source Library
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: '#d9b363',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            display: 'flex',
            marginBottom: 40,
          }}
        >
          Rare Historical Texts Digitized & Translated
        </div>

        {/* Features */}
        <div
          style={{
            display: 'flex',
            gap: 48,
            fontSize: 20,
            color: '#a8a29e',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#d9b363' }}>✦</span> Alchemy & Hermeticism
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#d9b363' }}>✦</span> DOI Citations
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#d9b363' }}>✦</span> MCP Server
          </div>
        </div>

        {/* URL */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            fontSize: 18,
            color: 'rgba(168, 162, 158, 0.6)',
            display: 'flex',
          }}
        >
          sourcelibrary.org
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
