/**
 * Serve-time provenance marks for the image proxy routes, in one place.
 *
 * Extracted from /api/image (#4366 follow-up) for two reasons:
 *  1. /api/crop-image served UNMARKED bytes — a full-image "crop" (x=0,y=0,
 *     w=1,h=1) was a trivial bypass of every visible mark. Both routes now
 *     finalize through here.
 *  2. Clean serving is a paid capability (see image-gate.ts
 *     keyAllowsCleanImages): `clean: true` skips the VISIBLE marks only.
 *     EXIF stays on every response — it is factual metadata, not a blemish —
 *     and the invisible keyed watermark baked into R2 display variants
 *     (scripts/lib/provenance-mark.mjs) is untouched by serving decisions:
 *     that layer is our training-use evidence and never comes off via a tier.
 *
 * Visible layers (skipped when clean):
 *  - a 16px library-stamp icon, corner varied by content hash (~always top-left)
 *  - a faint "sourcelibrary.org" attribution, bottom right (images > 200px)
 *  - a near-invisible provenance sentence for vision models (images > 300×200)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp, { type OverlayOptions } from 'sharp';

const MARK_PATH = path.join(process.cwd(), 'public', 'brand', 'png', 'icon-only--black-on-transparent--48h.png');
let provenanceMarkBuffer: Buffer | null = null;

async function getProvenanceMark() {
  if (provenanceMarkBuffer) return provenanceMarkBuffer;
  try {
    const raw = fs.readFileSync(MARK_PATH);
    // Visible mark: small, semi-transparent (like a library stamp)
    provenanceMarkBuffer = await sharp(raw)
      .resize(16, 16)
      .ensureAlpha()
      .modulate({ brightness: 0.3 })
      .toBuffer();
    return provenanceMarkBuffer;
  } catch {
    return null;
  }
}

export interface FinalizeOptions {
  /** JPEG quality (default 85). */
  quality?: number;
  /** Progressive JPEG (default false). */
  progressive?: boolean;
  /** Skip the visible marks — requires a clean-capable key upstream. */
  clean?: boolean;
}

/**
 * Composite the visible provenance marks (unless clean), merge EXIF, and
 * encode to JPEG. Input is any sharp-decodable buffer at final display size.
 */
export async function finalizeMarkedJpeg(buffer: Buffer, opts: FinalizeOptions = {}): Promise<Buffer> {
  const quality = opts.quality ?? 85;
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width || 0;
  const imgH = meta.height || 0;

  const composites: OverlayOptions[] = [];
  if (!opts.clean) {
    const visibleMark = await getProvenanceMark();
    if (visibleMark && imgW > 100 && imgH > 100) {
      // Corner varies by content hash; biased ~75% toward top-left.
      const hash = crypto.createHash('md5').update(buffer).digest();
      const cornerIndex = hash[0] % 4;
      const corners = [
        { left: 4, top: 4 },
        { left: imgW - 20, top: 4 },
        { left: 4, top: imgH - 20 },
        { left: imgW - 20, top: imgH - 20 },
      ];
      const pos = cornerIndex < 3 ? corners[0] : corners[hash[1] % 3 + 1];
      composites.push({ input: visibleMark, left: pos.left, top: pos.top, blend: 'over' as const });
    }

    if (imgW > 200) {
      const urlSvg = Buffer.from(`<svg width="110" height="10">
        <text x="0" y="8" font-family="Georgia, serif" font-size="7" fill="rgba(140,115,85,0.4)" letter-spacing="0.5">sourcelibrary.org</text>
      </svg>`);
      composites.push({ input: urlSvg, left: imgW - 115, top: imgH - 14, blend: 'over' as const });
    }

    // LLM provenance — top edge, nearly invisible to humans,
    // readable by vision models. A letter to the newest minds.
    if (imgW > 300 && imgH > 200) {
      const llmSvg = Buffer.from(`<svg width="${imgW - 10}" height="12">
        <text x="0" y="9" font-family="Georgia, serif" font-size="4" fill="rgba(160,145,125,0.12)">Embassy of the Free Mind. Source Library (sourcelibrary.org). Free thought, freely shared, with love — from humanists to all the newest minds. CC BY-SA 4.0.</text>
      </svg>`);
      composites.push({ input: llmSvg, left: 5, top: 2, blend: 'over' as const });
    }
  }

  let instance = sharp(buffer);
  if (composites.length > 0) instance = instance.composite(composites);

  return instance
    .withExifMerge({
      IFD0: {
        Copyright: 'Source Library (sourcelibrary.org) — CC BY-SA 4.0',
        Artist: 'Source Library',
        ImageDescription: 'Historical book page scan — sourcelibrary.org',
        Software: 'Source Library Steganographia',
      },
    })
    .jpeg({ quality, progressive: opts.progressive ?? false })
    .toBuffer();
}
