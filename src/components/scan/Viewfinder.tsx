'use client';

import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import type { EdgeDetector, DetectionResult } from '@/lib/scan/edge-detection-types';
import type { AutoCaptureController } from '@/lib/scan/auto-capture';
import type { QualityMetrics } from '@/lib/scan/image-utils';
import { perspectiveCorrect, needsCorrection } from '@/lib/perspective-correct';

export interface ViewfinderHandle {
  triggerCapture: () => void;
}

interface ViewfinderProps {
  edgeDetector: EdgeDetector;
  autoCaptureController: AutoCaptureController;
  onCapture: (blob: Blob, corners: [number, number][] | null, quality: QualityMetrics) => void;
  enabled: boolean;
}

// Downscale resolution for detection (must be fast on mobile)
const DETECT_WIDTH = 320;
const DETECT_HEIGHT = 240;
const CAPTURE_QUALITY = 0.92;
const FLASH_DURATION_MS = 150;
const HAPTIC_MS = 50;

// Sharpness/brightness thresholds matching auto-capture defaults
const SHARPNESS_THRESHOLD = 0.15;
const LUMINANCE_MIN = 50;
const LUMINANCE_MAX = 230;

type CameraStatus = 'initializing' | 'active' | 'denied' | 'error';

const Viewfinder = forwardRef<ViewfinderHandle, ViewfinderProps>(function Viewfinder(
  { edgeDetector, autoCaptureController, onCapture, enabled },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const capturingRef = useRef(false);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('initializing');
  const [showFlash, setShowFlash] = useState(false);
  const [statusText, setStatusText] = useState('Initializing camera...');

  // -- Camera setup --

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setCameraStatus('active');
        setStatusText('Looking for page...');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setCameraStatus('denied');
          setStatusText('Camera access denied');
        } else {
          setCameraStatus('error');
          setStatusText('Camera error');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [enabled]);

  // -- Detection canvas (offscreen, created once) --

  useEffect(() => {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(DETECT_WIDTH, DETECT_HEIGHT);
      detectCanvasRef.current = c as unknown as HTMLCanvasElement;
    } else {
      const c = document.createElement('canvas');
      c.width = DETECT_WIDTH;
      c.height = DETECT_HEIGHT;
      detectCanvasRef.current = c;
    }
  }, []);

  // -- Quick quality from detection frame --

  const quickQuality = useCallback((gray: Uint8ClampedArray, w: number, h: number) => {
    let brightnessSum = 0;
    let lapSum = 0;
    let lapSumSq = 0;
    let lapCount = 0;
    const pixelCount = w * h;

    // Build grayscale values from RGBA
    const grayVals = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const r = gray[i * 4];
      const g = gray[i * 4 + 1];
      const b = gray[i * 4 + 2];
      grayVals[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      brightnessSum += grayVals[i];
    }

    const meanBrightness = brightnessSum / pixelCount;

    // Laplacian for sharpness
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const lap =
          grayVals[idx - w] + grayVals[idx + w] + grayVals[idx - 1] + grayVals[idx + 1] -
          4 * grayVals[idx];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount++;
      }
    }

    const lapMean = lapSum / lapCount;
    const lapVariance = lapSumSq / lapCount - lapMean * lapMean;

    const blurScore = Math.min(1, Math.max(0, lapVariance / 500));
    let brightnessScore: number;
    if (meanBrightness < 40) {
      brightnessScore = meanBrightness / 40;
    } else if (meanBrightness > 220) {
      brightnessScore = (255 - meanBrightness) / 35;
    } else {
      brightnessScore = 1;
    }
    brightnessScore = Math.min(1, Math.max(0, brightnessScore));

    return { blurScore, brightnessScore, meanBrightness };
  }, []);

  // -- Capture logic --

  const doCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current || cameraStatus !== 'active') return;
    capturingRef.current = true;

    try {
      // Flash
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), FLASH_DURATION_MS);

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(HAPTIC_MS);
      }

      // Grab full-res frame
      const fullW = video.videoWidth;
      const fullH = video.videoHeight;
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = fullW;
      captureCanvas.height = fullH;
      const ctx = captureCanvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, fullW, fullH);

      const detection = lastDetectionRef.current;
      const corners = detection ? detection.corners : null;

      let blob: Blob;

      // Perspective correct if we have corners and they're sufficiently distorted
      if (corners && needsCorrection(corners)) {
        const bitmap = await createImageBitmap(captureCanvas);
        // Estimate output size from the detected quad
        const outputWidth = Math.round(fullW * 0.9);
        const outputHeight = Math.round(fullH * 0.9);
        blob = await perspectiveCorrect(bitmap, corners, outputWidth, outputHeight);
        bitmap.close();
      } else {
        blob = await new Promise<Blob>((resolve, reject) => {
          captureCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
            'image/jpeg',
            CAPTURE_QUALITY
          );
        });
      }

      // Quick quality assessment on detection frame data
      const quality: QualityMetrics = {
        blurScore: 0.5,
        brightnessScore: 0.8,
      };

      // If we have detection frame data, use real quality
      const detectCanvas = detectCanvasRef.current;
      if (detectCanvas) {
        const dCtx = detectCanvas.getContext('2d');
        if (dCtx) {
          const imgData = dCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height);
          const q = quickQuality(imgData.data, detectCanvas.width, detectCanvas.height);
          quality.blurScore = q.blurScore;
          quality.brightnessScore = q.brightnessScore;
        }
      }

      setStatusText('Captured!');
      setTimeout(() => setStatusText('Looking for page...'), 1000);

      onCapture(blob, corners, quality);
    } finally {
      capturingRef.current = false;
    }
  }, [cameraStatus, onCapture, quickQuality]);

  // -- Expose triggerCapture to parent --

  useImperativeHandle(ref, () => ({ triggerCapture: doCapture }), [doCapture]);

  // -- Wire auto-capture callback --

  useEffect(() => {
    autoCaptureController.onCapture = () => doCapture();
    return () => {
      autoCaptureController.onCapture = null;
    };
  }, [autoCaptureController, doCapture]);

  // -- Animation loop --

  useEffect(() => {
    if (cameraStatus !== 'active') return;

    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const detectCanvas = detectCanvasRef.current;
    if (!video || !frameCanvas || !overlayCanvas || !detectCanvas) return;

    const frameCtx = frameCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    const detectCtx = detectCanvas.getContext('2d');
    if (!frameCtx || !overlayCtx || !detectCtx) return;

    function loop() {
      if (!video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      // Resize canvases to match video aspect ratio at display size
      const displayW = frameCanvas!.clientWidth;
      const displayH = frameCanvas!.clientHeight;
      if (frameCanvas!.width !== displayW || frameCanvas!.height !== displayH) {
        frameCanvas!.width = displayW;
        frameCanvas!.height = displayH;
        overlayCanvas!.width = displayW;
        overlayCanvas!.height = displayH;
      }

      // Draw video frame (cover-fit)
      const scale = Math.max(displayW / vw, displayH / vh);
      const drawW = vw * scale;
      const drawH = vh * scale;
      const dx = (displayW - drawW) / 2;
      const dy = (displayH - drawH) / 2;
      frameCtx!.drawImage(video, dx, dy, drawW, drawH);

      // Draw downscaled frame for detection
      detectCtx!.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
      const detectData = detectCtx!.getImageData(0, 0, DETECT_WIDTH, DETECT_HEIGHT);

      // Run edge detection
      const result = edgeDetector.detect(detectData);
      lastDetectionRef.current = result;

      // Quick quality from detection frame
      const q = quickQuality(detectData.data, DETECT_WIDTH, DETECT_HEIGHT);

      const sharp = q.blurScore > SHARPNESS_THRESHOLD;
      const exposed = q.meanBrightness >= LUMINANCE_MIN && q.meanBrightness <= LUMINANCE_MAX;

      // Update auto-capture conditions
      autoCaptureController.updateFrame({
        pageDetected: !!result,
        sharp,
        exposed,
      });

      // Update status text
      if (result) {
        const conditions = autoCaptureController.getConditions();
        if (conditions.stable && sharp && exposed) {
          setStatusText('Hold steady...');
        } else if (!sharp) {
          setStatusText('Too blurry — hold still');
        } else if (!exposed) {
          setStatusText(q.meanBrightness < LUMINANCE_MIN ? 'Too dark' : 'Too bright');
        } else {
          setStatusText('Hold steady...');
        }
      } else {
        setStatusText('Looking for page...');
      }

      // Draw overlay
      overlayCtx!.clearRect(0, 0, displayW, displayH);

      if (result) {
        // Draw green polygon
        overlayCtx!.strokeStyle = '#22c55e';
        overlayCtx!.lineWidth = 2;
        overlayCtx!.beginPath();
        for (let i = 0; i < result.corners.length; i++) {
          const [nx, ny] = result.corners[i];
          // Map from normalized detection coords to display coords
          const px = dx + nx * drawW;
          const py = dy + ny * drawH;
          if (i === 0) overlayCtx!.moveTo(px, py);
          else overlayCtx!.lineTo(px, py);
        }
        overlayCtx!.closePath();
        overlayCtx!.stroke();

        // Semi-transparent fill
        overlayCtx!.fillStyle = 'rgba(34, 197, 94, 0.06)';
        overlayCtx!.fill();
      } else {
        // Red border when no page detected
        overlayCtx!.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        overlayCtx!.lineWidth = 3;
        overlayCtx!.strokeRect(4, 4, displayW - 8, displayH - 8);
      }

      animFrameRef.current = requestAnimationFrame(loop);
    }

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraStatus, edgeDetector, autoCaptureController, quickQuality]);

  // -- Cleanup --

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      autoCaptureController.stop();
    };
  }, [autoCaptureController]);

  // -- Render --

  if (cameraStatus === 'denied') {
    return (
      <div className="relative w-full h-full bg-dark flex items-center justify-center">
        <div className="text-center px-8">
          <p className="text-white text-base mb-2">Camera access required</p>
          <p className="text-white/50 text-sm">
            Allow camera access in your browser settings to scan pages.
          </p>
        </div>
      </div>
    );
  }

  if (cameraStatus === 'error') {
    return (
      <div className="relative w-full h-full bg-dark flex items-center justify-center">
        <div className="text-center px-8">
          <p className="text-white text-base mb-2">Camera unavailable</p>
          <p className="text-white/50 text-sm">
            Could not access the camera. Try refreshing or using a different device.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-dark overflow-hidden">
      {/* Hidden video element (source for canvas drawing) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-0 h-0 opacity-0"
      />

      {/* Video frame canvas */}
      <canvas
        ref={frameCanvasRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Overlay canvas (edge detection polygon) */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Flash overlay */}
      {showFlash && (
        <div className="absolute inset-0 bg-white pointer-events-none animate-flash z-30" />
      )}

      {/* Status text */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none"
        style={{ paddingTop: 'env(safe-area-inset-top, 12px)' }}
      >
        <p className="text-center text-white/80 text-sm font-medium py-2 bg-dark/40 backdrop-blur-sm">
          {statusText}
        </p>
      </div>
    </div>
  );
});

export default Viewfinder;
