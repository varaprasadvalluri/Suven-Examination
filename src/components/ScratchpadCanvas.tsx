import React, { useRef, useState, useEffect } from 'react';
import { Pencil, Trash2, Eraser, Move, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';

export const ScratchpadCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#4F46E5');
  const [lineWidth, setLineWidth] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set high-DPI scaling
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw subtle math grid cells
    ctx.strokeStyle = '#F1F5F9';
    ctx.lineWidth = 0.5;
    const gridSize = 20;
    
    for (let x = 0; x < rect.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }
    for (let y = 0; y < rect.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
  }, [isOpen]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = isEraser ? '#FFFFFF' : color;
    ctx.lineWidth = isEraser ? 15 : lineWidth;
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Re-draw grid lines
    ctx.strokeStyle = '#F1F5F9';
    ctx.lineWidth = 0.5;
    const gridSize = 20;
    for (let x = 0; x < rect.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }
    for (let y = 0; y < rect.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
  };

  if (!isOpen) {
    return (
      <Button 
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-40 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer h-10 px-4"
      >
        <Pencil className="h-4 w-4" /> Open Scratchpad Canvas
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-[360px] sm:w-[420px] bg-white border border-slate-200 rounded-[28px] shadow-2xl p-4 z-40 flex flex-col space-y-3 select-none animate-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-1.5">
          <Pencil className="h-4 w-4 text-indigo-600" />
          <span className="text-xs font-black uppercase text-slate-800 tracking-wider">Scratchpad Workspace</span>
        </div>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition-colors"
        >
          <EyeOff className="h-4 w-4" />
        </button>
      </div>

      <div className="border border-slate-150 rounded-2xl overflow-hidden bg-white relative cursor-crosshair">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          className="w-full h-48 bg-white block"
        />
      </div>

      <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl">
        <div className="flex items-center gap-1">
          <Button 
            variant={!isEraser ? "default" : "outline"} 
            size="icon" 
            onClick={() => setIsEraser(false)}
            className={`h-8 w-8 rounded-lg cursor-pointer ${!isEraser ? 'bg-indigo-600 text-white' : 'text-slate-600 bg-white'}`}
            title="Pencil draw"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button 
            variant={isEraser ? "default" : "outline"} 
            size="icon" 
            onClick={() => setIsEraser(true)}
            className={`h-8 w-8 rounded-lg cursor-pointer ${isEraser ? 'bg-indigo-600 text-white' : 'text-slate-600 bg-white'}`}
            title="Eraser tool"
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase font-black text-slate-400">Brush Size:</span>
          {[2, 4, 8].map(size => (
            <button
              key={size}
              onClick={() => setLineWidth(size)}
              className={`w-6 h-6 rounded-full flex items-center justify-center border font-bold text-[10px] transition-colors cursor-pointer ${lineWidth === size ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {size}px
            </button>
          ))}
        </div>

        <Button 
          variant="ghost" 
          size="sm" 
          onClick={clearCanvas}
          className="text-destructive hover:bg-rose-50 font-black text-[10px] uppercase tracking-wider h-8 rounded-lg cursor-pointer px-2"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      </div>
    </div>
  );
};
