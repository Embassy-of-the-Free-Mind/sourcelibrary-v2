import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { UploadZone } from './components/UploadZone';
import { ResultView } from './components/ResultView';
import { detectPageBoundaries } from './services/geminiService';
import { fileToBase64, cropImage } from './utils/imageProcessing';
import { AppState, SplitResult } from './types';
import { Loader2, AlertTriangle } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [results, setResults] = useState<SplitResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    try {
      setState(AppState.PROCESSING);
      setErrorMsg(null);
      
      // 1. Prepare Image
      const base64Raw = await fileToBase64(file);
      const dataUrl = `data:${file.type};base64,${base64Raw}`;
      setOriginalImage(dataUrl);

      // 2. Call Gemini API
      const coordinates = await detectPageBoundaries(base64Raw, file.type);
      
      console.log('Detected Coordinates:', coordinates);

      // 3. Crop Images locally using Canvas
      const [leftUrl, rightUrl] = await Promise.all([
        cropImage(dataUrl, coordinates.leftPage),
        cropImage(dataUrl, coordinates.rightPage)
      ]);

      setResults({
        leftPageUrl: leftUrl,
        rightPageUrl: rightUrl
      });
      
      setState(AppState.COMPLETE);

    } catch (err: any) {
      console.error(err);
      setState(AppState.ERROR);
      setErrorMsg(err.message || "Failed to process image. Please try again.");
    }
  }, []);

  const handleReset = () => {
    setState(AppState.IDLE);
    setOriginalImage(null);
    setResults(null);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      <Header />
      
      <main className="container mx-auto py-12 px-4 flex flex-col items-center justify-center min-h-[80vh]">
        
        {state === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 w-full">
            <div className="text-center mb-10 space-y-4">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                Split Book Spreads <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                  Instantly
                </span>
              </h2>
              <p className="text-slate-400 max-w-lg mx-auto text-lg leading-relaxed">
                Upload a photo of an open book. We use AI to detect the page boundaries and crop them into perfect individual pages.
              </p>
            </div>
            <UploadZone onFileSelect={processFile} isProcessing={false} />
          </div>
        )}

        {state === AppState.PROCESSING && (
           <div className="flex flex-col items-center justify-center space-y-6 animate-pulse">
             <div className="relative">
               <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 rounded-full"></div>
               <Loader2 className="w-16 h-16 text-blue-400 animate-spin relative z-10" />
             </div>
             <div className="text-center space-y-2">
               <h3 className="text-xl font-semibold text-white">Analyzing Geometry...</h3>
               <p className="text-slate-400">Gemini is calculating page boundaries</p>
             </div>
           </div>
        )}

        {state === AppState.ERROR && (
          <div className="max-w-md mx-auto text-center space-y-6 animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto ring-1 ring-red-500/20">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">Processing Failed</h3>
              <p className="text-red-300 mt-2">{errorMsg}</p>
            </div>
            <button 
              onClick={handleReset}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {state === AppState.COMPLETE && results && originalImage && (
          <ResultView 
            originalImage={originalImage} 
            results={results} 
            onReset={handleReset} 
          />
        )}

      </main>
    </div>
  );
};

export default App;