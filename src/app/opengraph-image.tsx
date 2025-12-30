import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Source Library';
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
          background: '#ffffff',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Concentric circles logo */}
        <svg
          width="300"
          height="300"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" fill="none" stroke="#000000" strokeWidth="0.8" />
          <circle cx="12" cy="12" r="7" fill="none" stroke="#000000" strokeWidth="0.8" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="#000000" strokeWidth="0.8" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
