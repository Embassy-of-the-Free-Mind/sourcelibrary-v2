import React, { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, AlertCircle } from 'lucide-react';

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onFileSelect, isProcessing }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateAndPass = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError("Please upload a valid image file (JPG, PNG).");
      return;
    }
    setError(null);
    onFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndPass(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndPass(e.target.files[0]);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-8 px-4">
      <div
        className={`
          relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ease-in-out cursor-pointer
          ${isDragging 
            ? 'border-blue-400 bg-blue-500/10 scale-[1.02]' 
            : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
          }
          ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          type="file"
          ref={inputRef}
          onChange={handleChange}
          className="hidden"
          accept="image/*"
        />

        <div className="flex flex-col items-center gap-4">
          <div className={`p-4 rounded-full bg-slate-800 ${isDragging ? 'text-blue-400' : 'text-slate-400'}`}>
            <Upload className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-200">
              Drag & Drop your book scan
            </h3>
            <p className="text-slate-500 mt-2 text-sm">
              or click to browse your files
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-800/50 px-3 py-1.5 rounded-full">
            <ImageIcon className="w-3 h-3" />
            <span>Supports JPG, PNG, WEBP</span>
          </div>
        </div>

        {error && (
          <div className="absolute -bottom-12 left-0 right-0 flex items-center justify-center text-red-400 text-sm gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
};