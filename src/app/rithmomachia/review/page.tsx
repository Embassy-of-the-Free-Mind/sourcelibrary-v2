import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Piece Review — Rithmomachia',
  robots: { index: false },
};

const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/rithmomachia';

// V2 grids (white background)
const v2Grids = [
  { id: 0, url: `${BLOB}/v2/grid_0-kgpIo2uzPqWBxibptB2TbmhqkV8MPu.png`, note: 'Heavy ink, flat-face triangular prisms, thick cylinders, solid cubes' },
  { id: 1, url: `${BLOB}/v2/grid_1-USQXn1GY1v2gh0j6wUhU2j5xBFzESY.png`, note: 'Triangles are pointed pyramids (not ideal). Lighter ink.' },
  { id: 2, url: `${BLOB}/v2/grid_2-7EJSXE9e1FToebS3pVZgGwWo2hsq73.png`, note: 'Concentric top hatching on circles, flat-face prisms, clean cubes' },
  { id: 3, url: `${BLOB}/v2/grid_3-bNRzuQTdpkMjWjwu5xWw5z16Yx1Rbm.png`, note: 'Flatter/thinner pieces (more token-like). Different aesthetic.' },
];

// V2 individual piece generations (white bg)
const v2Singles = {
  circle: [0, 1, 2, 3].map(i => ({
    id: i,
    url: [
      `${BLOB}/v2/circle_0-nmjFG8GozoZ80CENEwPSD5Rzb50y9W.png`,
      `${BLOB}/v2/circle_1-lp77i4lHuopctjzXhvaOcQ5mWD4PPP.png`,
      `${BLOB}/v2/circle_2-wCKBSSkjcHJVnSLkyam4LJCowuYCeA.png`,
      `${BLOB}/v2/circle_3-W3bIzIL4umxSsFEPFTFWssrrpGWlg2.png`,
    ][i],
  })),
  triangle: [0, 1, 2, 3].map(i => ({
    id: i,
    url: [
      `${BLOB}/v2/triangle_0-1AbOZ0jfGnFDMJUHAAjGk9fn8Il9cH.png`,
      `${BLOB}/v2/triangle_1-FTgGtZ7GQsqgLTiSqgW3vq09WZRli6.png`,
      `${BLOB}/v2/triangle_2-MDOI0kZ0wCljhK9YDJpXtXr8cbKO9Q.png`,
      `${BLOB}/v2/triangle_3-iPUl3eCurOHUJSvoNP886CZfkAvnLT.png`,
    ][i],
  })),
  square: [0, 1, 2, 3].map(i => ({
    id: i,
    url: [
      `${BLOB}/v2/square_0-S1Cg3Ongk05SoT6UCGAS64TDW9HbuA.png`,
      `${BLOB}/v2/square_1-5Mtp9LieFRnHUar2rEf4N9J6C5rxb0.png`,
      `${BLOB}/v2/square_2-msLNXdnXVzM8jOUHqGuV2wiCV25guN.png`,
      `${BLOB}/v2/square_3-KjOiKj4G2ZI1tEJSw764vcY59YMvIU.png`,
    ][i],
  })),
};

// Extracted + processed pieces (transparent bg, 200x200)
const positions = ['left', 'center', 'right'] as const;
const shapes = ['circle', 'triangle', 'square'] as const;

const lightPieces: Record<string, Record<string, Record<string, string>>> = {
  g0: {
    circle: {
      left: `${BLOB}/v2/final/g0_circle_left-wLM1EQBJZ2qKuKX6qvBzYH4loquEXg.png`,
      center: `${BLOB}/v2/final/g0_circle_center-i63nlEmEqxsv6NPDsF9u4MqDaEANVT.png`,
      right: `${BLOB}/v2/final/g0_circle_right-kd9kgoe1WqJ2JzRbWd4IIyPlTHv9Jg.png`,
    },
    triangle: {
      left: `${BLOB}/v2/final/g0_triangle_left-6aWNqcQdah1QBsAnN8u8a3SqDofXbm.png`,
      center: `${BLOB}/v2/final/g0_triangle_center-1x2HZP1JlbC5Y19PHNkkMKjy2ZNE66.png`,
      right: `${BLOB}/v2/final/g0_triangle_right-RibEBk8qbYFjEDwJhlBMOFT8FGvlEY.png`,
    },
    square: {
      left: `${BLOB}/v2/final/g0_square_left-K6OjQtlt651VA9WiidOznrg7T9aOAM.png`,
      center: `${BLOB}/v2/final/g0_square_center-F1Q4fjnDCWCBL0RT8GFaDReKFz0NX7.png`,
      right: `${BLOB}/v2/final/g0_square_right-JIiR5VLoSXBs7OrbwghCYPzCaMG83Z.png`,
    },
  },
  g2: {
    circle: {
      left: `${BLOB}/v2/final/g2_circle_left-8uI1DBg5ijL5wHZdizQw4A0shmCzWp.png`,
      center: `${BLOB}/v2/final/g2_circle_center-RhmQ0TwH1cATiFcT08VBpzwIKks230.png`,
      right: `${BLOB}/v2/final/g2_circle_right-XqF8PSWcT1ojLiTtqLfFuFrxHQV5gx.png`,
    },
    triangle: {
      left: `${BLOB}/v2/final/g2_triangle_left-CM54QGeKs4P9Yf55RpnZOsxBx5ogou.png`,
      center: `${BLOB}/v2/final/g2_triangle_center-YJfVqCBqDXQwggg9S2WmM5bv0Tj2Es.png`,
      right: `${BLOB}/v2/final/g2_triangle_right-il3WdWAsyXApNhAOcBjnhde8nKBQDC.png`,
    },
    square: {
      left: `${BLOB}/v2/final/g2_square_left-7iTZVTmMWIl7z52YQ7Twgx6vXxOrbi.png`,
      center: `${BLOB}/v2/final/g2_square_center-GIlZrJSjcxw8FBjU8F2eOc3OqsKbTy.png`,
      right: `${BLOB}/v2/final/g2_square_right-1eRT1EQdjgDOxXxMnuaQaLnx5qytEQ.png`,
    },
  },
};

const darkPieces: Record<string, Record<string, Record<string, string>>> = {
  g0: {
    circle: {
      left: `${BLOB}/v2/final/dark_g0_circle_left-zCAyFZG6zj8YLTvP7fIq1O1cXmLFye.png`,
      center: `${BLOB}/v2/final/dark_g0_circle_center-DEWF2j6e6YDfqh2MQPNTvGjjFABPn1.png`,
      right: `${BLOB}/v2/final/dark_g0_circle_right-veeTevUcr4kGFODkdkjGnTDXQZRkch.png`,
    },
    triangle: {
      left: `${BLOB}/v2/final/dark_g0_triangle_left-jNyPy0txvAXt1Nttxc35cIbqweQ8ZC.png`,
      center: `${BLOB}/v2/final/dark_g0_triangle_center-Ag4CF4WnNdGbwo8DNdE9lqrL6Hv4qk.png`,
      right: `${BLOB}/v2/final/dark_g0_triangle_right-pF93EKf2NMiYv3RbkODjm8MxVCMtuQ.png`,
    },
    square: {
      left: `${BLOB}/v2/final/dark_g0_square_left-gV1CwxcIX54BGLLzvGyn7RK5BhX7VI.png`,
      center: `${BLOB}/v2/final/dark_g0_square_center-BncdMD2zxfI85MZiJQckH0VI2AL49T.png`,
      right: `${BLOB}/v2/final/dark_g0_square_right-pfgDFwY9BaeRZt3Gi9LEtyS09NIUbw.png`,
    },
  },
  g2: {
    circle: {
      left: `${BLOB}/v2/final/dark_g2_circle_left-ICXrdkeiiF6VSu04Ho5Uu5lEW5lEWG.png`,
      center: `${BLOB}/v2/final/dark_g2_circle_center-U8SZXLpxd5ZeKvmnvyTO1fWe0PQFc1.png`,
      right: `${BLOB}/v2/final/dark_g2_circle_right-OW47aSCmuCIbq8zPCcidUBaOrl8AA0.png`,
    },
    triangle: {
      left: `${BLOB}/v2/final/dark_g2_triangle_left-sCYK9wEE7HMOL201pEeW8gPnEWEzLQ.png`,
      center: `${BLOB}/v2/final/dark_g2_triangle_center-iYumbyn69Kce2KJGJs1NzHBufftn2i.png`,
      right: `${BLOB}/v2/final/dark_g2_triangle_right-cyec8MbR1pC7sMlyI7hQKbp18ZrA74.png`,
    },
    square: {
      left: `${BLOB}/v2/final/dark_g2_square_left-tEOuBEuPTm4Bp1DjSrCdh4NO0mYSyr.png`,
      center: `${BLOB}/v2/final/dark_g2_square_center-lDRoNn9H574F7aw1BdR56gC0oI1SSt.png`,
      right: `${BLOB}/v2/final/dark_g2_square_right-F6ARBAzlOspaXnMcGGo7ppk6Zx7v93.png`,
    },
  },
};

const sectionStyle = { marginBottom: '3rem' };
const h2Style = { fontFamily: 'var(--font-serif)', fontSize: '1.5rem', marginBottom: '1rem', borderBottom: '1px solid #e8e4dc', paddingBottom: '0.5rem' };
const cardStyle = { border: '1px solid #e8e4dc', borderRadius: 8, overflow: 'hidden' as const, background: '#fff' };
const labelStyle = { padding: '0.5rem 1rem', background: '#f5f0e8', fontWeight: 600, fontSize: '0.875rem' };

export default function PieceReviewPage() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem', fontFamily: 'var(--font-sans)', color: '#1a1612', background: '#fdfcf9' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2rem', marginBottom: '0.5rem' }}>
        Rithmomachia Piece Review (v2 — White BG)
      </h1>
      <p style={{ color: '#6b6560', marginBottom: '2rem' }}>
        All generated by Wan2.6-t2i with copperplate engraving prompt on white background.
        Pick your preferred grid, individual pieces, and light/dark variants.
      </p>

      {/* Section 1: V2 Source Grids */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>1. Source Grids — pick a style</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          {v2Grids.map(g => (
            <div key={g.id} style={cardStyle}>
              <div style={labelStyle}>
                Grid {g.id}
              </div>
              <p style={{ padding: '0 1rem', fontSize: '0.8rem', color: '#6b6560', margin: '0.25rem 0' }}>{g.note}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.url} alt={`Grid ${g.id}`} style={{ width: '100%', display: 'block' }} />
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Individual Generations (white bg, 768x768) */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>2. Individual Piece Generations (4 variants each)</h2>
        <p style={{ color: '#6b6560', marginBottom: '1rem', fontSize: '0.875rem' }}>
          These are standalone piece generations. Note: triangles came out as pointed pyramids — the grid extractions (Section 3) have better flat-face prisms.
        </p>
        {shapes.map(shape => (
          <div key={shape} style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', marginBottom: '0.75rem', textTransform: 'capitalize' }}>
              {shape}s
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
              {v2Singles[shape].map(({ id, url }) => (
                <div key={id} style={cardStyle}>
                  <div style={labelStyle}>Variant {id}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${shape} ${id}`} style={{ width: '100%', display: 'block' }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Section 3: Extracted + Processed (transparent) — per grid */}
      {(['g0', 'g2'] as const).map(grid => (
        <section key={grid} style={sectionStyle}>
          <h2 style={h2Style}>
            3{grid === 'g0' ? 'a' : 'b'}. Extracted from {grid.toUpperCase()} — transparent, 200px (light side)
          </h2>
          {shapes.map(shape => (
            <div key={shape} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', marginBottom: '0.75rem', textTransform: 'capitalize' }}>
                {shape}s
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                {positions.map(pos => (
                  <div key={pos} style={{ ...cardStyle, background: '#f0ebe0' }}>
                    <div style={labelStyle}>{pos}</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={lightPieces[grid][shape][pos]}
                      alt={`${grid} ${shape} ${pos}`}
                      style={{ width: '100%', display: 'block', imageRendering: 'auto' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* Section 4: Dark variants (on dark bg) */}
      {(['g0', 'g2'] as const).map(grid => (
        <section key={grid} style={sectionStyle}>
          <h2 style={h2Style}>
            4{grid === 'g0' ? 'a' : 'b'}. Dark Variants from {grid.toUpperCase()} (odd/black side)
          </h2>
          {shapes.map(shape => (
            <div key={shape} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', marginBottom: '0.75rem', textTransform: 'capitalize' }}>
                {shape}s
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                {positions.map(pos => (
                  <div key={pos} style={{ ...cardStyle, background: '#2a1e12' }}>
                    <div style={{ ...labelStyle, background: '#3a2e22', color: '#e8dfd0' }}>{pos}</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={darkPieces[grid][shape][pos]}
                      alt={`${grid} ${shape} ${pos} dark`}
                      style={{ width: '100%', display: 'block', imageRendering: 'auto' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* Section 5: Game-size preview with number overlay */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>5. Game-Size Preview (80px with number overlay)</h2>
        <p style={{ color: '#6b6560', marginBottom: '1rem', fontSize: '0.875rem' }}>
          How pieces will look on the board. Using g0 center variants.
        </p>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', padding: '2rem', background: '#e8e0d0', borderRadius: 8 }}>
          {shapes.map(shape => (
            <div key={shape} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ position: 'relative', width: 80, height: 80 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={lightPieces.g0[shape].center} alt="" style={{ width: 80, height: 80 }} />
                  <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 18, color: '#1a1612', textShadow: '0 0 4px rgba(240,235,224,0.9)' }}>
                    {shape === 'circle' ? '6' : shape === 'triangle' ? '42' : '153'}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#6b6560', marginTop: 4 }}>even</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ position: 'relative', width: 80, height: 80, background: '#2a1e12', borderRadius: 4 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={darkPieces.g0[shape].center} alt="" style={{ width: 80, height: 80 }} />
                  <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 18, color: '#e8dfd0', textShadow: '0 0 4px rgba(26,22,18,0.9)' }}>
                    {shape === 'circle' ? '5' : shape === 'triangle' ? '56' : '120'}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#6b6560', marginTop: 4 }}>odd</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 6: Still Needed */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={h2Style}>6. Still Needed</h2>
        <ul style={{ paddingLeft: '1.5rem', color: '#444' }}>
          <li>Pyramid piece (stacked layers — compose from circle+triangle+square or generate new)</li>
          <li>Pick which grid source (g0 vs g2) and which column position (left/center/right) per shape</li>
          <li>Number placement/styling — serif italic? plain? engraved look?</li>
          <li>Mix-and-match OK — e.g. circle from g0, triangle from g2</li>
        </ul>
      </section>
    </div>
  );
}
