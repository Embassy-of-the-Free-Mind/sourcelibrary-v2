import { ImageResponse } from 'next/og';

export const alt = 'The Contemplative Traditions - Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

const traditions = [
  { name: 'Taoism', color: '#059669' },
  { name: 'Sufism', color: '#0891b2' },
  { name: 'Buddhism & Zen', color: '#d97706' },
  { name: 'Advaita Vedanta', color: '#ea580c' },
  { name: 'Depth Psychology', color: '#7c3aed' },
];

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

        {/* Label */}
        <div
          style={{
            fontSize: 14,
            color: '#fbbf24',
            textTransform: 'uppercase',
            letterSpacing: '0.3em',
            fontWeight: 600,
            marginBottom: 20,
            display: 'flex',
          }}
        >
          Curated Collection
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: '#fdfcf9',
            fontFamily: 'Georgia, serif',
            letterSpacing: '-0.02em',
            marginBottom: 12,
            textAlign: 'center',
            display: 'flex',
          }}
        >
          The Contemplative Traditions
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: 'rgba(253, 252, 249, 0.6)',
            fontFamily: 'Georgia, serif',
            textAlign: 'center',
            maxWidth: 750,
            lineHeight: 1.5,
            marginBottom: 40,
            display: 'flex',
          }}
        >
          40 primary sources in their original languages — from a 975 AD Chinese sutra to Rumi in Persian
        </div>

        {/* Tradition pills */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {traditions.map((t) => (
            <div
              key={t.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 20px',
                borderRadius: 999,
                border: `1.5px solid ${t.color}44`,
                background: `${t.color}18`,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: t.color,
                  display: 'flex',
                }}
              />
              <span
                style={{
                  fontSize: 16,
                  color: '#fdfcf9',
                  fontWeight: 500,
                  display: 'flex',
                }}
              >
                {t.name}
              </span>
            </div>
          ))}
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
