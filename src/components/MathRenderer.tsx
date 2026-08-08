import React, { useEffect, useRef } from 'react';

interface MathRendererProps {
  math: string;
  block?: boolean;
  className?: string;
}

export const MathRenderer: React.FC<MathRendererProps> = ({ math, block = false, className = '' }) => {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Double check window.katex from the CDN
    const katex = (window as any).katex;
    if (katex) {
      try {
        katex.render(math, containerRef.current, {
          displayMode: block,
          throwOnError: false,
          trust: true
        });
      } catch (err) {
        console.error("KaTeX rendering error", err);
        containerRef.current.textContent = math;
      }
    } else {
      // Clean fallback if KaTeX hasn't loaded yet
      containerRef.current.textContent = math;
    }
  }, [math, block]);

  return (
    <span 
      id={`math-rendered-${Math.random().toString(36).substr(2, 9)}`}
      ref={containerRef} 
      className={`inline-block font-mono ${className}`} 
      style={{ minHeight: '1.2em' }}
    />
  );
};
