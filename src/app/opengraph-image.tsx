import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Source Library - Rare Texts Digitized';
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
          background: 'linear-gradient(135deg, #1a1612 0%, #2d2520 50%, #1a1612 100%)',
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
            border: '2px solid rgba(201, 168, 108, 0.3)',
            borderRadius: 16,
          }}
        />

        {/* Inner decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 32,
            right: 32,
            bottom: 32,
            border: '1px solid rgba(201, 168, 108, 0.15)',
            borderRadius: 12,
          }}
        />

        {/* Book icon */}
        <div
          style={{
            display: 'flex',
            marginBottom: 24,
          }}
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c9a86c"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M8 7h8" />
            <path d="M8 11h6" />
          </svg>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 400,
            color: '#fdfcf9',
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
            color: '#c9a86c',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            display: 'flex',
          }}
        >
          Rare Texts Digitized & Translated
        </div>

        {/* Decorative line */}
        <div
          style={{
            width: 120,
            height: 2,
            background: 'linear-gradient(90deg, transparent, #c9a86c, transparent)',
            marginTop: 32,
          }}
        />

        {/* Bottom tagline */}
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            fontSize: 18,
            color: 'rgba(253, 252, 249, 0.5)',
            display: 'flex',
          }}
        >
          Hermetic & Renaissance Manuscripts
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
