'use client';

import { useState, useRef, useEffect } from 'react';
import FullscreenImageViewer from './FullscreenImageViewer';

interface ImageWithMagnifierProps {
  src: string;
  thumbnail?: string;
  alt: string;
  className?: string;
  magnifierSize?: number;
  zoomLevel?: number;
  scrollable?: boolean;
}

// Magnifier component for zooming into the source image
// Desktop: hover to show magnifier lens, click HD button for fullscreen
// Mobile/Touch: tap to open fullscreen viewer
export default function ImageWithMagnifier({
  src,
  thumbnail,
  alt,
  className = '',
  magnifierSize = 200,
  zoomLevel = 3,
  scrollable = false
}: ImageWithMagnifierProps) {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [fullImageDimensions, setFullImageDimensions] = useState({ width: 0, height: 0 });
  const [isLoaded, setIsLoaded] = useState(false);
  const [fullImageLoaded, setFullImageLoaded] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Use thumbnail for display, full image for magnifier
  // If no thumbnail, use resize API to generate one on-the-fly
  // If src is already an /api/image URL, use it directly (already processed)
  const getResizedUrl = (url: string, width: number = 400) => {
    // Don't double-wrap /api/image URLs
    if (url.startsWith('/api/image')) return url;
    return `/api/image?url=${encodeURIComponent(url)}&w=${width}&q=70`;
  };
  const isApiImageUrl = src.startsWith('/api/image');
  const displaySrc = thumbnail || (isApiImageUrl ? src : getResizedUrl(src, 400));
  const magnifierSrc = src;

  // Detect touch device on mount
  useEffect(() => {
    const checkTouch = () => {
      setIsTouchDevice(
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches
      );
    };
    checkTouch();
    // Re-check on resize (for responsive testing)
    window.addEventListener('resize', checkTouch);
    return () => window.removeEventListener('resize', checkTouch);
  }, []);

  useEffect(() => {
    // Reset loaded state when src changes
    setIsLoaded(false);
    setFullImageLoaded(false);
    setFullImageDimensions({ width: 0, height: 0 });
  }, [src]);

  useEffect(() => {
    // Get actual rendered image dimensions (accounting for object-contain)
    const updateDimensions = () => {
      if (imgRef.current) {
        const img = imgRef.current;
        const containerRect = img.getBoundingClientRect();
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        if (naturalWidth && naturalHeight) {
          // Calculate the actual rendered size with object-contain
          const containerAspect = containerRect.width / containerRect.height;
          const imageAspect = naturalWidth / naturalHeight;

          let renderedWidth, renderedHeight;
          if (imageAspect > containerAspect) {
            // Image is wider - constrained by width
            renderedWidth = containerRect.width;
            renderedHeight = containerRect.width / imageAspect;
          } else {
            // Image is taller - constrained by height
            renderedHeight = containerRect.height;
            renderedWidth = containerRect.height * imageAspect;
          }

          setImageDimensions({ width: renderedWidth, height: renderedHeight });
        }
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [isLoaded]);

  // Load full image only on first hover (lazy load for magnifier)
  const [hasHovered, setHasHovered] = useState(false);

  useEffect(() => {
    if (!hasHovered) return;
    const img = new window.Image();
    img.onload = () => {
      setFullImageLoaded(true);
      setFullImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = src;
  }, [src, hasHovered]);

  // Desktop: mouse move for magnifier
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Skip magnifier on touch devices
    if (isTouchDevice) return;

    // Start loading full image on first hover
    if (!hasHovered) setHasHovered(true);
    if (!containerRef.current || !imgRef.current || !fullImageLoaded) return;
    if (!imageDimensions.width || !imageDimensions.height) return;

    const containerRect = containerRef.current.getBoundingClientRect();

    // Calculate where the actual image is rendered within the container (object-contain centers it)
    const imgOffsetX = (containerRect.width - imageDimensions.width) / 2;
    const imgOffsetY = (containerRect.height - imageDimensions.height) / 2;

    // Get cursor position relative to container
    const containerX = e.clientX - containerRect.left;
    const containerY = e.clientY - containerRect.top;

    // Get cursor position relative to the actual rendered image
    const imgX = containerX - imgOffsetX;
    const imgY = containerY - imgOffsetY;

    // Check if cursor is over the actual rendered image
    const isOverImage = imgX >= 0 && imgX <= imageDimensions.width && imgY >= 0 && imgY <= imageDimensions.height;

    if (isOverImage) {
      setCursorPosition({ x: containerX, y: containerY });

      // Calculate background position as percentage of image dimensions
      const xPercent = (imgX / imageDimensions.width) * 100;
      const yPercent = (imgY / imageDimensions.height) * 100;
      setMagnifierPosition({ x: xPercent, y: yPercent });
      setShowMagnifier(true);
    } else {
      setShowMagnifier(false);
    }
  };

  // Mobile: tap to open fullscreen
  const handleClick = () => {
    if (isTouchDevice && isLoaded) {
      setShowFullscreen(true);
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`relative ${className}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowMagnifier(false)}
        onClick={handleClick}
      >
        {/* Loading skeleton */}
        {!isLoaded && (
          <div className={`flex items-center justify-center bg-stone-100 animate-pulse ${scrollable ? 'w-full h-48' : 'absolute inset-0'}`}>
            <div className="text-stone-400 text-sm">Loading...</div>
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={displaySrc}
          alt={alt}
          loading="lazy"
          className={`w-full transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${isTouchDevice ? 'cursor-pointer' : 'cursor-crosshair'} ${scrollable ? '' : 'h-full object-contain'}`}
          onLoad={() => {
            setIsLoaded(true);
            if (imgRef.current) {
              const rect = imgRef.current.getBoundingClientRect();
              setImageDimensions({ width: rect.width, height: rect.height });
            }
          }}
        />

        {/* Desktop: Magnifier lens - uses full resolution image */}
        {!isTouchDevice && showMagnifier && fullImageLoaded && (
          <div
            className="absolute pointer-events-none rounded-full overflow-hidden"
            style={{
              width: magnifierSize,
              height: magnifierSize,
              left: cursorPosition.x - magnifierSize / 2,
              top: cursorPosition.y - magnifierSize / 2,
              border: '4px solid white',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              backgroundImage: `url(${magnifierSrc})`,
              backgroundSize: `${imageDimensions.width * zoomLevel}px ${imageDimensions.height * zoomLevel}px`,
              backgroundPosition: `${-magnifierPosition.x * imageDimensions.width * zoomLevel / 100 + magnifierSize / 2}px ${-magnifierPosition.y * imageDimensions.height * zoomLevel / 100 + magnifierSize / 2}px`,
              backgroundRepeat: 'no-repeat',
              backgroundColor: 'white',
              zIndex: 100,
            }}
          />
        )}

      </div>

      {/* Fullscreen viewer - works for both mobile and desktop */}
      <FullscreenImageViewer
        src={src}
        alt={alt}
        isOpen={showFullscreen}
        onClose={() => setShowFullscreen(false)}
      />
    </>
  );
}
