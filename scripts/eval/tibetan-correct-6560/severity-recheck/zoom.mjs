// PRIOR ART: profiles-diffqa/judge.mjs tiles() cuts four fixed quadrants for the judge; a by-eye check needs an
// arbitrary strip at full resolution. Usage: node zoom.mjs IMAGE OUT.jpg x0 y0 w h  (fractions of the frame)
import sharp from 'sharp';
const [img, out, ...f] = process.argv.slice(2);
const [x0, y0, w, h] = f.map(Number);
const { width: W, height: H } = await sharp(img).metadata();
await sharp(img).extract({ left: Math.round(x0 * W), top: Math.round(y0 * H), width: Math.round(Math.min(w, 1 - x0) * W), height: Math.round(Math.min(h, 1 - y0) * H) })
  .modulate({ brightness: 1.6 }).jpeg({ quality: 92 }).toFile(out);
