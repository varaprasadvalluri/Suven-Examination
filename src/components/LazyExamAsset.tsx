import React, { useState, useEffect } from 'react';
import { Image, Volume2, DownloadCloud, Loader2 } from 'lucide-react';

interface LazyExamAssetProps {
  src: string;
  type: 'image' | 'audio';
  alt?: string;
  isActive: boolean; // True when this question is the currently selected index
}

export const LazyExamAsset: React.FC<LazyExamAssetProps> = ({ src, type, alt = 'Exam diagram panel', isActive }) => {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (isActive && !hasLoaded && !isFetching) {
      setIsFetching(true);
      // Simulate/Trigger strict browser request load
      if (type === 'image') {
        const img = new window.Image();
        img.src = src;
        img.onload = () => {
          setHasLoaded(true);
          setIsFetching(false);
        };
        img.onerror = () => {
          setIsFetching(false);
        };
      } else if (type === 'audio') {
        const audio = new window.Audio();
        audio.src = src;
        audio.oncanplaythrough = () => {
          setHasLoaded(true);
          setIsFetching(false);
        };
        audio.onerror = () => {
          setIsFetching(false);
        };
      }
    }
  }, [isActive, src, type, hasLoaded, isFetching]);

  // If the user isn't on this question yet, render a low-weight placeholder
  if (!isActive) {
    return (
      <div className="border border-slate-200 border-dashed rounded-2xl p-4 bg-slate-50/50 flex items-center justify-center gap-3 text-slate-400 select-none text-[11px] font-bold">
        {type === 'image' ? <Image className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        <span>Resource deferred to optimize network budget</span>
      </div>
    );
  }

  if (isFetching) {
    return (
      <div className="border border-indigo-100 rounded-2xl p-5 bg-indigo-50/30 flex items-center justify-center gap-2 text-indigo-600 font-bold text-xs select-none">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="uppercase tracking-wider">Streamlining material asset segment...</span>
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div className="border border-rose-100 rounded-2xl p-4 bg-rose-50/40 flex items-center justify-center gap-2 text-rose-700 font-bold text-xs">
        <DownloadCloud className="h-4 w-4" />
        <span className="uppercase tracking-wider">Tap to manually initialize resource block</span>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 rounded-2xl overflow-hidden shadow-xs border border-slate-100 bg-white">
      {type === 'image' ? (
        <img 
          src={src} 
          alt={alt} 
          referrerPolicy="no-referrer"
          className="w-full max-h-80 object-contain mx-auto block bg-slate-50"
        />
      ) : (
        <div className="p-4 bg-indigo-50/50 border border-indigo-100 flex items-center gap-4">
          <Volume2 className="h-5 w-5 text-indigo-650 shrink-0" />
          <audio 
            src={src} 
            controls 
            className="w-full focus:outline-none" 
            controlsList="nodownload"
          />
        </div>
      )}
    </div>
  );
};
