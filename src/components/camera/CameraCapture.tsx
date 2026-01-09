'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import CameraPermissionPrompt from './CameraPermissionPrompt';
import CaptureOverlay from './CaptureOverlay';
import ShutterButton from './ShutterButton';
import CapturedPageReview from './CapturedPageReview';
import CaptureProgress from './CaptureProgress';
import { upload } from '@/lib/api-client';

interface CameraCaptureProps {
  bookId: string;
  onComplete: () => void;
}

type PermissionStatus = 'prompt' | 'granted' | 'denied';

export default function CameraCapture({ bookId, onComplete }: CameraCaptureProps) {
  // Camera state
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('prompt');
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capture state
  const [capturedCount, setCapturedCount] = useState(0);
  const [lastCapture, setLastCapture] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Check for multiple cameras
  useEffect(() => {
    async function checkCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      } catch {
        // Ignore errors, just won't show flip button
      }
    }
    checkCameras();
  }, []);

  // Stop stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Initialize camera
  const initCamera = useCallback(async (facing: 'environment' | 'user') => {
    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: facing,
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1440, min: 960 },
          aspectRatio: { ideal: 4 / 3 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      streamRef.current = stream;
      setIsStreaming(true);
      setPermissionStatus('granted');
      setError(null);
    } catch (err) {
      console.error('Camera error:', err);
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setPermissionStatus('denied');
        } else {
          setError(err.message || 'Camera not available');
        }
      }
      setIsStreaming(false);
    }
  }, []);

  // Request permission and start camera
  const handleRequestPermission = useCallback(() => {
    setError(null);
    initCamera(cameraFacing);
  }, [initCamera, cameraFacing]);

  // Flip camera
  const handleFlipCamera = useCallback(() => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    initCamera(newFacing);
  }, [cameraFacing, initCamera]);

  // Capture frame
  const captureFrame = useCallback((): Promise<{ blob: Blob; dataUrl: string } | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas) {
        resolve(null);
        return;
      }

      // Set canvas to video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      // Draw current frame
      ctx.drawImage(video, 0, 0);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }

          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve({ blob, dataUrl });
        },
        'image/jpeg',
        0.92
      );
    });
  }, []);

  // Handle shutter press
  const handleCapture = useCallback(async () => {
    const result = await captureFrame();
    if (result) {
      setLastCapture(result);
      setIsReviewing(true);
    }
  }, [captureFrame]);

  // Upload image
  const uploadImage = useCallback(async (blob: Blob): Promise<boolean> => {
    try {
      const file = new File([blob], `page_${Date.now()}.jpg`, { type: 'image/jpeg' });
      await upload.images(bookId, [file]);
      return true;
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      return false;
    }
  }, [bookId]);

  // Confirm and keep capture
  const handleKeep = useCallback(async () => {
    if (!lastCapture) return;

    setIsUploading(true);
    const success = await uploadImage(lastCapture.blob);
    setIsUploading(false);

    if (success) {
      setCapturedCount((prev) => prev + 1);
      setLastCapture(null);
      setIsReviewing(false);
    }
  }, [lastCapture, uploadImage]);

  // Retake photo
  const handleRetake = useCallback(() => {
    setLastCapture(null);
    setIsReviewing(false);
  }, []);

  // Finish capture session
  const handleFinish = useCallback(() => {
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    onComplete();
  }, [onComplete]);

  // Show permission prompt if not granted
  if (permissionStatus !== 'granted') {
    return (
      <CameraPermissionPrompt
        bookId={bookId}
        status={permissionStatus}
        onRequestPermission={handleRequestPermission}
      />
    );
  }

  // Show review screen after capture
  if (isReviewing && lastCapture) {
    return (
      <CapturedPageReview
        imageDataUrl={lastCapture.dataUrl}
        pageNumber={capturedCount + 1}
        onKeep={handleKeep}
        onRetake={handleRetake}
        isUploading={isUploading}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Error banner */}
      {error && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-red-600 text-white text-center py-2 text-sm">
          {error}
        </div>
      )}

      {/* Video preview */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
        />

        {/* Alignment overlay */}
        <CaptureOverlay showTips={isStreaming} />

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Controls */}
      <div className="bg-black">
        {/* Shutter button - centered */}
        <div className="flex justify-center py-4">
          <ShutterButton onCapture={handleCapture} disabled={!isStreaming} />
        </div>

        {/* Progress bar */}
        <CaptureProgress
          capturedCount={capturedCount}
          onFlipCamera={handleFlipCamera}
          onFinish={handleFinish}
          canFlip={hasMultipleCameras}
        />
      </div>
    </div>
  );
}
