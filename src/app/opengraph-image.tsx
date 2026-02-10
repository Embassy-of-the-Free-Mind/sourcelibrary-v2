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
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Hero poster background (2x resolution for sharpness) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://sourcelibrary.org/og-poster.jpg"
          alt=""
          width={2400}
          height={1260}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        {/* Dark overlay — heavier on the left for text legibility */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.45) 100%)',
            display: 'flex',
          }}
        />

        {/* Content */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '72px 80px',
          }}
        >
          {/* Logo + Wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '36px' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <div style={{ display: 'flex', gap: '10px', letterSpacing: '4px' }}>
              <span style={{ fontSize: '28px', color: 'white', fontWeight: 700 }}>
                SOURCE
              </span>
              <span style={{ fontSize: '28px', color: 'white', fontWeight: 300 }}>
                LIBRARY
              </span>
            </div>
          </div>

          {/* Headline — larger, bolder */}
          <div
            style={{
              fontSize: '64px',
              color: 'white',
              fontFamily: 'Georgia, serif',
              fontWeight: 700,
              lineHeight: 1.1,
              maxWidth: '850px',
              marginBottom: '28px',
            }}
          >
            Unlock a New Renaissance of Ancient Knowledge
          </div>

          {/* Tagline — larger for readability */}
          <div
            style={{
              fontSize: '26px',
              color: 'rgba(255, 255, 255, 0.9)',
              fontFamily: 'Georgia, serif',
              maxWidth: '650px',
              lineHeight: 1.4,
            }}
          >
            Rare Hermetic and esoteric texts, digitized and translated for scholars, seekers, and AI.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
