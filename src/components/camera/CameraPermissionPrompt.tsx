'use client';

import { Camera, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface CameraPermissionPromptProps {
  bookId: string;
  status: 'prompt' | 'denied';
  onRequestPermission: () => void;
}

export default function CameraPermissionPrompt({
  bookId,
  status,
  onRequestPermission,
}: CameraPermissionPromptProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-20 h-20 rounded-full bg-stone-800 flex items-center justify-center mb-6">
        <Camera className="w-10 h-10 text-stone-400" />
      </div>

      {status === 'prompt' ? (
        <>
          <h2 className="text-xl font-semibold text-white mb-2">
            Camera Access Needed
          </h2>
          <p className="text-stone-400 mb-8 max-w-xs">
            To photograph book pages, we need access to your camera.
          </p>

          <button
            onClick={onRequestPermission}
            className="px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors mb-4"
          >
            Allow Camera
          </button>

          <Link
            href={`/book/${bookId}`}
            className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Link>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-white mb-2">
            Camera Access Denied
          </h2>
          <p className="text-stone-400 mb-4 max-w-xs">
            Camera permission was denied. Please enable camera access in your browser or device settings to use this feature.
          </p>
          <p className="text-stone-500 text-sm mb-8 max-w-xs">
            On most devices: Settings → Privacy → Camera → Enable for this site
          </p>

          <button
            onClick={onRequestPermission}
            className="px-6 py-3 bg-stone-700 text-white rounded-lg font-medium hover:bg-stone-600 transition-colors mb-4"
          >
            Try Again
          </button>

          <Link
            href={`/book/${bookId}`}
            className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Link>
        </>
      )}
    </div>
  );
}
