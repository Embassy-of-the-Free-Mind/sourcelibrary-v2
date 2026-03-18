/**
 * Shared Open Graph image generator components.
 *
 * Used by opengraph-image.tsx files across the site to create
 * consistent, branded social sharing cards.
 */

import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

// Brand colors
const COLORS = {
  bg: '#1a1612',
  bgGradient: 'linear-gradient(135deg, #1a1612 0%, #2d2520 50%, #1a1612 100%)',
  gold: '#c9a86c',
  goldFaint: 'rgba(201, 168, 108, 0.3)',
  text: '#fdfcf9',
  textMuted: 'rgba(253, 252, 249, 0.6)',
  textFainter: 'rgba(253, 252, 249, 0.5)',
};

/** Decorative border used on all OG cards */
function Border() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 20,
        right: 20,
        bottom: 20,
        border: `2px solid ${COLORS.goldFaint}`,
        borderRadius: 16,
        display: 'flex',
      }}
    />
  );
}

/** Source Library branding in bottom-right */
function Branding() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 36,
        right: 48,
        fontSize: 18,
        color: COLORS.textFainter,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
        <circle cx="12" cy="12" r="7" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
        <circle cx="12" cy="12" r="4" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
      </svg>
      <span>Source Library</span>
    </div>
  );
}

/**
 * Generate a branded text-based OG image card.
 * For pages without a specific visual (collections, categories, authors, topics, etc.)
 */
export function generateBrandedOGImage({
  title,
  subtitle,
  detail,
}: {
  title: string;
  subtitle?: string;
  detail?: string;
}) {
  const displayTitle = title.length > 70 ? title.substring(0, 67) + '...' : title;
  const fontSize = title.length > 40 ? 42 : 52;

  return new ImageResponse(
    (
      <div
        style={{
          background: COLORS.bgGradient,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 80px',
          position: 'relative',
          fontFamily: 'Georgia, serif',
        }}
      >
        <Border />

        {/* Title */}
        <div
          style={{
            fontSize,
            fontWeight: 400,
            color: COLORS.text,
            fontStyle: 'italic',
            letterSpacing: '-0.02em',
            textAlign: 'center',
            lineHeight: 1.2,
            marginBottom: subtitle ? 20 : 0,
            display: 'flex',
            maxWidth: 900,
          }}
        >
          {displayTitle}
        </div>

        {/* Decorative line */}
        {subtitle && (
          <div
            style={{
              width: 80,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${COLORS.gold}, transparent)`,
              marginBottom: 20,
              display: 'flex',
            }}
          />
        )}

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              fontSize: 24,
              color: COLORS.gold,
              textAlign: 'center',
              maxWidth: 700,
              lineHeight: 1.4,
              display: 'flex',
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Detail line */}
        {detail && (
          <div
            style={{
              fontSize: 18,
              color: COLORS.textMuted,
              textAlign: 'center',
              maxWidth: 600,
              marginTop: 16,
              display: 'flex',
            }}
          >
            {detail}
          </div>
        )}

        <Branding />
      </div>
    ),
    { ...OG_SIZE }
  );
}
