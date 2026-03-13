# Rithmomachia: AI-Generated Piece Images Experiment

**Date:** March 2, 2026
**Outcome:** Reverted to SVG pieces. AI images don't work well at game-piece size.

## What We Tried

Used MuleRouter's Wan2.6-t2i (text-to-image) to generate copperplate engraving-style 3D game pieces for Rithmomachia — cylinders (circles), triangular prisms, and rectangular blocks. The goal was photorealistic 16th-17th century copperplate engravings rendered as transparent PNGs overlaid on the SVG game board.

## Three Generations

### V1: 3x3 grid prompt
Single image with all 9 piece types in a grid. Results were too small and inconsistent to extract individual pieces.

### V2: Individual piece prompts (white + dark backgrounds)
- Generated each shape individually at 768x768
- Light pieces on white background, extracted to transparent PNG with ImageMagick (`-fuzz 15% -transparent white`)
- Dark pieces initially color-remapped from light, then regenerated separately
- **Problem:** Cast shadows baked into the generated images became ugly gray artifacts after background removal, especially visible on the checkered game board

### V3: Shadow-free prompts
- Regenerated all 6 pieces with explicit "NO shadow, NO cast shadow, NO ground plane, NO drop shadow" in prompts
- Much cleaner results, but:
  - Light triangle still had persistent shadow remnant (medium gray indistinguishable from crosshatching)
  - At 72px game-piece size, the fine engraving detail was lost — pieces looked like blurry thumbnails
  - The copperplate aesthetic that looked beautiful at 768px didn't survive downscaling

## Generated Images (Vercel Blob)

All uploaded images remain in Vercel Blob at:
```
https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/rithmomachia/pieces/
```

### V2 images
- `v2_circle_light-NmahAFrVoEcsNlNgZk9X4SbB18bk24.png`
- `v2_triangle_light-Muy1L6dGAf4Va3vH3HuI10RWin4eCj.png`
- `v2_square_light-YXs13ZhXKrmKSMSKCt8c5ks9c1Ix3X.png`
- `v2_circle_dark_gen.png`
- `v2_triangle_dark_gen.png`
- `v2_square_dark_gen.png`

### V3 images (shadow-free)
- `v3_circle_light.png` / `v3_circle_dark.png`
- `v3_triangle_light.png` / `v3_triangle_dark.png`
- `v3_square_light.png` / `v3_square_dark.png`

### MuleRouter Task IDs (for reference)
- V3 light circle: `310fd2e5-528f-4511-bf80-c2a02dba3d4b`
- V3 light triangle: `1c1e2fff-eb8e-4941-802e-2b4583b28792`
- V3 light square: `1c95c68e-5e2a-4e2b-80c4-fb20ebe55383`
- V3 dark circle: `fae749b0-02c6-4c98-913f-716a6e0a1520`
- V3 dark triangle: `61f0c1ad-92f8-4604-99fe-5569281dda52`
- V3 dark square: `be0514cb-137f-4cb8-b00d-8a18b5256be6`

## Why It Didn't Work

1. **Shadow removal is lossy.** AI models produce natural-looking cast shadows that can't be cleanly separated from the piece's own shading via simple color-based approaches (fuzz/chroma key). The shadow gradients overlap with the crosshatching tones.

2. **Detail loss at small sizes.** The copperplate engraving aesthetic — fine parallel lines, crosshatching, contour shading — requires at least 200-300px to read. At 72px game-piece size, it becomes muddy noise.

3. **Inconsistent angles.** Each generation produces pieces from slightly different viewing angles, making the set look incoherent on a unified game board.

4. **The SVG approach is better.** Clean geometric shapes with subtle hatching patterns scale perfectly, render crisply at any size, and are fully controllable. The copperplate "feeling" comes through in the SVG hatching patterns, serif italic numbers, and the warm paper color palette.

## What Was Restored

Reverted to the SVG copperplate version from commit `457a88c0`:
- Geometric shapes (circle, triangle, square, nested-shapes pyramid)
- SVG `<pattern>` hatching overlays (subtle stipple for light, fine crosshatch for dark)
- Inner detail lines (engraving-style decorative borders)
- Serif italic value labels (Cormorant Garamond)
- High-contrast ink-on-paper palette (#f0ebe0 light, #1a1612 dark)

## Lessons

- AI image generation works great for standalone illustrations (blog headers, gallery images) but poorly for small UI elements that need to tile/repeat at consistent scales and angles.
- For game pieces, programmatic rendering (SVG/Canvas) gives far better control over consistency, scaling, and theming.
- The "copperplate engraving" aesthetic is better achieved through SVG patterns than through actual engraving-style images.

## Local Files (ephemeral)

Raw generated images cached at `/tmp/rithmo-pieces/v1/`, `v2/`, `v3/` — 24 variants per version, 768x768 PNGs. Will be cleared on reboot.
