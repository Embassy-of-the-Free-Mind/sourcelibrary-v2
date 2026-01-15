import React from 'react';
import { BookOpen, Scissors } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="w-full py-6 px-4 md:px-8 border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <BookOpen className="w-8 h-8 text-blue-400" />
            <Scissors className="w-4 h-4 text-pink-400 absolute -bottom-1 -right-1" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              BookSplit AI
            </h1>
            <p className="text-xs text-slate-400">Powered by Gemini Vision</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 text-sm text-slate-400">
          <span>Upload</span>
          <span>&rarr;</span>
          <span>Detect</span>
          <span>&rarr;</span>
          <span>Split</span>
        </div>
      </div>
    </header>
  );
};