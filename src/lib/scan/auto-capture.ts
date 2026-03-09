/**
 * Auto-capture controller for the mobile scanner.
 *
 * Evaluates four conditions each frame and fires onCapture when
 * all conditions are met for a sustained period:
 *   1. stable  — device is still (DeviceMotionEvent)
 *   2. sharp   — detected region is in focus
 *   3. exposed — lighting is adequate
 *   4. pageDetected — edge detection found a page
 */

export interface CaptureConditions {
  stable: boolean;
  sharp: boolean;
  exposed: boolean;
  pageDetected: boolean;
}

export interface AutoCaptureOptions {
  stabilityThreshold?: number;   // m/s^2, default 0.5
  stabilityDuration?: number;    // ms device must be still, default 300
  sharpnessThreshold?: number;   // 0-1, default 0.15
  luminanceRange?: [number, number]; // acceptable mean luminance, default [50, 230]
  captureDelay?: number;         // ms all conditions must hold, default 500
}

const DEFAULT_OPTIONS: Required<AutoCaptureOptions> = {
  stabilityThreshold: 0.5,
  stabilityDuration: 300,
  sharpnessThreshold: 0.15,
  luminanceRange: [50, 230],
  captureDelay: 500,
};

const COOLDOWN_MS = 1000;

export class AutoCaptureController {
  private opts: Required<AutoCaptureOptions>;

  // Condition state
  private conditions: CaptureConditions = {
    stable: false,
    sharp: false,
    exposed: false,
    pageDetected: false,
  };

  // Stability tracking
  private stableSince: number | null = null;
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;

  // Capture timing
  private allMetSince: number | null = null;
  private cooldownUntil = 0;

  // Public callback
  onCapture: ((conditions: CaptureConditions) => void) | null = null;

  constructor(options?: AutoCaptureOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Begin listening to DeviceMotionEvent for stability detection.
   * On iOS 13+, requests permission first (async, may show a prompt).
   */
  async start(): Promise<void> {
    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent !== 'undefined' && 'requestPermission' in DeviceMotionEvent) {
      try {
        const permission = await (
          DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
        ).requestPermission();
        if (permission !== 'granted') {
          // Can't detect stability — assume stable so other conditions still work
          this.conditions.stable = true;
          return;
        }
      } catch {
        this.conditions.stable = true;
        return;
      }
    }

    this.motionHandler = (e: DeviceMotionEvent) => this.handleMotion(e);
    window.addEventListener('devicemotion', this.motionHandler);
  }

  /**
   * Stop listening and clean up.
   */
  stop(): void {
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
    this.allMetSince = null;
    this.stableSince = null;
  }

  /**
   * Called each frame by the Viewfinder with edge detection + quality results.
   * Evaluates sharpness, exposure, and page detection. Then checks if all
   * conditions (including stability) are met for the capture delay.
   */
  updateFrame(
    conditions: Omit<CaptureConditions, 'stable'>
  ): void {
    this.conditions.sharp = conditions.sharp;
    this.conditions.exposed = conditions.exposed;
    this.conditions.pageDetected = conditions.pageDetected;

    this.evaluateCapture();
  }

  getConditions(): CaptureConditions {
    return { ...this.conditions };
  }

  // -- Internal --

  private handleMotion(e: DeviceMotionEvent): void {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) {
      // No accelerometer data — assume stable
      this.conditions.stable = true;
      return;
    }

    // Subtract gravity (~9.8) from the magnitude to get movement-only acceleration.
    // accelerationIncludingGravity reports ~9.8 at rest.
    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    const movement = Math.abs(magnitude - 9.81);

    const now = Date.now();

    if (movement < this.opts.stabilityThreshold) {
      if (this.stableSince === null) {
        this.stableSince = now;
      }
      this.conditions.stable = now - this.stableSince >= this.opts.stabilityDuration;
    } else {
      this.stableSince = null;
      this.conditions.stable = false;
    }
  }

  private allConditionsMet(): boolean {
    return (
      this.conditions.stable &&
      this.conditions.sharp &&
      this.conditions.exposed &&
      this.conditions.pageDetected
    );
  }

  private evaluateCapture(): void {
    const now = Date.now();

    // In cooldown after a recent capture
    if (now < this.cooldownUntil) return;

    if (this.allConditionsMet()) {
      if (this.allMetSince === null) {
        this.allMetSince = now;
      } else if (now - this.allMetSince >= this.opts.captureDelay) {
        // Fire capture
        this.onCapture?.({ ...this.conditions });
        this.allMetSince = null;
        this.cooldownUntil = now + COOLDOWN_MS;
      }
    } else {
      // Any condition dropped — reset timer
      this.allMetSince = null;
    }
  }
}
