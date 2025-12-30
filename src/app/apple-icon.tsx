import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
          borderRadius: 40,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="120"
          height="120"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="#a8a29e"
            strokeWidth="1"
          />
          <circle
            cx="12"
            cy="12"
            r="7"
            fill="none"
            stroke="#d6d3d1"
            strokeWidth="1"
          />
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="none"
            stroke="#fafaf9"
            strokeWidth="1"
          />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
