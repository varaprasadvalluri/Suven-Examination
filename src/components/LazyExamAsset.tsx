import React, { useState, useEffect, useRef } from 'react';
import { Image, Volume2, RotateCcw, Loader2 } from 'lucide-react';

interface LazyExamAssetProps {
  src: string;
  type: 'image' | 'audio';
  alt?: string;
  isActive: boolean; // True when this question is the currently selected index
}

// A school network drops a request far more often than a question's diagram is genuinely
// missing, so a failed preload retries on its own before it gives up. After these, the
// student gets a button instead of an automatic loop — an exam screen must never sit in a
// silent retry cycle, and it must never dead-end either: before this, a single transient
// onerror left the question's diagram unreachable for the rest of the exam, because nothing
// re-ran the effect and the failure state had no control on it.
const MAX_AUTO_RETRIES = 2;

export const LazyExamAsset: React.FC<LazyExamAssetProps> = ({ src, type, alt = 'Exam diagram panel', isActive }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);
  // Remembers what has already been fetched, so navigating away from a question and back
  // doesn't re-run the preload and flash the spinner over an image the browser has cached.
  const loadedSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive) return;

    if (loadedSrcRef.current === src) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    const succeed = () => {
      if (cancelled) return;
      loadedSrcRef.current = src;
      setStatus('ready');
    };

    const fail = () => {
      if (cancelled) return;
      if (attempt < MAX_AUTO_RETRIES) {
        // 700ms, then 1.4s. Bounded and increasing, so a flaky connection gets a second
        // chance without the component hammering the network on the student's behalf.
        retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), 700 * 2 ** attempt);
      } else {
        setStatus('failed');
      }
    };

    setStatus('loading');

    if (type === 'image') {
      const img = new window.Image();
      img.onload = succeed;
      img.onerror = fail;
      img.src = src;
    } else {
      const audio = new window.Audio();
      audio.oncanplaythrough = succeed;
      audio.onerror = fail;
      audio.src = src;
    }

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [isActive, src, type, attempt]);

  const retryNow = () => {
    setStatus('loading');
    setAttempt((a) => a + 1);
  };

  // If the user isn't on this question yet, render a low-weight placeholder
  if (!isActive) {
    return (
      <div className="border border-slate-200 border-dashed rounded-2xl p-4 bg-slate-50/50 flex items-center justify-center gap-3 text-slate-400 select-none text-[12px] md:text-[11px] font-bold">
        {type === 'image' ? <Image className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        <span>Resource deferred to optimize network budget</span>
      </div>
    );
  }

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="border border-indigo-100 rounded-2xl p-5 bg-indigo-50/30 flex items-center justify-center gap-2 text-indigo-600 font-bold text-xs select-none">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="uppercase tracking-wider">Loading {type === 'image' ? 'diagram' : 'audio'}...</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="border border-rose-200 rounded-2xl p-4 bg-rose-50/40 flex flex-wrap items-center justify-center gap-3 text-rose-700 text-xs font-bold">
        <span>Couldn't load this {type === 'image' ? 'diagram' : 'audio clip'}.</span>
        <button
          type="button"
          onClick={retryNow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-rose-700 uppercase tracking-wider transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 rounded-2xl overflow-hidden shadow-xs border border-slate-100 bg-white">
      {type === 'image' ? (
        <img src={src} alt={alt} referrerPolicy="no-referrer" className="w-full max-h-80 object-contain mx-auto block bg-slate-50" />
      ) : (
        <div className="p-4 bg-indigo-50/50 border border-indigo-100 flex items-center gap-4">
          <Volume2 className="h-5 w-5 text-indigo-650 shrink-0" />
          <audio src={src} controls className="w-full focus:outline-none" controlsList="nodownload" />
        </div>
      )}
    </div>
  );
};
