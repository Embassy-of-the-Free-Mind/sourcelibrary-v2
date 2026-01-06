import React from 'react';
import { Download, ChevronRight, Check } from 'lucide-react';
import { SplitResult } from '../types';

interface ResultViewProps {
  originalImage: string;
  results: SplitResult;
  onReset: () => void;
}

export const ResultView: React.FC<ResultViewProps> = ({ originalImage, results, onReset }) => {
  return (
    <div className="w-full max-w-6xl mx-auto p-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Original */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="flex items-center justify-between text-slate-400 text-sm font-medium uppercase tracking-wider">
            <span>Original</span>
            <span className="bg-slate-800 text-xs px-2 py-1 rounded">Input</span>
          </div>
          <div className="relative group rounded-xl overflow-hidden border border-slate-700 shadow-2xl bg-black/40">
            <img 
              src={originalImage} 
              alt="Original" 
              className="w-full h-auto object-contain max-h-[500px] opacity-80 group-hover:opacity-100 transition-opacity" 
            />
          </div>
        </div>

        {/* Divider / Arrow */}
        <div className="lg:col-span-1 flex items-center justify-center">
            <div className="bg-slate-800 p-2 rounded-full hidden lg:block">
                <ChevronRight className="w-6 h-6 text-slate-500" />
            </div>
            <div className="bg-slate-800 p-2 rounded-full lg:hidden rotate-90 my-4">
                <ChevronRight className="w-6 h-6 text-slate-500" />
            </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="flex items-center justify-between text-green-400 text-sm font-medium uppercase tracking-wider">
            <span className="flex items-center gap-2">
                <Check className="w-4 h-4" />
                Processed Results
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Page */}
            <div className="flex flex-col gap-3 group">
              <div className="relative rounded-xl overflow-hidden border border-slate-700 shadow-xl bg-slate-800/30">
                <img src={results.leftPageUrl} alt="Left Page" className="w-full h-auto" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <span className="text-white font-medium">Left Page</span>
                </div>
              </div>
              <a 
                href={results.leftPageUrl} 
                download="left-page.jpg"
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-colors font-medium text-sm"
              >
                <Download className="w-4 h-4" /> Download Left
              </a>
            </div>

            {/* Right Page */}
            <div className="flex flex-col gap-3 group">
              <div className="relative rounded-xl overflow-hidden border border-slate-700 shadow-xl bg-slate-800/30">
                <img src={results.rightPageUrl} alt="Right Page" className="w-full h-auto" />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <span className="text-white font-medium">Right Page</span>
                </div>
              </div>
              <a 
                href={results.rightPageUrl} 
                download="right-page.jpg"
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-colors font-medium text-sm"
              >
                <Download className="w-4 h-4" /> Download Right
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 flex justify-center">
        <button 
            onClick={onReset}
            className="text-slate-400 hover:text-white underline underline-offset-4 decoration-slate-600 hover:decoration-white transition-all"
        >
            Process another image
        </button>
      </div>
    </div>
  );
};