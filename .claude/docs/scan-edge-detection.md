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

## Real-World Usage Scenarios

The pipeline was designed and tested in a narrow context: a well-lit desk, a flat book, a modern phone. Real users will scan in wildly different conditions. This section maps specific scenarios to pipeline behavior, identifying what works, what's risky, and what will fail.

### Scenario Matrix

The four independent axes that define a scanning session:
1. **Lighting** — type, intensity, direction, consistency
2. **Book** — age, size, binding, page color, flatness
3. **Surface** — color, texture, material
4. **Phone** — camera quality, processing power, screen size

Each combination creates a different challenge profile.

---

### Lighting Scenarios

#### L1: Library reading room (overhead fluorescent)
**Conditions:** Even, diffuse light from above. No shadows. Color temperature ~4000-5000K (slightly blue-white).
**Pipeline impact:** **Best case.** Even illumination means consistent edge contrast across all four sides of the page. No shadows crossing the page. Mean luminance will sit comfortably in the 50-230 exposure range. Sharpness should be good (fluorescent flicker is faster than camera shutter).
**Risks:** Overhead fluorescent can create a slight glare/specular reflection on glossy pages. This is a sharpness problem, not an edge detection problem.
**Auto-capture:** Should work well. Stability (desk surface), sharpness (good light), exposure (ideal range), page detection (consistent edges) — all four conditions met easily.

#### L2: Home desk with warm lamp
**Conditions:** Single-source directional light (desk lamp), warm color temperature (~2700-3000K). Creates one bright side and one shadow side.
**Pipeline impact:** **Moderate risk.** The shadowed side of the book will have lower edge contrast. Multi-channel Sobel helps here — warm light means the blue channel has lower intensity overall, but the *difference* between page-blue and desk-blue may still be detectable. The shadow edge (where the desk lamp shadow crosses the page boundary) could confuse the edge detector — it's a strong gradient that isn't a page edge.
**Key parameters stressed:** `CANNY_HIGH_RATIO` and `CANNY_LOW_RATIO`. The shadowed side may produce weak edges that only survive at the low threshold. If the lamp shadow crosses the page, it produces a spurious strong edge. The ratio-based thresholds will scale to the lamp shadow (the brightest gradient in the frame), potentially making the page edge too faint to pass even the low threshold.
**Mitigation:** The quad scoring should help — a lamp shadow creates a single strong edge, not four sides of a quad. But if the shadow falls along one page edge, the scorer might mistake the shadow line for one side of the quad.

#### L3: Natural window light (daytime, indirect)
**Conditions:** Diffuse, color-neutral light from a window. Intensity varies with weather and time of day. Usually directional (one bright side).
**Pipeline impact:** **Generally good.** Natural daylight provides strong chrominance differentiation. The directionality is usually less harsh than a desk lamp. Mean luminance is typically in a good range (80-180).
**Risks:** On overcast days, light can be quite flat and dim. Very bright days with direct sun hitting the desk fall into scenario L5 below.

#### L4: Dim conditions (evening, poor ambient light)
**Conditions:** Mean luminance < 50. Phone camera may auto-gain (introducing noise) or extend exposure time (introducing motion blur).
**Pipeline impact:** **High risk.** Two problems compound:
1. **Noise from camera auto-gain.** ISO cranked up means pixel-level noise, which produces false edge pixels everywhere. The Sobel operator amplifies noise (it's a derivative filter). Multi-channel Sobel on noisy RGB channels means noisy edges in every channel.
2. **Motion blur from long exposure.** If the camera uses 1/15s or 1/8s shutter speed, hand tremor blurs the page edge. The edge gradient is spread across multiple pixels, reducing peak magnitude. The Canny thresholds may not adapt low enough.
**Auto-capture impact:** `exposed` condition will fail (luminance < 50). The user will see "Too dark" status text. Auto-capture won't fire, which is correct — images captured in this condition would be low quality anyway.
**Parameters stressed:** `CANNY_LOW_RATIO` minimum floor of 8. In very low-light scenes, even this may be too high for the faint edges that survive noise. But lowering it further would accept noise as edges.
**Recommendation:** The status text "Too dark" is the correct response. We shouldn't try to make edge detection work in conditions where the captured image would be unusable anyway.

#### L5: Direct sunlight / harsh shadows
**Conditions:** Mean luminance > 200. Hard shadows with extreme contrast. Specular reflections on glossy pages. Color may wash out.
**Pipeline impact:** **High risk from shadows, not from brightness.** The page itself will have strong edges (brightness contrast with desk is high). But:
1. **Hard shadow lines** from the phone, user's hand, or nearby objects create strong spurious edges *on the page*. These are straight, high-contrast gradients that look like page edges to the Hough detector.
2. **Specular reflections** on glossy pages create bright spots that saturate the camera sensor, destroying edge information in that region.
3. **Washed-out color** reduces chrominance differences (everything trends toward white at high luminance), weakening the multi-channel Sobel advantage.
**Auto-capture impact:** `exposed` condition may fail if mean luminance > 230. Status text: "Too bright."
**Parameters stressed:** The shadow lines are the real problem. Perimeter edge response scoring should help — a shadow line across the middle of the page won't form a complete quad with edge response on all four sides. But a shadow falling exactly along one page edge is indistinguishable from the actual edge.

#### L6: Mixed lighting (window + overhead + lamp)
**Conditions:** Multiple light sources with different color temperatures. Common in cafes, living rooms. Creates complex shadow patterns.
**Pipeline impact:** **Moderate risk.** Each light source creates a separate shadow, potentially multiple spurious edge lines. But the chrominance advantage of RGB Sobel actually helps here — color temperature differences between lights mean different channels dominate in different regions of the image, so the multi-channel approach picks up the page edge from whichever channel has the best signal in each region.
**Key insight:** This scenario may actually be *better* for multi-channel Sobel than single-source lighting, because the spectral diversity ensures at least one channel has good edge contrast at every point around the page boundary.

---

### Book Scenarios

#### B1: Modern paperback (white pages, crisp edges)
**Conditions:** Clean white pages, machine-cut edges, flat when open. Standard aspect ratio (~0.65-0.7).
**Pipeline impact:** **Easy case.** Strong edges on all four sides, consistent color contrast with any non-white surface.
**Assumption validated:** Ideal aspect ratio of 0.75 is close.

#### B2: Old book (yellowed/foxed pages, irregular trim)
**Conditions:** Pages range from cream to dark brown. Edge may be ragged or uneven. Spine binding may pull pages into a curve.
**Pipeline impact:** **Moderate risk.** Yellowed pages have *lower* luminance contrast with warm-colored surfaces (wood desk, beige tablecloth). But the chrominance difference (yellow-brown vs desk color) is usually present in the blue channel. Foxing spots and stains create internal texture that adds noise edges.
**Key parameter:** `MIN_AREA_RATIO = 0.08`. An old book with ragged edges might produce a detected quad smaller than the actual page, since the ragged edge doesn't vote consistently for a single Hough line. The area scoring would penalize a "correct but slightly too small" quad less than a clearly wrong one.
**Spine curvature:** See "Curved pages" failure mode. Many old books can only be opened flat with significant spine pressure, which most users won't apply when scanning 200 pages.

#### B3: Large folio / oversized book
**Conditions:** Page is significantly larger than the phone's field of view at normal scanning distance. User must hold phone further away.
**Pipeline impact:** **Moderate risk.** When the page fills the entire frame edge-to-edge, there may be no visible page-desk boundary on one or more sides. The Hough detector can only find edges that are *in the frame*. If two sides of the page are cropped by the camera, only 2 edges are visible — not enough for a quad.
**Auto-capture impact:** `pageDetected` may oscillate between true/false as the user tries to frame the page. The status text will alternate between "Looking for page..." and "Hold steady..."
**Recommendation:** For folios, the user should hold the phone farther back. The status text could suggest this, but we don't currently distinguish "some edges found but not enough" from "no edges at all."
**Parameters stressed:** `MIN_AREA_RATIO = 0.08`. A folio that fills the frame would have an area ratio of ~1.0. Not a problem. But if the user holds the phone too close and only captures 2/3 of the page, the detected quad might only cover part of the page.

#### B4: Small pamphlet / octavo
**Conditions:** Page is small relative to the phone's field of view. Page fills maybe 30-40% of the frame. More desk visible than book.
**Pipeline impact:** **Should work well.** The page produces a smaller quad, but area scoring prefers the page over noise rectangles because it's the largest coherent rectangle in the frame. `MIN_AREA_RATIO = 0.08` is permissive enough for a 30% fill.
**Risk:** More desk visible means more desk texture edges (wood grain, scratches). The quad scorer must correctly prefer the page quad over desk-texture quads. Edge response scoring is key here — the page quad has real gradient on all four edges; desk texture patterns usually don't form complete quadrilaterals.

#### B5: Thick bound book (can't lay flat)
**Conditions:** When opened, the page near the spine curves upward. The visible "rectangle" is actually a trapezoid with a curved spine edge. Pages near the spine may be foreshortened.
**Pipeline impact:** **High risk for the spine edge.** The spine-side edge curves, so it doesn't produce a clean Hough line. Votes spread across multiple angle bins. The detector may find only 3 clean edges (top, bottom, outer), not 4.
**With only 3 clean edges:** The quad enumeration requires 2 horizontal + 2 vertical lines. If one horizontal or one vertical is missing/weak, no quads are formed. Detection fails.
**Partial mitigation:** The Hough detector might pick up the *chord* of the curved edge (a straight line approximating the curve). This would give a less accurate quad, but might still trigger detection and auto-capture.
**Trade-off:** Perspective correction using an inaccurate quad near the spine will distort the captured image. But any correction is probably better than no correction, and the server-side Gemini OCR handles moderate distortion well.

#### B6: Dark/colored pages (woodcut backgrounds, printed on colored paper)
**Conditions:** Some historical books have dark backgrounds (black letter on dark cream), heavily inked woodcut pages, or colored paper.
**Pipeline impact:** **Variable.** Dark pages on a dark surface = no edge. Dark pages on a light surface = inverted contrast (dark on light instead of light on dark). The edge detector doesn't care about polarity — Sobel gradient magnitude is the absolute value of the derivative. A dark-to-light transition produces the same magnitude as a light-to-dark transition.
**Assumption:** The Sobel operator is sign-agnostic. This means a dark page on a light desk works as well as a light page on a dark desk.

#### B7: Glossy/coated pages (art books, modern reprints)
**Conditions:** Specular reflections from smooth page surface. Reflections move as user shifts angle.
**Pipeline impact:** **Risk from reflections.** A specular highlight creates a bright blob that:
1. May saturate the camera sensor, creating a flat white region with no edge information
2. Produces strong gradient at the highlight boundary, which could be detected as an edge
3. Moves with the user's angle, causing the detected edges to shift between frames
**Temporal smoothing impact:** The moving reflection causes detected corners to shift frame-to-frame, potentially exceeding the `MAX_CORNER_JUMP = 0.15` threshold and resetting the EMA. This would cause the overlay to jump around.
**Auto-capture impact:** Moving reflections → shifting quad → stability detection may never converge. The "Hold steady..." status text may persist indefinitely.

---

### Surface Scenarios

#### S1: Dark wood desk
**Conditions:** High luminance contrast (white page, dark desk). Visible wood grain texture running in one direction.
**Pipeline impact:** **Best case for edge detection.** Strong gradient at every page boundary. The grayscale Sobel would work fine here; RGB Sobel provides no additional benefit but doesn't hurt.
**Wood grain risk:** Parallel grain lines produce Hough votes in a narrow theta band. If the grain runs horizontally, it produces spurious horizontal lines. The quad enumeration would try to form quads using grain-line + page edges, but perimeter edge response scoring should reject these — the grain-line "edge" would only have strong response along one side.

#### S2: White or very light desk
**Conditions:** Low luminance contrast. The scenario that motivated the RGB Sobel rewrite.
**Pipeline impact:** **The critical test case.** If the page is white/cream and the desk is white/light gray, luminance contrast is near zero. The multi-channel Sobel must find the edge in whichever RGB channel has the most chrominance difference.
**Real-world chrominance:** "White" desks are usually slightly blue-gray, yellow-gray, or pink-gray. "White" pages are usually slightly yellow (new paper) or cream (old paper). The blue channel typically shows the most difference (paper yellow vs desk blue-gray), on the order of 15-40 units at 8-bit depth.
**Will this work?** At 15-40 units of difference in one channel, after 3x3 blur and Sobel, the gradient magnitude might be ~20-50. The `CANNY_HIGH_RATIO = 0.15` threshold adapts to the max gradient in the frame. If the max gradient is from the page edge (50), the high threshold is 7.5, and the edge survives. If the max gradient is from something else in the scene (a laptop with 200+ contrast), the high threshold becomes 30, and the faint page edge (magnitude 20) falls below it.
**Key insight:** The threshold *ratio* is the vulnerability. In a scene with a faint page edge AND a high-contrast object (laptop, phone), the ratio-based thresholds are set by the high-contrast object, potentially drowning the faint page edge.

#### S3: Patterned fabric (tablecloth, blanket, bedspread)
**Conditions:** Regular or irregular patterns creating many edge-like features. Variable texture density.
**Pipeline impact:** **High risk.** A plaid tablecloth produces multiple strong parallel lines in two perpendicular directions — exactly the pattern that the quad enumeration is looking for. The detector might find the tablecloth grid instead of (or in addition to) the page.
**Mitigation:** The perimeter edge response should distinguish page edges from tablecloth edges. A page edge has consistent gradient along its entire length; a tablecloth edge has periodic gaps between the pattern. But if the tablecloth has a solid border region near the page, this distinction may not hold.
**Recommendation:** This is a scenario where user guidance ("use a plain surface") is more practical than algorithmic fixes.

#### S4: User's lap (scanning while seated)
**Conditions:** Uneven surface (thighs create a valley). Book may tilt or slide. Fabric texture from clothing. Moving surface (breathing, fidgeting).
**Pipeline impact:** **Multiple problems:**
1. **Book not flat:** Tilted book means perspective distortion is more extreme. The detected quad may still work, but the page edge closest to the user is foreshortened and may be partially occluded by the page curling up.
2. **Fabric texture:** Clothing creates noise edges, similar to S3.
3. **Movement:** User breathing and fidgeting creates constant low-level motion. The `stabilityThreshold = 0.5 m/s²` may never be sustained for the required `stabilityDuration = 300ms`.
**Auto-capture impact:** `stable` condition may rarely be met. Users would need to use the manual shutter button.

#### S5: Floor / carpet
**Conditions:** User stands above the book looking down. Greater camera-to-book distance. Carpet texture if not hardwood.
**Pipeline impact:** **Greater distance** means the page fills less of the frame, but edge detection should still work (similar to B4 small pamphlet scenario). **Viewing angle** is more oblique than desk scanning, which means more extreme perspective distortion.
**Stability:** Standing is less stable than seated at a desk. Phone held at arm's length wobbles more. The `stabilityThreshold = 0.5 m/s²` may be harder to achieve.
**Carpet:** Dense pile creates diffuse texture that doesn't produce strong Hough lines (unlike striped tablecloths). Low-pile carpet should be fine. Patterned carpet (geometric patterns) is a problem similar to S3.

#### S6: Book held in hand (no surface)
**Conditions:** User holds the book in one hand, phone in the other. No background surface — the background is whatever is behind the book (room, furniture, etc.).
**Pipeline impact:** **Unpredictable background.** The background changes as the user moves. Could contain other rectangles (doors, windows, screens). The page edge contrast depends entirely on what's behind the book.
**Stability:** Both hands are occupied. No support surface. Stability is very poor.
**Auto-capture impact:** `stable` will almost never be met. Manual capture only.
**Recommendation:** This is a valid use case (scanning in a library where you can't put the book down) but the worst case for auto-capture. The manual shutter button is essential.

---

### Phone Scenarios

#### P1: Modern iPhone (14+)
**Conditions:** High-quality camera (12-48MP), fast processor (A16+), good low-light performance. iOS may aggressively auto-expose and auto-focus.
**Pipeline impact:** **Best case for quality.** Camera provides clean, well-exposed frames. Processing at 320px should run well above 30fps. The auto-focus is fast and reliable.
**iOS-specific:** `DeviceMotionEvent.requestPermission()` is required (iOS 13+). The auto-capture controller handles this, falling back to `stable = true` if permission is denied.
**Frame delivery:** iOS Safari delivers camera frames at up to 30fps via `requestAnimationFrame`. At 320px processing resolution, each frame takes ~5-15ms to process (Sobel + Hough). Well within budget.

#### P2: Modern Android flagship (Pixel, Samsung S series)
**Conditions:** Similar hardware capability to iPhone. May have multiple cameras (wide, ultrawide, telephoto).
**Pipeline impact:** **Generally good.** Chrome's `getUserMedia` with `facingMode: 'environment'` picks the main back camera. Processing performance is comparable to iPhone for flagships.
**Camera selection:** The `ideal: 1920, ideal: 1080` constraints should select the appropriate resolution. Some Android phones may have quirks with camera selection — Samsung's default might be the wide-angle lens, which has more barrel distortion.
**Android-specific:** `DeviceMotionEvent` doesn't require permission on most Android versions. The accelerometer data is available immediately. However, some budget Android phones have noisy accelerometers, which would affect stability detection.

#### P3: Budget Android phone (2-3 years old)
**Conditions:** Lower camera quality (noisy sensor, slower auto-focus), slower processor (Snapdragon 400-600 series), smaller RAM.
**Pipeline impact:** **Performance is the primary concern.** At 320px, the Sobel pass involves ~3 × 77K operations (3 channels × 320×240). The Hough pass depends on edge pixel count but typically ~200K accumulator writes. Total CPU per frame: ~500K-1M operations.
**Frame rate:** On a budget Snapdragon 600-series, JS execution is 3-5× slower than iPhone 14. A frame that takes 10ms on iPhone might take 30-50ms on a budget Android. At 33ms/frame (30fps) this is borderline. The `requestAnimationFrame` loop will naturally throttle — if processing takes 50ms, it runs at 20fps instead of 30fps. Edge detection at 20fps should still work, but the viewfinder overlay will feel less fluid.
**Allocation pressure:** Each frame allocates several `Float32Array` buffers (r, g, b, blurred, sobel × 3 channels). On a phone with 3-4GB RAM, this is fine. On a 2GB phone, GC pauses could cause frame drops.
**Mitigation:** Could reduce `TARGET_WIDTH` to 240 for low-power devices. This roughly halves the work (~56K pixels vs 77K). Detection quality would decrease for faint edges but should still work for high-contrast edges.
**Camera quality:** Noisy sensors produce grainy images. At 320px downscale, noise is somewhat averaged out (each processing pixel represents ~6×6 camera pixels at 1920×1080). This natural anti-aliasing helps, but won't fully compensate for very noisy sensors.

#### P4: Older iPhone (SE, 8, X)
**Conditions:** Still capable processors (A11+), decent cameras, but smaller screens and less RAM.
**Pipeline impact:** **Should work fine.** A11 chip (iPhone 8/X, 2017) is still faster than mid-range 2024 Android chips for JS execution. The smaller screen means the viewfinder canvases are smaller, which is actually slightly cheaper to render.
**RAM constraint:** iPhone SE (2016) has 2GB RAM, iPhone 8 has 2GB, iPhone X has 3GB. The Float32Array allocations are ~77K × 4 bytes × ~10 arrays = ~3MB per frame. This is fine even on 2GB devices.

#### P5: iPad / tablet
**Conditions:** Larger screen, potentially better camera, more processing power. Awkward to hold over a book.
**Pipeline impact:** **Edge detection works fine.** The canvases are larger (more pixels to render for the viewfinder display), but processing is still at 320px.
**Ergonomic concern:** Holding a 10" tablet over a desk is more unwieldy than a phone. Stability is harder to achieve. The tablet's weight causes more arm fatigue during a 200-page scanning session.
**Auto-capture impact:** `stable` condition is harder to sustain. Heavier device = more inertia, but also more arm wobble.

---

### Compound Scenarios (Real-World Sessions)

These are specific realistic scanning sessions that combine multiple axes:

#### C1: Scholar in a library reading room
**Profile:** L1 (fluorescent) + B2 (old book) + S1 (dark wood table) + P1 (iPhone 14)
**Expected:** **Should work well.** Good lighting, high contrast (old book on dark desk), powerful phone. Biggest risk is spine curvature on thick old books. The scholar will need to press the book flat or use a book cradle.
**Session length:** 200-400 pages. Battery and storage concerns over a 1-2 hour session. OPFS persistence protects against mid-session crashes.

#### C2: Student at home desk
**Profile:** L2 (desk lamp) + B1 (modern paperback) + S2 (white IKEA desk) + P2 (Pixel 7)
**Expected:** **The critical white-on-white test.** The desk lamp provides some shadow-based contrast. The multi-channel Sobel should detect the page. The desk lamp shadow might create a spurious edge across the desk surface.
**Worst sub-case:** If the paperback is white and the desk is white, in the zone NOT illuminated by the desk lamp (shadow side), the edge contrast may be extremely low. The illuminated side should be fine.

#### C3: Researcher in a cafe
**Profile:** L6 (mixed) + B2 (old book) + S3 (tablecloth) + P3 (budget Android)
**Expected:** **Difficult.** Patterned tablecloth generates spurious edges. Budget phone may struggle with processing speed. Mixed lighting creates complex shadow patterns. The researcher would be better off using the manual shutter button.

#### C4: Scanning in bed / on couch
**Profile:** L4 (dim) + B1 (paperback) + S3 (fabric) + P1 (iPhone)
**Expected:** **Auto-capture won't fire** (too dark + unstable surface). The user sees "Too dark" status. They could still use manual capture, but image quality will be poor (noisy, potentially blurry). This is a scenario where the system correctly refuses to auto-capture.

#### C5: Outdoor scanning (garden, patio)
**Profile:** L5 (direct sun) + B2 (old book) + S1 (outdoor table) + P2 (Android)
**Expected:** **Shadow problems.** Direct sunlight creates hard shadows from the user's hand and the phone itself. The phone shadow falls directly on the page (since the user is between the sun and the book). This shadow creates a strong edge on the page that isn't a page boundary.
**Specular reflections** on coated pages are worse outdoors (bright sun + smooth page = intense glare).

#### C6: Standing at a bookshelf
**Profile:** L1/L3 (indoor light) + B5 (thick book from shelf) + S6 (held in hand) + P1/P2
**Expected:** **Manual capture only.** No surface, poor stability, can't press book flat. Edge detection may work intermittently if the book is held against a contrasting wall. The user would take one photo of each page spread, then split later.

---

### Critical Assumptions Summary

| Assumption | Where it matters | Scenarios that stress it |
|------------|-----------------|------------------------|
| Page has 4 straight edges | Hough lines + quad enumeration | B5 (curved spine), B2 (ragged old books) |
| At least one RGB channel has page-desk edge | Multi-channel Sobel | S2 (white on white), B6 (dark on dark) |
| Page edge is the strongest gradient in the frame | Canny ratio-based thresholds | L5 (shadow lines), S3 (tablecloth), multiple rectangles |
| User is holding phone steady | Stability detection + EMA | S4 (lap), S6 (handheld), C4 (bed), P5 (tablet) |
| 320px resolution is sufficient | Downscale | Very faint chrominance edges at S2 |
| Processing completes in ~15-30ms | requestAnimationFrame budget | P3 (budget Android) |
| Consistent lighting across all 4 page edges | Edge detection on all sides | L2 (directional lamp), L5 (shadows) |

---

### Design Implications

**Things we should NOT try to fix algorithmically:**
- Scanning in the dark (L4) — correctly refuse
- Scanning on complex patterns (S3) — suggest plain surface
- Scanning while walking/moving (S6 handheld) — manual shutter exists
- Scanning in direct sunlight with hard shadows (L5) — suggest shade

**Things that could improve with parameter tuning:**
- White page on white desk (S2) — consider *absolute* Canny thresholds alongside ratio-based ones, or limit the "max gradient" computation to exclude the top 1% (outlier shadows)
- Budget Android performance (P3) — adaptive `TARGET_WIDTH` based on frame timing
- Thick books with spine curve (B5) — relax the quad enumeration to allow 3-line detection with one inferred edge

**Things to test first (highest impact):**
1. White page on white desk (S2) — the core RGB Sobel hypothesis
2. Desk lamp shadow crossing the page (L2) — the ratio threshold problem
3. Patterned tablecloth (S3) — quad scorer robustness
4. Budget Android at 320px (P3) — frame timing

**UX mitigations that help more than algorithm changes:**
- "Use a dark surface" prompt when detection repeatedly fails
- "Move to a brighter spot" when luminance is borderline (40-60 range)
- "Hold phone further back" when detected quad hits frame boundaries
- Manual shutter button always visible (never hidden behind auto-capture)
- Session persistence (OPFS) so users can stop/resume across different locations

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
