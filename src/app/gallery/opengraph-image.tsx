import { ImageResponse } from 'next/og';

export const alt = 'Image Gallery - Source Library';
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
          padding: '60px',
          position: 'relative',
        }}
      >
        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            right: 20,
            bottom: 20,
            border: '2px solid rgba(201, 168, 108, 0.3)',
            borderRadius: 16,
            display: 'flex',
          }}
        />

        {/* Grid of image placeholders */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 40,
          }}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                width: 100,
                height: 100,
                background: `rgba(201, 168, 108, ${0.08 + i * 0.04})`,
                borderRadius: 8,
                border: '1px solid rgba(201, 168, 108, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke={`rgba(201, 168, 108, ${0.3 + i * 0.1})`}
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          ))}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 400,
            color: '#fdfcf9',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            letterSpacing: '-0.02em',
            marginBottom: 16,
            display: 'flex',
          }}
        >
          Image Gallery
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: '#c9a86c',
            fontFamily: 'Georgia, serif',
            textAlign: 'center',
            maxWidth: 700,
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          Illustrations from rare Hermetic, alchemical & philosophical texts
        </div>

        {/* Source Library branding */}
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            right: 48,
            fontSize: 18,
            color: 'rgba(253, 252, 249, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Source Library</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
