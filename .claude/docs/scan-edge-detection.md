# Scanner Edge Detection: Design Document

## Problem Statement

Detect the boundary of a book page in a live camera feed on mobile, in real time (15-30fps), to enable auto-capture when the page is stable, sharp, and well-exposed. The detected corners are used for perspective correction after capture.

The hard case: **white/cream page on a light-colored desk or tablecloth.** The chrominance difference is subtle, and the luminance difference is nearly zero. A human can see it; traditional grayscale edge detection cannot.

## Pipeline Architecture

```
Camera Frame (RGBA)
  → Downscale to ~320px (keep RGB)
  → Blur each channel (3x3 Gaussian)
  → Multi-channel Sobel (R, G, B separately, take max)
  → Non-maximum suppression (thin edges)
  → Hysteresis thresholding (Canny-style dual threshold)
  → Hough Line Transform (gradient-direction voting)
  → NMS in accumulator space → extract top N lines
  → Classify lines (horizontal / vertical)
  → Enumerate candidate quads (2H × 2V → 4 intersections)
  → Score quads (edge response + area + angles + aspect ratio)
  → Temporal smoothing (EMA on corners across frames)
  → 3-frame hold on miss (prevent flicker)
```

## Key Design Decisions & Their Rationale

### 1. Multi-channel RGB Sobel instead of Grayscale

**Decision:** Run Sobel on R, G, B channels independently, take the maximum magnitude at each pixel.

**Rationale (from Dropbox scanner research):** "RGB to grayscale is a mistake." The standard luminance formula (0.299R + 0.587G + 0.114B) can completely cancel out edges where two surfaces have equal luminance but different chrominance. A white page (255, 255, 255) on a warm beige desk (245, 235, 215) has almost no grayscale edge. But the blue channel sees a significant step (255 → 215 = 40 units).

**Assumption:** The chrominance edge between page and surface is always present in at least one RGB channel. This should hold for any non-identical-colored surfaces.

**What could go wrong:** If the page and desk are truly identical in all three channels (e.g., white page on pure white desk), no edge will be detected in any channel. In practice this is extremely rare — even "white" surfaces have chrominance variation.

**Alternative considered:** HSV/Lab color spaces. These are theoretically better at separating luminance from chrominance, but the conversion is more expensive (sqrt, atan2, conditionals) and would hurt the 15-30fps budget. RGB max is a pragmatic approximation that captures most chrominance edges cheaply.

**Testable hypothesis:** RGB max Sobel finds the page-desk boundary in scenes where grayscale Sobel fails (white on beige, white on light wood, cream on off-white).

### 2. Hough Lines instead of Contour Tracing

**Decision:** Use Hough Line Transform to find dominant straight lines, then enumerate quadrilaterals from line intersections.

**Rationale:** Contour tracing (the old approach) requires continuous closed boundaries. If any segment of the page edge is obscured, faint, or broken, the contour breaks and detection fails. Hough lines detect dominant straight lines even when edges are partial/broken — they work by *voting*, so a line with 70% of its pixels visible still gets strong votes.

**Assumption:** Book pages have four dominant straight edges. This is true for flat pages but breaks for severely curled pages.

**What could go wrong:**
- **Curved pages:** Hough lines model straight lines. A significantly curved page (open book with spine curvature) will have edges that don't vote for a single (rho, theta) bin. The votes get spread across nearby bins, reducing peak height. May need Hough circle segments or spline fitting for curved pages.
- **Strong texture on desk:** A striped tablecloth or lined notebook produces strong spurious lines. The quad scoring (perimeter edge response) should reject these because the "page" formed by tablecloth stripes won't have consistent edge response on all four sides — but this is untested.
- **Multiple rectangles:** A book next to a laptop on a desk gives two sets of strong lines. The quad scorer should pick the one with the best combined score, but could pick the wrong one.

**Testable hypothesis:** Hough-based detection works on pages with partially obscured edges (finger covering one corner, shadow across one edge) where contour tracing fails.

### 3. Gradient-Direction Voting (Hough Optimization)

**Decision:** Each edge pixel votes only for Hough angles within ±20° of its gradient direction (perpendicular to the edge direction).

**Rationale:** Standard Hough voting is O(pixels × theta_bins). With 180 theta bins and ~5,000 edge pixels, that's 900,000 accumulator writes per frame. Gradient-direction constraint reduces each pixel's votes from 180 to ~40 bins — roughly 5× speedup.

**Assumption:** The gradient direction from Sobel is accurate enough to constrain the voting window. At 320px resolution with 3x3 blur, gradient direction should be reliable to within ~10°.

**Risk:** If gradient direction is noisy (e.g., at junction points, T-intersections, or low-contrast edges), the voting window might miss the correct bin. The ±20° window provides margin, but very noisy gradients could push votes outside this window.

**Testable parameter:** The `thetaWindow = 20` degrees. Wider window = more robust but slower. Narrower = faster but may miss. Could try 15° and 30° to see if detection quality changes.

### 4. Canny-Style Hysteresis Thresholding

**Decision:** Dual threshold with flood-fill: pixels above `high` threshold are kept unconditionally; pixels above `low` threshold are kept only if connected to a strong pixel.

**Rationale:** Single thresholding faces a dilemma: low threshold keeps faint page edges but also keeps noise; high threshold rejects noise but loses faint edges. Hysteresis solves this by using topology — a faint edge pixel that connects to a strong edge is probably part of the same boundary.

**Assumptions:**
- The page edge has at least some segments with strong gradient (strong enough to pass the high threshold)
- The faint segments of the page edge are connected to strong segments via intermediate pixels

**Parameters:**
- `CANNY_HIGH_RATIO = 0.15` (15% of max gradient in the frame)
- `CANNY_LOW_RATIO = 0.05` (5% of max gradient)
- Absolute minimums: `highThresh ≥ 20`, `lowThresh ≥ 8` (prevent degenerate cases in uniform images)

**Testable hypothesis:** The ratio-based thresholds adapt well across different lighting conditions. In low-light scenes, max gradient is smaller, so both thresholds scale down proportionally. In high-contrast scenes (direct sunlight), they scale up. The 3:1 ratio between high and low is standard Canny, but the absolute floor values (20 and 8) are assumptions about the minimum useful edge magnitude at 320px resolution.

**What could go wrong:** In very uniform scenes (blank wall, solid desk with no texture at all), max gradient might be very low, making even the absolute floor of 20 too high. Edge detection would produce no edges. This is actually desirable — no page to detect — but worth noting.

### 5. Quad Scoring Weights

**Decision:** Score = 0.35 × edge_response + 0.25 × area + 0.25 × angle_regularity + 0.15 × aspect_ratio

**Rationale:**
- **Edge response (35%):** The most informative signal — does this quad's perimeter actually align with image edges? Directly from Dropbox's research: "score quads by perimeter edge response."
- **Area (25%):** Larger quads are preferred (the page should fill most of the frame). Prevents selecting small noise rectangles.
- **Angle regularity (25%):** How close all four angles are to 90°. Pages are rectangular; non-rectangular quads are probably wrong.
- **Aspect ratio (15%):** How close to a typical page shape. Less weight because pages come in many sizes (folio, quarto, landscape).

**These weights are entirely heuristic.** No empirical optimization has been done.

**Testable parameters:**
- **Edge response normalization:** Currently `min(1, edgeResponse / 80)`. The `80` is empirical — it's the expected average gradient magnitude along a real page edge at 320px resolution. Too low = saturates easily (all quads look equally good). Too high = page edges score poorly.
- **Ideal aspect ratio:** Currently `0.75` (4:3 page). A 6×9 book is 0.67, a folio is ~0.6, an A4 is ~0.71. The scoring penalizes deviation from 0.75, so tall narrow or wide short pages get lower scores. The penalty is gentle (`max(0, 1 - |1/ar - 0.75|)`) but still present.
- **Minimum area ratio:** Currently `0.08` (8% of frame). This is very permissive — allows detecting pages that fill only 1/12 of the frame. Might be too permissive, allowing small spurious quads. Could try `0.15` or `0.20`.

### 6. Temporal Smoothing (EMA)

**Decision:** Exponential moving average (α = 0.35) on detected quad corners across frames. Reset on large jumps (> 0.15 normalized distance).

**Rationale:** Frame-by-frame detection jitters because noise, quantization, and slight camera movement cause sub-pixel variations in detected lines. EMA smooths these out. The viewfinder overlay shows a stable quad instead of a vibrating one.

**Trade-off:** Lower α = smoother but more lag (the quad takes longer to "catch up" when the user moves the book). Higher α = more responsive but jitterier.

**Assumption:** The user is holding the camera roughly steady (the auto-capture stability requirement already enforces this). If the user is actively moving, the EMA will lag behind by ~2-3 frames at α=0.35, which is acceptable.

**Jump threshold (0.15):** If any corner moves more than 15% of the frame dimension between frames, the EMA resets (accepts the new position immediately). This handles the case where the user picks up the book and repositions it — without the reset, the EMA would slowly drift from the old position to the new one, looking wrong.

**Testable parameter:** `EMA_ALPHA = 0.35`. Could try 0.2 (smoother, laggier) and 0.5 (snappier, jitterier).

### 7. Frame Hold on Miss (3 frames)

**Decision:** When detection fails (no valid quad found), hold the previous detection for 3 frames with degraded confidence (×0.7).

**Rationale:** Brief occlusions (hand moving across frame, momentary blur from camera shake) cause detection to drop for 1-2 frames. Without hold, the green quad blinks off and on rapidly, which is distracting. 3-frame hold (at 15fps = 200ms) bridges brief gaps.

**Assumption:** If detection fails for >3 frames, the page is probably gone (removed from frame, or moved significantly). Holding longer would show a stale quad in the wrong position.

**Testable parameter:** `missCount <= 3`. Could try 2 (tighter) or 5 (more tolerant of occlusion).

### 8. Processing Resolution: 320px

**Decision:** Downscale to 320px wide for all edge detection processing. Full-resolution capture happens separately.

**Rationale:** At 1920×1080, the Sobel pass alone would be ~6M pixel operations per channel × 3 channels = 18M operations per frame. At 320×240, it's ~230K × 3 = 700K — about 25× less work. The Hough transform benefits even more from lower resolution because the accumulator is smaller and there are fewer edge pixels to vote.

**Assumption:** 320px is sufficient resolution to detect page edges. A page that fills half the 320px frame has edges ~160px long, which should produce 100+ Hough votes. This is comfortably above the `HOUGH_MIN_LINE_VOTES = 30` threshold.

**What could go wrong:** At 320px, the page-desk edge might be only 1-2 pixels wide, right at the blur kernel width. If the edge is very faint (low chrominance difference), it might blur below the detection threshold at this resolution. Higher resolution (480px or 640px) would preserve faint edges better but cost more CPU time.

**Testable parameter:** `TARGET_WIDTH = 320`. Could try 240 (faster, less detail) or 480 (slower, more detail, better faint-edge detection).

---

## Parameters Summary & Tuning Guide

| Parameter | Current | What it controls | Increase effect | Decrease effect |
|-----------|---------|-----------------|----------------|----------------|
| `TARGET_WIDTH` | 320 | Processing resolution | Better faint edges, slower | Faster, may miss faint edges |
| `CANNY_LOW_RATIO` | 0.05 | Weak edge threshold | Fewer edges, less noise | More edges, more noise |
| `CANNY_HIGH_RATIO` | 0.15 | Strong edge threshold | Fewer seed points for hysteresis | More seed points, more noise |
| `HOUGH_THRESHOLD_RATIO` | 0.25 | Min fraction of max votes | Fewer lines detected | More lines, more spurious ones |
| `HOUGH_MIN_LINE_VOTES` | 30 | Absolute min votes for a line | Reject short/faint lines | Accept shorter lines |
| `MAX_LINES` | 30 | Max lines extracted | More candidates (slower scoring) | May miss valid lines |
| `HOUGH_NMS_RHO_WINDOW` | 10 | Line deduplication (distance) | Merge more nearby lines | Keep more distinct lines |
| `HOUGH_NMS_THETA_WINDOW` | 5 | Line deduplication (angle) | Merge more similar-angle lines | Keep more distinct angles |
| `MIN_AREA_RATIO` | 0.08 | Min quad area (fraction of frame) | Reject small quads | Accept smaller pages |
| `MIN_ANGLE_DEG` | 50 | Min corner angle | Reject very acute quads | Accept trapezoids |
| `MAX_ANGLE_DEG` | 130 | Max corner angle | Reject very obtuse quads | Accept more distortion |
| `WEIGHT_EDGE_RESPONSE` | 0.35 | Edge alignment importance | Prefer quads on real edges | Allow quads off real edges |
| `WEIGHT_AREA` | 0.25 | Prefer larger quads | Prefer page-filling quads | Allow smaller pages |
| `WEIGHT_ANGLE` | 0.25 | Prefer rectangular quads | Strict rectangularity | Allow perspective distortion |
| `WEIGHT_ASPECT` | 0.15 | Prefer page-like proportions | Penalize non-standard sizes | Accept any shape |
| `EMA_ALPHA` | 0.35 | Temporal smoothing | More responsive, jitterier | Smoother, laggier |
| `MAX_CORNER_JUMP` | 0.15 | EMA reset threshold | Accept larger repositioning | Reset more aggressively |
| Edge response normalization | /80 | Expected avg gradient at edge | Lower scores per quad | Higher scores per quad |
| Ideal aspect ratio | 0.75 | Expected page shape | Penalizes other shapes more | N/A |

---

## Known Limitations & Failure Modes

### 1. Curved pages (open book spine)
**Problem:** Page edges curve near the spine binding. Hough lines vote for straight lines, so the curved portion gets spread across multiple bins.
**Impact:** Detection may fail on the spine-side edge, or the quad may be inaccurate near the spine.
**Possible fix:** Post-process with curved-edge fitting, or use Hough circle segments for the spine side.

### 2. Occluded edges (fingers holding the page)
**Problem:** When fingers cover a corner or edge, that edge gets fewer Hough votes.
**Mitigation:** Hough lines are robust to partial occlusion — a line with 60% visibility still gets voted for. However, if two adjacent edges are occluded (e.g., holding the book open with both hands on the left side), detection may fail.
**Note:** The original bug ("edge detection only worked when fingers were visible") was likely caused by the old contour-based approach requiring closed boundaries. Hough lines should be more tolerant.

### 3. Textured surfaces (wood grain, printed tablecloth)
**Problem:** Strong linear textures on the desk produce spurious Hough lines.
**Mitigation:** Quad scoring should filter these out — the "page" formed by desk texture lines won't have consistent edge response on all four sides. But if the texture is grid-like (tiled floor), it could form convincing-looking quads.
**Untested.**

### 4. Multiple books / rectangles in frame
**Problem:** A laptop, notebook, or second book creates additional valid quads.
**Mitigation:** Scoring favors the largest quad, which should be the book the user is pointing at. But if a laptop is closer to the camera (larger in frame), it might win.
**Possible fix:** Use color histogram inside vs outside the quad to prefer the quad containing book-like content.

### 5. Very low-contrast page edges
**Problem:** Some old books on matching-color surfaces have nearly zero edge signal in all channels.
**Mitigation:** Multi-channel Sobel helps, but there's a fundamental limit — if no channel has a detectable edge, nothing will detect it.
**Possible fix:** Adaptive thresholding (lower Canny thresholds when no edges found), or prompt the user to use a contrasting surface.

### 6. Non-rectangular pages (damaged, torn, irregularly trimmed)
**Problem:** Historical books may have irregular edges. The pipeline assumes 4-sided convex quadrilateral.
**Impact:** Won't detect or will detect a bounding quad that includes blank areas.
**Acceptable:** Perspective correction handles trapezoidal distortion; damaged edges are a display concern, not a detection concern.

---

## What We Don't Know (Hypotheses to Test)

### H1: Multi-channel Sobel outperforms grayscale for real page-on-desk scenes
**Test:** Capture 20 photos of books on various surfaces (white desk, wood, fabric, dark surface). Run both grayscale and RGB-max Sobel. Compare detection success rate and corner accuracy.
**Expected:** RGB-max wins on light-colored surfaces; similar on dark surfaces.

### H2: The scoring weights produce correct quad selection
**Test:** In scenes with multiple rectangles (book + laptop, book + notebook), verify the page is selected. In scenes with strong desk texture (wood grain), verify the page wins over texture-formed quads.
**Expected:** Edge response weight (35%) provides enough signal to pick the real page.

### H3: Temporal smoothing doesn't introduce harmful lag
**Test:** Slowly move a book across the frame. Measure the delay (in frames) between the book reaching a position and the overlay catching up. Verify the delay is under 3 frames (200ms at 15fps).
**Expected:** At α=0.35, lag should be ~2 frames. If α=0.2 would be tried, lag ~4 frames.

### H4: 320px resolution is sufficient for faint edges
**Test:** Scenes with very low contrast (cream page on light wood). Compare detection at 240px, 320px, 480px.
**Expected:** 320px works for most cases; 480px needed only for extremely faint edges.

### H5: Hough gradient-direction voting doesn't miss real lines
**Test:** Compare detection with gradient-direction constraint (±20°) vs full-angle voting. Count missed lines.
**Expected:** No difference in detection quality; 3-5× speedup confirmed.

### H6: Frame hold (3 frames) is the right duration
**Test:** Rapidly wave hand across the page. Count how often the overlay blinks vs stays stable. Too long a hold shows stale quads; too short causes flicker.
**Expected:** 3 frames (200ms) is right. 5 frames (330ms) might be better if brief hand-crossing is common.

### H7: The Hough approach handles the "fingers" case better than contour tracing
**Test:** Hold a book with fingers visibly covering two corners. Compare old contour approach vs new Hough approach.
**Expected:** Hough detects despite partial occlusion; contour fails.

---

## Comparison: Canvas vs OpenCV.js

Both detectors implement the same `EdgeDetector` interface. The Canvas detector (this file) is a pure-JS implementation; the OpenCV.js detector loads an 8MB WASM module.

| Aspect | Canvas (Hough) | OpenCV.js |
|--------|---------------|-----------|
| Bundle size | ~0 KB (pure JS) | ~8 MB (WASM) |
| Load time | Instant | 2-5s on mobile |
| Algorithm | RGB Sobel → Hough Lines → Quad enumeration | Canny → findContours → approxPolyDP |
| Faint edges | Multi-channel preserves chrominance | Grayscale Canny only |
| Broken edges | Hough voting handles partial lines | Contour tracing needs connectivity |
| Performance | ~15-30fps at 320px (pure JS) | ~15-30fps at 320px (WASM) |
| Curved pages | Weak (straight lines only) | Weak (also straight approximation) |

The OpenCV.js detector is at `/scan/opencv` and exists as a comparison baseline. If the Canvas detector proves sufficient, the OpenCV.js dependency can be removed.

---

## File Reference

| File | Role |
|------|------|
| `src/lib/scan/canvas-edge-detection.ts` | This pipeline (608 lines) |
| `src/lib/scan/opencv-edge-detection.ts` | OpenCV.js alternative |
| `src/lib/scan/edge-detection-types.ts` | Shared interface |
| `src/lib/scan/auto-capture.ts` | Stability/blur/exposure → capture signal |
| `src/components/scan/Viewfinder.tsx` | Camera + animation loop + overlay rendering |
| `src/app/scan/auto/page.tsx` | Full scan flow (Canvas detector) |
| `src/app/scan/opencv/page.tsx` | Full scan flow (OpenCV detector) |
